import { createTicker } from './ticker';

export type Corner = 'tl' | 'tr' | 'bl' | 'br';

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

function makeVideo(stream: MediaStream) {
  const v = document.createElement('video');
  v.muted = true;
  v.playsInline = true;
  v.srcObject = stream;
  return v;
}

async function ready(v: HTMLVideoElement) {
  await v.play();
  if (!v.videoWidth) await new Promise<void>((r) => v.addEventListener('loadedmetadata', () => r(), { once: true }));
}

/** Draws the screen plus a round camera bubble onto one canvas and exposes it as a stream. */
export class Compositor {
  readonly canvas = document.createElement('canvas');
  stream!: MediaStream;
  camOn = true;
  corner: Corner = 'br';
  mirror = true;
  private ctx = this.canvas.getContext('2d', { alpha: false })!;
  private screenV: HTMLVideoElement;
  private camV: HTMLVideoElement | null;
  private fps: number;
  private stopTicker: (() => void) | null = null;

  constructor(screen: MediaStream, cam: MediaStream | null, fps = 30) {
    this.fps = fps;
    this.screenV = makeVideo(screen);
    this.camV = cam ? makeVideo(cam) : null;
  }

  async start() {
    await Promise.all([ready(this.screenV), this.camV ? ready(this.camV) : undefined]);
    const w = this.screenV.videoWidth || 1280;
    const h = this.screenV.videoHeight || 720;
    const k = Math.min(1, 1920 / w, 1080 / h); // cap at 1080p to keep the CPU light
    this.canvas.width = even(w * k);
    this.canvas.height = even(h * k);
    this.stream = this.canvas.captureStream(this.fps);
    this.draw();
    this.stopTicker = createTicker(this.fps, this.draw);
  }

  stop() {
    this.stopTicker?.();
    this.stopTicker = null;
    for (const v of [this.screenV, this.camV]) {
      if (v) {
        v.pause();
        v.srcObject = null;
      }
    }
  }

  private draw = () => {
    const { ctx, canvas: c, screenV: v } = this;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, c.width, c.height);
    if (v.videoWidth) {
      const k = Math.min(c.width / v.videoWidth, c.height / v.videoHeight); // keep aspect ratio if the window resizes
      const w = v.videoWidth * k;
      const h = v.videoHeight * k;
      ctx.drawImage(v, (c.width - w) / 2, (c.height - h) / 2, w, h);
    }
    if (this.camOn && this.camV?.videoWidth) this.drawBubble(this.camV);
  };

  private drawBubble(cam: HTMLVideoElement) {
    const { ctx, canvas: c } = this;
    const d = Math.round(c.height * 0.22);
    const m = Math.round(d * 0.12);
    const r = d / 2;
    const x = this.corner.endsWith('r') ? c.width - d - m : m;
    const y = this.corner.startsWith('b') ? c.height - d - m : m;
    const side = Math.min(cam.videoWidth, cam.videoHeight); // centre-crop to a square
    const sx = (cam.videoWidth - side) / 2;
    const sy = (cam.videoHeight - side) / 2;
    ctx.save();
    ctx.beginPath();
    ctx.arc(x + r, y + r, r, 0, Math.PI * 2);
    ctx.clip();
    if (this.mirror) {
      ctx.translate(x + d, y);
      ctx.scale(-1, 1);
      ctx.drawImage(cam, sx, sy, side, side, 0, 0, d, d);
    } else {
      ctx.drawImage(cam, sx, sy, side, side, x, y, d, d);
    }
    ctx.restore();
    ctx.lineWidth = Math.max(3, d * 0.025);
    ctx.strokeStyle = '#fff';
    ctx.beginPath();
    ctx.arc(x + r, y + r, r, 0, Math.PI * 2);
    ctx.stroke();
  }
}