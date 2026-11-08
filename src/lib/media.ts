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

/** Joins selected ranges from a local video into one continuous edited recording. */
export async function stitchVideoSegments(source: Blob, ranges: { startMs: number; endMs: number }[]): Promise<Blob> {
  if (!ranges.length) throw new Error('Add at least one clip to the edit first.');
  const sourceUrl = URL.createObjectURL(source);
  const video = document.createElement('video');
  video.preload = 'auto';
  video.playsInline = true;
  const captureVideo = video as HTMLVideoElement & { captureStream?: () => MediaStream; mozCaptureStream?: () => MediaStream };
  let stream: MediaStream | null = null;
  let recorder: MediaRecorder | null = null;
  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error('Could not read this video for editing.'));
      video.src = sourceUrl;
    });
    const durationMs = Number.isFinite(video.duration) ? Math.round(video.duration * 1000) : 0;
    const clips = ranges.map(({ startMs, endMs }) => ({
      startMs: Math.max(0, Math.min(Math.round(startMs), durationMs)),
      endMs: Math.max(0, Math.min(Math.round(endMs), durationMs)),
    })).sort((a, b) => a.startMs - b.startMs);
    if (clips.some((clip) => clip.endMs - clip.startMs < 500)) throw new Error('Each kept clip must be at least half a second long.');
    if (clips.length > 20) throw new Error('An edit can contain up to 20 clips.');

    const capture = captureVideo.captureStream ?? captureVideo.mozCaptureStream;
    if (!capture) throw new Error('This browser cannot create multi-clip edits. Use a current version of Chrome, Edge, or Firefox.');
    stream = capture.call(video);
    const mimeType = source.type && MediaRecorder.isTypeSupported(source.type) ? source.type : pickTrimMimeType();
    if (!mimeType) throw new Error('This browser cannot encode the edited video.');
    recorder = new MediaRecorder(stream, { mimeType });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        video.pause();
        if (recorder?.state !== 'inactive') recorder?.stop();
        reject(error);
      };
      recorder!.onerror = () => fail(new Error('Could not encode the edited video.'));
      recorder!.onstop = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      const seekTo = (timeMs: number) => new Promise<void>((seekResolve, seekReject) => {
        if (Math.abs(video.currentTime * 1000 - timeMs) < 50) { seekResolve(); return; }
        const timeout = window.setTimeout(() => { cleanup(); seekReject(new Error('The video could not seek to an edit point.')); }, 10_000);
        const cleanup = () => { window.clearTimeout(timeout); video.removeEventListener('seeked', onSeeked); video.removeEventListener('error', onError); };
        const onSeeked = () => { cleanup(); seekResolve(); };
        const onError = () => { cleanup(); seekReject(new Error('The video could not seek to an edit point.')); };
        video.addEventListener('seeked', onSeeked, { once: true });
        video.addEventListener('error', onError, { once: true });
        video.currentTime = timeMs / 1000;
      });
      const playClip = (clip: { startMs: number; endMs: number }) => new Promise<void>((clipResolve, clipReject) => {
        const timeout = window.setTimeout(() => { cleanup(); clipReject(new Error('The edit took too long. Try shorter clips.')); }, Math.max(15_000, clip.endMs - clip.startMs + 10_000));
        const cleanup = () => { window.clearTimeout(timeout); video.removeEventListener('timeupdate', onTime); video.removeEventListener('error', onError); };
        const onTime = () => {
          if (video.currentTime * 1000 < clip.endMs) return;
          cleanup();
          video.pause();
          if (recorder!.state === 'recording') recorder!.pause();
          clipResolve();
        };
        const onError = () => { cleanup(); clipReject(new Error('A selected video clip could not be played.')); };
        video.addEventListener('timeupdate', onTime);
        video.addEventListener('error', onError, { once: true });
        if (recorder!.state === 'paused') recorder!.resume();
        void video.play().catch(() => { cleanup(); clipReject(new Error('Could not play a selected clip for editing.')); });
      });

      const recordClips = async () => {
        try {
          recorder!.start(500);
          recorder!.pause();
          for (const clip of clips) {
            await seekTo(clip.startMs);
            await playClip(clip);
          }
          if (recorder!.state !== 'inactive') recorder!.stop();
        } catch (error) {
          fail(error instanceof Error ? error : new Error('Could not create this edit.'));
        }
      };
      void recordClips();
    });
    const result = new Blob(chunks, { type: mimeType.split(';')[0] });
    if (!result.size) throw new Error('The edited video is empty. Try different clips.');
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
