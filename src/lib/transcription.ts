export interface TranscriptionProgress {
  segment: number;
  startMs: number;
}

export async function transcribeMediaAudio(
  sourceUrl: string,
  signal: AbortSignal,
  onSegment: (audio: Blob, startMs: number, durationMs: number) => Promise<void>,
  onProgress: (progress: TranscriptionProgress) => void,
): Promise<void> {
  if (!sourceUrl) throw new Error('The video is not ready for transcription yet.');
  if (!window.MediaRecorder || !window.AudioContext) throw new Error('Audio transcription playback is not supported in this browser. Try Chrome or Edge.');

  const audioContext = new AudioContext();
  const video = document.createElement('video');
  if (!sourceUrl.startsWith('blob:') && !sourceUrl.startsWith('data:')) video.crossOrigin = 'anonymous';
  video.preload = 'auto';
  video.playsInline = true;
  video.setAttribute('aria-hidden', 'true');
  Object.assign(video.style, { position: 'fixed', width: '1px', height: '1px', opacity: '0', pointerEvents: 'none', left: '-2px', top: '-2px' });
  video.src = sourceUrl;
  document.body.append(video);

  let recorder: MediaRecorder | null = null;
  let finishedPlayback = false;
  let previousEndMs = 0;
  let segmentNumber = 0;
  let processing = Promise.resolve();
  let abortHandler: (() => void) | null = null;

  try {
    const source = audioContext.createMediaElementSource(video);
    const destination = audioContext.createMediaStreamDestination();
    source.connect(destination);
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '';
    if (!mimeType) throw new Error('This browser cannot create the audio format required for transcription.');
    recorder = new MediaRecorder(destination.stream, { mimeType, audioBitsPerSecond: 48_000 });

    const stopped = new Promise<void>((resolve, reject) => {
      const fail = (error: unknown) => {
        finishedPlayback = true;
        video.pause();
        if (recorder && recorder.state !== 'inactive') recorder.stop();
        reject(error instanceof Error ? error : new Error('Audio transcription failed.'));
      };
      recorder!.onerror = () => fail(new Error('The browser could not capture this recording’s audio.'));
      video.addEventListener('error', () => fail(new Error('Could not read this recording’s audio.')), { once: true });
      recorder!.ondataavailable = (event) => {
        if (!event.data.size || signal.aborted) return;
        const endMs = Math.max(previousEndMs, Math.min(video.currentTime * 1000, Number.isFinite(video.duration) ? video.duration * 1000 : Infinity));
        const startMs = previousEndMs;
        const durationMs = Math.max(0, Math.round(endMs - startMs));
        if (!finishedPlayback && recorder!.state === 'recording') {
          recorder!.pause();
          video.pause();
        }
        processing = processing.then(async () => {
          if (durationMs > 0) {
            segmentNumber += 1;
            onProgress({ segment: segmentNumber, startMs });
            await onSegment(event.data, Math.round(startMs), durationMs);
            previousEndMs = endMs;
          }
          if (!finishedPlayback && !signal.aborted) {
            recorder!.resume();
            await video.play();
          }
        }).catch(fail);
      };
      recorder!.onstop = () => { void processing.then(resolve, reject); };
      video.addEventListener('ended', () => {
        finishedPlayback = true;
        if (recorder!.state !== 'inactive') recorder!.stop();
      }, { once: true });
      abortHandler = () => fail(new DOMException('Transcription cancelled.', 'AbortError'));
      signal.addEventListener('abort', abortHandler, { once: true });
    });

    const resumeAudio = audioContext.resume();
    recorder.start(60_000);
    const playAudio = video.play();
    await Promise.all([resumeAudio, playAudio]);
    await stopped;
    if (!segmentNumber) throw new Error('No audio segments were captured from this recording.');
  } finally {
    if (abortHandler) signal.removeEventListener('abort', abortHandler);
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    video.pause();
    video.removeAttribute('src');
    video.load();
    video.remove();
    await audioContext.close().catch(() => {});
  }
}
