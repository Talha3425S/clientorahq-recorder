// Mixes the microphone and tab/system audio into one track, and measures mic level.
export class AudioMixer {
  private ctx = new AudioContext();
  private dest = this.ctx.createMediaStreamDestination();
  private analyser = this.ctx.createAnalyser();
  private buf = new Uint8Array(1024);

  constructor() {
    this.analyser.fftSize = 1024;
    void this.ctx.resume();
  }

  get stream(): MediaStream {
    return this.dest.stream;
  }

  addMic(stream: MediaStream) {
    const src = this.ctx.createMediaStreamSource(stream);
    src.connect(this.analyser);
    src.connect(this.dest); // never connect to ctx.destination: you would hear yourself
  }

  addSystem(stream: MediaStream) {
    if (!stream.getAudioTracks().length) return;
    this.ctx.createMediaStreamSource(new MediaStream(stream.getAudioTracks())).connect(this.dest);
  }

  /** 0..1 */
  level(): number {
    this.analyser.getByteTimeDomainData(this.buf);
    let sum = 0;
    for (const b of this.buf) sum += ((b - 128) / 128) ** 2;
    return Math.min(1, Math.sqrt(sum / this.buf.length) * 3);
  }

  close() {
    void this.ctx.close();
  }
}