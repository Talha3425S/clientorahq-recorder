import { createTicker } from './ticker';

export type Corner = 'tl' | 'tr' | 'bl' | 'br';
export type VirtualBackground = 'off' | 'warm' | 'blue';
export type CameraFrame = 'circle' | 'rounded' | 'square';

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

function cameraFramePath(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, frame: CameraFrame) {
  if (frame === 'circle') {
    ctx.beginPath();
    ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
    return;
  }
  const radius = frame === 'rounded' ? size * 0.18 : 0;
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + size - radius, y);
  ctx.quadraticCurveTo(x + size, y, x + size, y + radius);
  ctx.lineTo(x + size, y + size - radius);
  ctx.quadraticCurveTo(x + size, y + size, x + size - radius, y + size);
  ctx.lineTo(x + radius, y + size);
  ctx.quadraticCurveTo(x, y + size, x, y + size - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

/** Composes screen-and-camera or camera-only video into one recordable stream. */
export class Compositor {
  readonly canvas = document.createElement('canvas');
  stream!: MediaStream;
  camOn = true;
  corner: Corner = 'br';
  mirror = true;
  virtualBackground: VirtualBackground = 'off';
  cameraFrame: CameraFrame = 'circle';
  private ctx = this.canvas.getContext('2d', { alpha: false })!;
  private cameraCanvas = document.createElement('canvas');
  private cameraCtx = this.cameraCanvas.getContext('2d', { willReadFrequently: true })!;
  private screenV: HTMLVideoElement | null;
  private camV: HTMLVideoElement | null;
  private cameraOnly: boolean;
  private fps: number;
  private maxWidth: number;
  private maxHeight: number;
  private stopTicker: (() => void) | null = null;

  constructor(screen: MediaStream | null, cam: MediaStream | null, fps = 30, maxWidth = 1920, maxHeight = 1080, cameraOnly = false) {
    this.fps = fps;
    this.maxWidth = maxWidth;
    this.maxHeight = maxHeight;
    this.screenV = screen ? makeVideo(screen) : null;
    this.camV = cam ? makeVideo(cam) : null;
    this.cameraOnly = cameraOnly;
  }

  async start() {
    await Promise.all([this.screenV ? ready(this.screenV) : undefined, this.camV ? ready(this.camV) : undefined]);
    const source = this.cameraOnly ? this.camV : this.screenV;
    if (!source) throw new Error('No video source is available for the recording.');
    const w = source.videoWidth || 1280;
    const h = source.videoHeight || 720;
    const boundWidth = w >= h ? this.maxWidth : this.maxHeight;
    const boundHeight = w >= h ? this.maxHeight : this.maxWidth;
    const k = Math.min(1, boundWidth / w, boundHeight / h);
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
    const { ctx, canvas: c } = this;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, c.width, c.height);
    if (this.cameraOnly) {
      if (this.camOn && this.camV?.videoWidth) {
        if (this.virtualBackground === 'off') {
          ctx.save();
          if (this.mirror) { ctx.translate(c.width, 0); ctx.scale(-1, 1); }
          ctx.drawImage(this.camV, 0, 0, c.width, c.height);
          ctx.restore();
        } else {
          if (this.cameraCanvas.width !== c.width || this.cameraCanvas.height !== c.height) {
            this.cameraCanvas.width = c.width;
            this.cameraCanvas.height = c.height;
          }
          this.cameraCtx.save();
          if (this.mirror) { this.cameraCtx.translate(c.width, 0); this.cameraCtx.scale(-1, 1); }
          this.cameraCtx.drawImage(this.camV, 0, 0, c.width, c.height);
          this.cameraCtx.restore();
          this.removeGreenScreen();
          const gradient = ctx.createLinearGradient(0, 0, c.width, c.height);
          if (this.virtualBackground === 'warm') {
            gradient.addColorStop(0, '#ffd7a8'); gradient.addColorStop(1, '#be7a55');
          } else {
            gradient.addColorStop(0, '#bfe8ff'); gradient.addColorStop(1, '#5869a8');
          }
          ctx.fillStyle = gradient;
          ctx.fillRect(0, 0, c.width, c.height);
          ctx.drawImage(this.cameraCanvas, 0, 0);
        }
      }
      return;
    }
    const v = this.screenV;
    if (v?.videoWidth) {
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
    const x = this.corner.endsWith('r') ? c.width - d - m : m;
    const y = this.corner.startsWith('b') ? c.height - d - m : m;
    const side = Math.min(cam.videoWidth, cam.videoHeight); // centre-crop to a square
    const sx = (cam.videoWidth - side) / 2;
    const sy = (cam.videoHeight - side) / 2;
    ctx.save();
    cameraFramePath(ctx, x, y, d, this.cameraFrame);
    ctx.clip();
    if (this.virtualBackground === 'off') {
      if (this.mirror) {
        ctx.translate(x + d, y);
        ctx.scale(-1, 1);
        ctx.drawImage(cam, sx, sy, side, side, 0, 0, d, d);
      } else {
        ctx.drawImage(cam, sx, sy, side, side, x, y, d, d);
      }
    } else {
      if (this.cameraCanvas.width !== d || this.cameraCanvas.height !== d) {
        this.cameraCanvas.width = d;
        this.cameraCanvas.height = d;
      }
      this.cameraCtx.save();
      if (this.mirror) {
        this.cameraCtx.translate(d, 0);
        this.cameraCtx.scale(-1, 1);
      }
      this.cameraCtx.drawImage(cam, sx, sy, side, side, 0, 0, d, d);
      this.cameraCtx.restore();
      this.removeGreenScreen();

      const gradient = ctx.createLinearGradient(x, y, x + d, y + d);
      if (this.virtualBackground === 'warm') {
        gradient.addColorStop(0, '#ffd7a8');
        gradient.addColorStop(1, '#be7a55');
      } else {
        gradient.addColorStop(0, '#bfe8ff');
        gradient.addColorStop(1, '#5869a8');
      }
      ctx.fillStyle = gradient;
      ctx.fillRect(x, y, d, d);
      ctx.drawImage(this.cameraCanvas, x, y, d, d);
    }
    ctx.restore();
    ctx.lineWidth = Math.max(3, d * 0.025);
    ctx.strokeStyle = '#fff';
    cameraFramePath(ctx, x, y, d, this.cameraFrame);
    ctx.stroke();
  }

  private removeGreenScreen() {
    const frame = this.cameraCtx.getImageData(0, 0, this.cameraCanvas.width, this.cameraCanvas.height);
    const pixels = frame.data;
    for (let i = 0; i < pixels.length; i += 4) {
      const red = pixels[i];
      const green = pixels[i + 1];
      const blue = pixels[i + 2];
      const dominance = green - Math.max(red, blue);
      if (green > 55 && dominance > 18) {
        pixels[i + 3] = Math.max(0, Math.min(255, Math.round((58 - dominance) * 6.4)));
        if (pixels[i + 3] > 0) pixels[i + 1] = Math.min(green, Math.max(red, blue) + 8);
      }
    }
    this.cameraCtx.putImageData(frame, 0, 0);
  }
}
