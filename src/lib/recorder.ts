import { AudioMixer } from './audio';
import { describeError, getCamera, getMic, getScreen, stopStream, type CaptureSurface } from './capture';
import { Compositor, type CameraFrame, type Corner, type VirtualBackground } from './compositor';
import { MemorySink, type ChunkSink } from './sink';
import { pickMimeType } from './support';
import { createTicker } from './ticker';
import type { TranscriptCue } from './db';

interface NativeSpeechAlternative { transcript: string }
interface NativeSpeechResult extends ArrayLike<NativeSpeechAlternative> { isFinal: boolean }
interface NativeSpeechEvent extends Event { resultIndex: number; results: ArrayLike<NativeSpeechResult> }
interface NativeSpeechErrorEvent extends Event { error: string }
interface NativeSpeechRecognition extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: NativeSpeechEvent) => void) | null;
  onerror: ((event: NativeSpeechErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}
type NativeSpeechRecognitionConstructor = new () => NativeSpeechRecognition;
declare global {
  interface Window {
    SpeechRecognition?: NativeSpeechRecognitionConstructor;
    webkitSpeechRecognition?: NativeSpeechRecognitionConstructor;
  }
}

export type State = 'ready' | 'countdown' | 'recording' | 'paused' | 'saving' | 'closed';
export interface Options { mic?: boolean; micDeviceId?: string; camera?: boolean; limitSec?: number; warnSec?: number; fps?: number; maxVideoWidth?: number; maxVideoHeight?: number; source?: 'recorded' | 'meeting'; speechTranscription?: boolean; noiseSuppression?: boolean }
export interface Result { id: string; blob: Blob; mimeType: string; durationMs: number; source?: 'recorded' | 'meeting'; transcript?: TranscriptCue[] }
export interface Handlers {
  onState?: (s: State) => void;
  onCount?: (n: number) => void;
  onTime?: (elapsedMs: number, limitMs: number) => void;
  onLimitWarning?: (secondsLeft: number) => void;
  onError?: (message: string) => void;
  onTranscript?: (cues: TranscriptCue[], interim: string) => void;
  onTranscriptionStatus?: (message: string) => void;
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
  private virtualBackground: VirtualBackground = 'off';
  private cameraFrame: CameraFrame = 'circle';
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
  private speechTranscriptionEnabled: boolean;
  private speechRecognition: NativeSpeechRecognition | null = null;
  private transcript: TranscriptCue[] = [];
  private interimTranscript = '';
  private recognitionRestartTimer: ReturnType<typeof setTimeout> | null = null;

  private constructor(opts: Required<Options>, h: Handlers, makeSink: () => ChunkSink) {
    this.opts = opts;
    this.h = h;
    this.makeSink = makeSink;
    this.sink = makeSink();
    this.speechTranscriptionEnabled = opts.speechTranscription;
  }

  static async prepare(o: Options = {}, h: Handlers = {}, makeSink: () => ChunkSink = () => new MemorySink()) {
    const s = new RecorderSession({ mic: true, micDeviceId: '', camera: true, limitSec: 300, warnSec: 30, fps: 30, maxVideoWidth: 1280, maxVideoHeight: 720, source: 'recorded', speechTranscription: false, noiseSuppression: true, ...o }, h, makeSink);
    if (s.opts.mic) {
      try {
        s.mic = await getMic(s.opts.micDeviceId, s.opts.noiseSuppression);
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
  get screenStream() { return this.screen; }
  get recordingStream() { return this.comp?.stream ?? null; }
  get hasMic() { return Boolean(this.mic?.getAudioTracks().some((track) => track.readyState === 'live')); }
  level() { return this.mixer.level(); }
  setCamera(on: boolean) { if (this.comp) this.comp.camOn = on; }
  setCorner(c: Corner) { if (this.comp) this.comp.corner = c; }
  setVirtualBackground(background: VirtualBackground) {
    this.virtualBackground = background;
    if (this.comp) this.comp.virtualBackground = background;
  }
  setCameraFrame(frame: CameraFrame) {
    this.cameraFrame = frame;
    if (this.comp) this.comp.cameraFrame = frame;
  }
  setSpeechTranscription(enabled: boolean) {
    this.speechTranscriptionEnabled = enabled;
    if (this.state === 'recording' && enabled) this.startSpeechRecognition();
    else if (!enabled) this.stopSpeechRecognition();
  }

  /** Throws a DOMException; pass it to describeError(e, 'screen'). */
  async shareScreen(surface: CaptureSurface = 'monitor', includeAudio = true, corner: Corner = 'br') {
    this.dropScreen();
    const screen = await getScreen(surface, includeAudio);
    if (this.state !== 'ready') {
      stopStream(screen);
      return;
    }
    try {
    const comp = new Compositor(screen, this.cam, this.opts.fps, this.opts.maxVideoWidth, this.opts.maxVideoHeight);
      comp.corner = corner;
      comp.virtualBackground = this.virtualBackground;
      comp.cameraFrame = this.cameraFrame;
      this.screen = screen;
      this.comp = comp;
      await comp.start();
      if (this.state !== 'ready' || screen.getVideoTracks().every((track) => track.readyState === 'ended')) {
        this.dropScreen();
        return;
      }
      this.mixer.addSystem(screen);
      screen.getVideoTracks()[0].addEventListener('ended', () => this.sourceEnded(screen)); // "Stop sharing" in the browser bar
    } catch (e) {
      this.dropScreen();
      stopStream(screen);
      throw e;
    }
  }

  async shareCameraOnly() {
    this.dropScreen();
    if (!this.cam || this.cam.getVideoTracks().every((track) => track.readyState === 'ended')) {
      throw new Error('Turn on a working camera to record camera only.');
    }
    if (this.state !== 'ready') return;
    const comp = new Compositor(null, this.cam, this.opts.fps, this.opts.maxVideoWidth, this.opts.maxVideoHeight, true);
    comp.virtualBackground = this.virtualBackground;
    comp.cameraFrame = this.cameraFrame;
    this.comp = comp;
    try {
      await comp.start();
      if (this.state !== 'ready') { this.dropScreen(); return; }
      this.cam.getVideoTracks()[0].addEventListener('ended', () => this.sourceEnded(null));
    } catch (error) {
      this.dropScreen();
      throw error;
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
    this.stopSpeechRecognition();
  }

  resume() {
    if (this.state !== 'paused' || !this.mr) return;
    this.mr.resume();
    this.segStart = performance.now();
    this.setState('recording');
    this.startSpeechRecognition();
  }

  async stop() {
    if (this.state === 'countdown') return this.cancel();
    if (this.state !== 'recording' && this.state !== 'paused') return;
    const mr = this.mr!;
    const ms = this.elapsed();
    this.setState('saving');
    this.stopSpeechRecognition();
    this.stopTick?.();
    try {
      await new Promise<void>((res, reject) => {
        mr.onstop = () => res();
        mr.onerror = () => reject(new Error('The browser could not finish recording.'));
        try { mr.stop(); } catch (e) { reject(e instanceof Error ? e : new Error('The browser could not finish recording.')); }
      });
      const type = (mr.mimeType || 'video/webm').split(';')[0];
      const blob = await this.sink.finish(type);
      this.release();
      this.setState('closed');
      this.h.onDone?.({ id: this.sink.id ?? crypto.randomUUID(), blob, mimeType: type, durationMs: ms, source: this.opts.source, transcript: this.transcript });
    } catch {
      void this.sink.discard();
      this.release();
      this.h.onError?.('Could not save the recording. Check browser storage and try again.');
      this.setState('closed');
    }
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
    this.speechTranscriptionEnabled = false;
    this.stopSpeechRecognition();
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
    try {
      const out = new MediaStream([...this.comp.stream.getVideoTracks(), ...this.mixer.stream.getAudioTracks()]);
      this.sink = this.makeSink();
      const mimeType = pickMimeType();
      if (!mimeType) throw new Error('This browser cannot record a supported video format.');
      const mr = new MediaRecorder(out, { mimeType, videoBitsPerSecond: 4_000_000, audioBitsPerSecond: 128_000 });
      mr.ondataavailable = (e) => { if (e.data.size) void this.sink.add(e.data); };
      mr.start(1000); // timeslice: a chunk every second
      this.mr = mr;
      this.before = 0;
      this.segStart = performance.now();
      this.warned = false;
      this.setState('recording');
      this.transcript = [];
      this.interimTranscript = '';
      this.h.onTranscript?.([], '');
      this.startSpeechRecognition();
      this.stopTick = createTicker(2, () => this.tick());
    } catch {
      this.release();
      this.h.onError?.('Could not start recording in this browser. Try a different browser or restart the capture.');
      this.setState('closed');
    }
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

  private sourceEnded(screen: MediaStream | null) {
    if (screen !== null && screen !== this.screen) return;
    if (this.state === 'recording' || this.state === 'paused') void this.stop();
    else if (this.state === 'countdown') this.cancel();
    else this.dropScreen();
  }

  private startSpeechRecognition() {
    if (!this.speechTranscriptionEnabled || this.state !== 'recording' || !this.mic || this.speechRecognition) return;
    const SpeechRecognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      this.speechTranscriptionEnabled = false;
      this.h.onTranscriptionStatus?.('Automatic captions are not supported by this browser. The recording will continue.');
      return;
    }
    try {
      const recognition = new SpeechRecognition();
      recognition.lang = navigator.language || 'en-US';
      recognition.continuous = true;
      recognition.interimResults = true;
      this.speechRecognition = recognition;
      recognition.onresult = (event) => {
        let interim = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          const text = result[0]?.transcript.trim();
          if (!text) continue;
          if (result.isFinal) {
            const estimatedDuration = Math.min(4000, Math.max(500, text.length * 55));
            this.transcript.push({ id: crypto.randomUUID(), startMs: Math.max(0, Math.floor(this.elapsed() - estimatedDuration)), text: text.slice(0, 1000) });
          } else interim += `${text} `;
        }
        this.interimTranscript = interim.trim();
        this.h.onTranscript?.([...this.transcript], this.interimTranscript);
      };
      recognition.onerror = (event) => {
        if (['not-allowed', 'service-not-allowed', 'audio-capture', 'network'].includes(event.error)) {
          this.speechTranscriptionEnabled = false;
          this.stopSpeechRecognition();
          const message = event.error === 'network'
            ? 'The browser speech service is unavailable. Your recording continues without automatic captions.'
            : 'The browser could not transcribe microphone audio. Your recording continues without automatic captions.';
          this.h.onTranscriptionStatus?.(message);
        }
      };
      recognition.onend = () => {
        if (this.speechRecognition === recognition) this.speechRecognition = null;
        if (!this.speechTranscriptionEnabled || this.state !== 'recording') return;
        this.recognitionRestartTimer = setTimeout(() => this.startSpeechRecognition(), 1000);
      };
      recognition.start();
      this.h.onTranscriptionStatus?.('Automatic captions are on.');
    } catch {
      this.speechTranscriptionEnabled = false;
      this.h.onTranscriptionStatus?.('The browser could not start automatic captions. Your recording continues.');
    }
  }

  private stopSpeechRecognition() {
    if (this.recognitionRestartTimer) clearTimeout(this.recognitionRestartTimer);
    this.recognitionRestartTimer = null;
    const recognition = this.speechRecognition;
    this.speechRecognition = null;
    if (!recognition) return;
    recognition.onresult = null;
    recognition.onerror = null;
    recognition.onend = null;
    try { recognition.stop(); } catch { /* stopping speech recognition is best-effort */ }
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
    this.stopSpeechRecognition();
    if (this.mr && this.mr.state !== 'inactive') {
      this.mr.ondataavailable = null;
      this.mr.onstop = null;
      try { this.mr.stop(); } catch { /* capture teardown continues */ }
    }
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
