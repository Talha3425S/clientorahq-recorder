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

/** Re-encodes a selected time range from a local video without uploading it. */
export async function trimVideo(source: Blob, startMs: number, endMs: number, format?: 'webm' | 'mp4'): Promise<Blob> {
  const sourceUrl = URL.createObjectURL(source);
  const video = document.createElement('video');
  video.preload = 'auto';
  video.playsInline = true;
  const captureVideo = video as HTMLVideoElement & {
    captureStream?: () => MediaStream;
    mozCaptureStream?: () => MediaStream;
  };
  let stream: MediaStream | null = null;

  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error('Could not read this video.'));
      video.src = sourceUrl;
    });
    const duration = Number.isFinite(video.duration) ? video.duration * 1000 : 0;
    const start = Math.max(0, Math.min(startMs, duration));
    const end = Math.max(start, Math.min(endMs, duration));
    if (end - start < 500) throw new Error('Choose a clip that is at least half a second long.');

    const capture = captureVideo.captureStream ?? captureVideo.mozCaptureStream;
    if (!capture) throw new Error('This browser cannot trim videos. Use a current version of Chrome, Edge, or Firefox.');
    stream = capture.call(video);
    const sourceType = source.type && MediaRecorder.isTypeSupported(source.type) ? source.type : undefined;
    const mimeType = format ? pickTrimMimeType(format) : sourceType ?? pickTrimMimeType();
    if (!mimeType) throw new Error('This browser cannot encode a trimmed video.');

    const recorder = new MediaRecorder(stream, { mimeType });
    const chunks: Blob[] = [];
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        video.removeEventListener('timeupdate', stopAtEnd);
        if (error) {
          if (recorder.state !== 'inactive') {
            try { recorder.stop(); } catch { /* failure is already being reported */ }
          }
          reject(error);
        }
        else resolve();
      };
      const stopAtEnd = () => {
        if (video.currentTime * 1000 >= end) {
          video.pause();
          if (recorder.state !== 'inactive') recorder.stop();
        }
      };
      const timeout = window.setTimeout(() => {
        if (recorder.state !== 'inactive') recorder.stop();
        finish(new Error('Trimming took too long. Please try a shorter clip.'));
      }, Math.max(15_000, end - start + 10_000));

      recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      recorder.onerror = () => finish(new Error('Could not encode the trimmed video.'));
      recorder.onstop = () => finish();
      video.addEventListener('timeupdate', stopAtEnd);
      const begin = () => {
        try {
          recorder.start(500);
          void video.play().catch(() => finish(new Error('Could not play this video for trimming.')));
        } catch {
          finish(new Error('Could not start video trimming.'));
        }
      };
      video.onseeked = begin;
      if (start === 0) begin();
      else video.currentTime = start / 1000;
    });

    const result = new Blob(chunks, { type: mimeType.split(';')[0] });
    if (!result.size) throw new Error('The trimmed video is empty. Try different trim points.');
    return result;
  } finally {
    stream?.getTracks().forEach((track) => track.stop());
    video.pause();
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(sourceUrl);
  }
}

function pickTrimMimeType(format?: 'webm' | 'mp4'): string | undefined {
  const webm = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  const mp4 = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4'];
  const choices = format === 'mp4' ? mp4 : format === 'webm' ? webm : [...mp4, ...webm];
  return choices.find((type) => MediaRecorder.isTypeSupported(type));
}
