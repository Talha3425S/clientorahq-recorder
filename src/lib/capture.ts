export type Kind = 'screen' | 'microphone' | 'camera';

export const getScreen = () =>
  navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: true }); // audio only where the browser allows it

export const getMic = () =>
  navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });

export const getCamera = () =>
  navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' } });

export const stopStream = (s: MediaStream | null) => s?.getTracks().forEach((t) => t.stop());

export function describeError(e: unknown, kind: Kind): { code: string; message: string } {
  const name = e instanceof DOMException ? e.name : '';
  switch (name) {
    case 'NotAllowedError':
      return {
        code: 'denied',
        message:
          kind === 'screen'
            ? 'Screen sharing was cancelled or blocked. Choose Share screen, then pick a screen, window or tab.'
            : `The ${kind} is blocked. Allow it in the site settings next to the address bar, then try again.`,
      };
    case 'NotFoundError':
      return { code: 'missing', message: `No ${kind} found. Connect one, or record without it.` };
    case 'NotReadableError':
      return { code: 'busy', message: `The ${kind} is being used by another app. Close that app and try again.` };
    default:
      return { code: 'unknown', message: `Could not start the ${kind}.` };
  }
}