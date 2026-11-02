export type Support = { ok: true } | { ok: false; reason: string };

export function checkSupport(): Support {
  if (!window.isSecureContext) {
    return { ok: false, reason: 'Recording only works on a secure (https) page.' };
  }
  if (typeof navigator.mediaDevices?.getDisplayMedia !== 'function') {
    return {
      ok: false,
      reason: 'This browser or device cannot record the screen. Open this page in Chrome, Edge or Firefox on a desktop computer.',
    };
  }
  if (typeof MediaRecorder === 'undefined' || typeof HTMLCanvasElement.prototype.captureStream !== 'function') {
    return { ok: false, reason: 'This browser cannot record video. Update it, or use Chrome, Edge or Firefox.' };
  }
  return { ok: true };
}

const WEBM = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
const MP4 = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4'];

export const canRecordMp4 = () => typeof MediaRecorder !== 'undefined' && MP4.some((t) => MediaRecorder.isTypeSupported(t));

export function pickMimeType(preferMp4 = false): string | undefined {
  const list = preferMp4 ? [...MP4, ...WEBM] : WEBM;
  return list.find((t) => MediaRecorder.isTypeSupported(t));
}