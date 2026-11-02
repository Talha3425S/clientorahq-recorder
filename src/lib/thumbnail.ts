/** Grabs one frame from a recording as a small JPEG data URL. Returns null if the browser cannot decode it in time. */
export async function makeThumbnail(blob: Blob, atSec = 0.5, width = 320): Promise<string | null> {
  const url = URL.createObjectURL(blob);
  const v = document.createElement('video');
  v.muted = true;
  v.preload = 'auto';
  v.src = url;
  try {
    await new Promise<void>((res, rej) => {
      const t = setTimeout(() => rej(new Error('timeout')), 5000);
      v.onloadeddata = () => { v.currentTime = atSec; };
      v.onseeked = () => { clearTimeout(t); res(); };
      v.onerror = () => { clearTimeout(t); rej(new Error('decode')); };
    });
    if (!v.videoWidth) return null;
    const c = document.createElement('canvas');
    c.width = width;
    c.height = Math.round((width * v.videoHeight) / v.videoWidth);
    c.getContext('2d')!.drawImage(v, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.7);
  } catch {
    return null;
  } finally {
    v.removeAttribute('src');
    v.load();
    URL.revokeObjectURL(url);
  }
}