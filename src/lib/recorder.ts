import { AudioMixer } from './audio';
import { describeError, getCamera, getMic, getScreen, stopStream } from './capture';
import { Compositor, type Corner } from './compositor';
import { MemorySink, type ChunkSink } from './sink';
import { pickMimeType } from './support';
import { createTicker } from './ticker';

export type State = 'ready' | 'countdown' | 'recording' | 'paused' | 'saving' | 'closed';
export interface Options { mic?: boolean; camera?: boolean; limitSec?: number; warnSec?: number; fps?: number }
export interface Result { id: string; blob: Blob; mimeType: string; durationMs: number }
export interface Handlers {
  onState?: (s: State) => void;
  onCount?: (n: number) => void;
  onTime?: (elapsedMs: number, limitMs: number) => void;
  onLimitWarning?: (secondsLeft: number) => void;
  onDone?: (r: Result) => void;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Flow: prepare() (mic + camera, meter works) -> shareScreen() -> begin()
 * (3-2-1) -> pause/resume -> stop() -> onDone. Every stream is stopped at the end.
 */
export class RecorderSession {
  state: State = 'ready';
  notices: string[] = [];
  cam: MediaStream | null = null;
  private mic: MediaStream | null = null;
  private screen: MediaStream | null = null;
  private comp: Compositor | null = null;
  private mixer = new AudioMixer();
  private mr: MediaRecorder | null = null;
  private sink: ChunkSink;
  private stopTick: (() => void) | null = null;
  private before = 0;
  private segStart = 0;
  private warned = false;
  private run = 0;
  private opts: Required<Options>;
  private h: Handlers;
  private makeSink: () => ChunkSink;

  private constructor(opts: Required<Options>, h: Handlers, makeSink: () => ChunkSink) {
    this.opts = opts;
    this.h = h;
    this.makeSink = makeSink;
    this.sink = makeSink();
  }

  static async prepare(o: Options = {}, h: Handlers = {}, makeSink: () => ChunkSink = () => new MemorySink()) {
    const s = new RecorderSession({ mic: true, camera: true, limitSec: 300, warnSec: 30, fps: 30, ...o }, h, makeSink);
    if (s.opts.mic) {
      try {
        s.mic = await getMic();
        s.mixer.addMic(s.mic);
      } catch (e) {
        s.notices.push(describeError(e, 'microphone').message); // keep going without a mic
      }
    }
    if (s.opts.camera) {
      try {
        s.cam = await getCamera();
      } catch (e) {
        s.notices.push(describeError(e, 'camera').message);
      }
    }
    return s;
  }

  get hasScreen() { return this.comp !== null; }
  level() { return this.mixer.level(); }
  setCamera(on: boolean) { if (this.comp) this.comp.camOn = on; }
  setCorner(c: Corner) { if (this.comp) this.comp.corner = c; }

  /** Throws a DOMException; pass it to describeError(e, 'screen'). */
  async shareScreen() {
    this.dropScreen();
    const screen = await getScreen();
    try {
      const comp = new Compositor(screen, this.cam, this.opts.fps);
      await comp.start();
      this.screen = screen;
      this.comp = comp;
      this.mixer.addSystem(screen);
      screen.getVideoTracks()[0].addEventListener('ended', () => this.sourceEnded(screen)); // "Stop sharing" in the browser bar
    } catch (e) {
      stopStream(screen);
      throw e;
    }
  }

  async begin() {
    if (this.state !== 'ready' || !this.comp) return;
    const id = ++this.run;
    this.setState('countdown');
    for (let n = 3; n > 0; n--) {
      this.h.onCount?.(n);
      await sleep(1000);
      if (id !== this.run) return; // cancelled during the countdown
    }
    this.h.onCount?.(0);
    this.startRecording();
  }

  pause() {
    if (this.state !== 'recording' || !this.mr) return;
    this.mr.pause();
    this.before += performance.now() - this.segStart;
    this.setState('paused');
  }

  resume() {
    if (this.state !== 'paused' || !this.mr) return;
    this.mr.resume();
    this.segStart = performance.now();
    this.setState('recording');
  }

  async stop() {
    if (this.state === 'countdown') return this.cancel();
    if (this.state !== 'recording' && this.state !== 'paused') return;
    const mr = this.mr!;
    const ms = this.elapsed();
    this.setState('saving');
    this.stopTick?.();
    await new Promise<void>((res) => {
      mr.onstop = () => res();
      mr.stop(); // fires a last dataavailable first
    });
    const type = (mr.mimeType || 'video/webm').split(';')[0];
    const blob = await this.sink.finish(type);
    this.release();
    this.setState('closed');
    this.h.onDone?.({ id: this.sink.id ?? crypto.randomUUID(), blob, mimeType: type, durationMs: ms });
  }

  /** Throw the take away and count down again, keeping the same screen and mic. */
  async restart() {
    if (this.state !== 'recording' && this.state !== 'paused') return;
    this.stopTick?.();
    if (this.mr && this.mr.state !== 'inactive') {
      this.mr.ondataavailable = null;
      this.mr.stop();
    }
    this.mr = null;
    await this.sink.discard();
    this.setState('ready');
    await this.begin();
  }

  cancel() {
    this.run++;
    if (this.mr && this.mr.state !== 'inactive') {
      this.mr.ondataavailable = null;
      this.mr.onstop = null;
      this.mr.stop();
    }
    void this.sink.discard();
    this.release();
    this.setState('closed');
  }

  private startRecording() {
    if (!this.comp) return;
    const out = new MediaStream([...this.comp.stream.getVideoTracks(), ...this.mixer.stream.getAudioTracks()]);
    this.sink = this.makeSink();
    const mr = new MediaRecorder(out, { mimeType: pickMimeType(), videoBitsPerSecond: 4_000_000, audioBitsPerSecond: 128_000 });
    mr.ondataavailable = (e) => { if (e.data.size) void this.sink.add(e.data); };
    mr.start(1000); // timeslice: a chunk every second
    this.mr = mr;
    this.before = 0;
    this.segStart = performance.now();
    this.warned = false;
    this.setState('recording');
    this.stopTick = createTicker(4, () => this.tick());
  }

  private elapsed() {
    return this.before + (this.state === 'recording' ? performance.now() - this.segStart : 0);
  }

  private tick() {
    const limit = this.opts.limitSec * 1000;
    const ms = this.elapsed();
    this.h.onTime?.(ms, limit);
    if (!this.warned && limit - ms <= this.opts.warnSec * 1000) {
      this.warned = true;
      this.h.onLimitWarning?.(Math.ceil((limit - ms) / 1000));
    }
    if (ms >= limit) void this.stop();
  }

  private sourceEnded(screen: MediaStream) {
    if (screen !== this.screen) return;
    if (this.state === 'recording' || this.state === 'paused') void this.stop();
    else if (this.state === 'countdown') this.cancel();
    else this.dropScreen();
  }

  private dropScreen() {
    this.comp?.stop();
    stopStream(this.screen);
    this.comp = null;
    this.screen = null;
  }

  private release() {
    this.stopTick?.();
    this.stopTick = null;
    this.dropScreen();
    stopStream(this.mic);
    stopStream(this.cam);
    this.mixer.close();
    this.mr = null;
  }

  private setState(s: State) {
    this.state = s;
    this.h.onState?.(s);
  }
}