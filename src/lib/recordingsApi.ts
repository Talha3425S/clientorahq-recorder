import type { RecordingMeta } from './db';

interface CloudRecording {
  id: string;
  title: string;
  mimeType: string;
  sizeBytes: number | string;
  durationMs: number;
  status: string;
  createdAt: string;
  updatedAt: string;
}

interface ApiError {
  error?: { message?: string };
}

async function readJson<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({})) as T & ApiError;
  if (!response.ok) throw new Error(body.error?.message || 'The cloud recording request failed.');
  return body;
}

export function toCloudMeta(recording: CloudRecording): RecordingMeta {
  return {
    id: recording.id,
    title: recording.title,
    createdAt: new Date(recording.createdAt).getTime(),
    durationMs: recording.durationMs,
    mimeType: recording.mimeType,
    size: Number(recording.sizeBytes),
    thumb: null,
    archived: false,
    source: 'uploaded',
    cloudId: recording.id,
    isCloud: true,
  };
}

export async function listCloudRecordings(): Promise<RecordingMeta[]> {
  const response = await fetch('/api/v1/recordings', { credentials: 'same-origin' });
  const data = await readJson<{ recordings: CloudRecording[] }>(response);
  return data.recordings.filter((recording) => recording.status === 'ready').map(toCloudMeta);
}

export async function uploadRecordingToCloud(meta: RecordingMeta, blob: Blob): Promise<RecordingMeta> {
  let cloudId: string | undefined;
  try {
    const createResponse = await fetch('/api/v1/recordings', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: meta.title,
        mimeType: meta.mimeType || blob.type || 'video/webm',
        sizeBytes: blob.size,
        durationMs: meta.durationMs,
      }),
    });
    const created = await readJson<{
      recording: CloudRecording;
      upload: { method: 'PUT'; url: string; headers: Record<string, string> };
    }>(createResponse);
    cloudId = created.recording.id;

    const uploadResponse = await fetch(created.upload.url, {
      method: created.upload.method,
      headers: created.upload.headers,
      body: blob,
    });
    if (!uploadResponse.ok) throw new Error(`Cloud storage rejected the upload (${uploadResponse.status}).`);

    const completeResponse = await fetch(`/api/v1/recordings/${cloudId}/complete`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    await readJson<{ status: 'ready' }>(completeResponse);
    return toCloudMeta({ ...created.recording, status: 'ready' });
  } catch (error) {
    if (cloudId) await fetch(`/api/v1/recordings/${cloudId}`, { method: 'DELETE', credentials: 'same-origin' }).catch(() => {});
    throw error;
  }
}

export async function renameCloudRecording(id: string, title: string): Promise<void> {
  const response = await fetch(`/api/v1/recordings/${id}`, {
    method: 'PATCH',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  });
  await readJson(response);
}

export async function deleteCloudRecording(id: string): Promise<void> {
  const response = await fetch(`/api/v1/recordings/${id}`, { method: 'DELETE', credentials: 'same-origin' });
  if (!response.ok) await readJson(response);
}

export async function getCloudPlaybackUrl(id: string): Promise<string> {
  const response = await fetch(`/api/v1/recordings/${id}`, { credentials: 'same-origin' });
  const data = await readJson<{ download: { url: string } }>(response);
  return data.download.url;
}

export async function downloadCloudRecording(id: string): Promise<string> {
  const response = await fetch(`/api/v1/recordings/${id}/download`, { credentials: 'same-origin' });
  const data = await readJson<{ download: { url: string } }>(response);
  return data.download.url;
}
