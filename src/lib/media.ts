/** Length of a video file in ms, or 0 when the browser cannot tell (some WebM files have no duration). */
export function readDuration(file: Blob): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    const done = (ms: number) => {
      v.removeAttribute('src');
      v.load();
      URL.revokeObjectURL(url);
      resolve(ms);
    };
    v.preload = 'metadata';
    v.onloadedmetadata = () => done(Number.isFinite(v.duration) ? Math.round(v.duration * 1000) : 0);
    v.onerror = () => done(0);
    v.src = url;
  });
}