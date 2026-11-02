import { getVideo, type RecordingMeta } from './db';

export async function downloadRecording(m: RecordingMeta) {
  const blob = await getVideo(m.id);
  if (!blob) return;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${m.title.replace(/[\\/:*?"<>|]+/g, '-')}.${m.mimeType.includes('mp4') ? 'mp4' : 'webm'}`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}