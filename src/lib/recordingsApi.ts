import type { RecordingComment, RecordingMeta, ScreenshotMeta, TranscriptCue } from './db';

interface CloudRecording {
  id: string;
  title: string;
  mimeType: string;
  source?: 'recorded' | 'meeting' | 'uploaded';
  access?: 'private' | 'workspace';
  archived?: boolean;
  viewCount?: number | string;
  canManage?: boolean;
  comments?: Array<Omit<RecordingComment, 'createdAt'> & { createdAt: string | number }>;
  reactions?: Record<string, number>;
  myReactions?: string[];
  transcript?: TranscriptCue[];
  spaceIds?: string[];
  folderId?: string | null;
  folderName?: string | null;
  sizeBytes: number | string;
  durationMs: number;
  status: string;
  createdAt: string;
  updatedAt: string;
  thumb?: string | null;
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
    thumb: recording.thumb ?? null,
    archived: recording.archived ?? false,
    viewCount: Number(recording.viewCount ?? 0),
    source: recording.source ?? 'uploaded',
    access: recording.access ?? 'private',
    canManage: recording.canManage ?? true,
    comments: recording.comments?.map((comment) => ({ ...comment, createdAt: new Date(comment.createdAt).getTime() })) ?? [],
    reactions: recording.reactions ?? {},
    myReactions: recording.myReactions ?? [],
    reactionCount: recording.reactions?.['👍'] ?? 0,
    reacted: (recording.myReactions ?? []).includes('👍'),
    transcript: recording.transcript ?? [],
    spaceIds: recording.spaceIds ?? [],
    folderId: recording.folderId ?? null,
    folderName: recording.folderName ?? null,
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
    const thumbnailBlob = meta.thumb?.startsWith('data:image/gif,') || meta.thumb?.startsWith('data:image/gif;base64,')
      ? await fetch(meta.thumb).then((response) => response.blob())
      : null;
    const usableThumbnail = thumbnailBlob && thumbnailBlob.size <= 512 * 1024 ? thumbnailBlob : null;
    const createResponse = await fetch('/api/v1/recordings', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: meta.title,
        mimeType: meta.mimeType || blob.type || 'video/webm',
        source: meta.source ?? 'uploaded',
        sizeBytes: blob.size,
        durationMs: meta.durationMs,
        transcript: meta.transcript ?? [],
        ...(usableThumbnail && { thumbnailSizeBytes: usableThumbnail.size, thumbnailMimeType: 'image/gif' }),
      }),
    });
    const created = await readJson<{
      recording: CloudRecording;
      upload: { method: 'PUT'; url: string; headers: Record<string, string> };
      thumbnailUpload?: { method: 'PUT'; url: string; headers: Record<string, string> };
    }>(createResponse);
    cloudId = created.recording.id;

    const uploadResponse = await fetch(created.upload.url, {
      method: created.upload.method,
      headers: created.upload.headers,
      body: blob,
    });
    if (!uploadResponse.ok) throw new Error(`Cloud storage rejected the upload (${uploadResponse.status}).`);

    if (usableThumbnail && created.thumbnailUpload) {
      const thumbnailResponse = await fetch(created.thumbnailUpload.url, {
        method: created.thumbnailUpload.method,
        headers: created.thumbnailUpload.headers,
        body: usableThumbnail,
      });
      if (!thumbnailResponse.ok) throw new Error(`Cloud storage rejected the animated thumbnail (${thumbnailResponse.status}).`);
    }

    const completeResponse = await fetch(`/api/v1/recordings/${cloudId}/complete`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    await readJson<{ status: 'ready' }>(completeResponse);
    return toCloudMeta({ ...created.recording, status: 'ready', canManage: true, transcript: meta.transcript ?? [] });
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

export async function updateCloudRecording(id: string, update: { access?: 'private' | 'workspace'; archived?: boolean }): Promise<CloudRecording> {
  const response = await fetch(`/api/v1/recordings/${id}`, {
    method: 'PATCH',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(update),
  });
  const data = await readJson<{ recording: CloudRecording }>(response);
  return data.recording;
}

export async function transferCloudRecordingOwnership(id: string, memberId: string): Promise<void> {
  const response = await fetch(`/api/v1/recordings/${id}/transfer`, {
    method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ memberId }),
  });
  await readJson(response);
}

export async function shareCloudRecordingToSlack(id: string, shareUrl: string): Promise<void> {
  const response = await fetch(`/api/v1/recordings/${id}/slack-share`, {
    method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ shareUrl }),
  });
  await readJson(response);
}

export async function deleteCloudRecording(id: string): Promise<void> {
  const response = await fetch(`/api/v1/recordings/${id}`, { method: 'DELETE', credentials: 'same-origin' });
  if (!response.ok) await readJson(response);
}

export async function getCloudPlaybackUrl(id: string): Promise<{ url: string; recording: RecordingMeta }> {
  const response = await fetch(`/api/v1/recordings/${id}`, { credentials: 'same-origin' });
  const data = await readJson<{ recording: CloudRecording; download: { url: string } }>(response);
  return { url: data.download.url, recording: toCloudMeta(data.recording) };
}

export async function getCloudPreviewUrl(id: string): Promise<string> {
  const response = await fetch(`/api/v1/recordings/${id}/preview`, { credentials: 'same-origin' });
  return (await readJson<{ preview: { url: string } }>(response)).preview.url;
}

export async function getCloudThumbnailUrl(id: string): Promise<string> {
  const response = await fetch(`/api/v1/recordings/${id}/thumbnail`, { credentials: 'same-origin' });
  return (await readJson<{ thumbnail: { url: string } }>(response)).thumbnail.url;
}

export async function createCloudComment(id: string, text: string): Promise<RecordingComment> {
  const response = await fetch(`/api/v1/recordings/${id}/comments`, {
    method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }),
  });
  const data = await readJson<{ comment: Omit<RecordingComment, 'createdAt'> & { createdAt: string | number } }>(response);
  return { ...data.comment, createdAt: new Date(data.comment.createdAt).getTime() };
}

export async function setCloudReaction(id: string, emoji: string, active: boolean): Promise<Pick<RecordingMeta, 'reactions' | 'myReactions' | 'reactionCount' | 'reacted'>> {
  const response = await fetch(`/api/v1/recordings/${id}/reactions/${encodeURIComponent(emoji)}`, {
    method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active }),
  });
  return readJson<Pick<RecordingMeta, 'reactions' | 'myReactions' | 'reactionCount' | 'reacted'>>(response);
}

export async function setCloudRecordingSpaces(id: string, spaceIds: string[]): Promise<void> {
  const response = await fetch(`/api/v1/recordings/${id}/spaces`, {
    method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ spaceIds }),
  });
  await readJson(response);
}

export async function setCloudRecordingFolder(id: string, folderId: string | null): Promise<CloudRecording> {
  const response = await fetch(`/api/v1/recordings/${id}`, {
    method: 'PATCH', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ folderId }),
  });
  const data = await readJson<{ recording: CloudRecording }>(response);
  return data.recording;
}

export interface CloudSpace {
  id: string;
  name: string;
  privacy: 'open' | 'closed';
  members: string;
  recordingIds?: string[];
}

export async function listCloudSpaces(): Promise<CloudSpace[]> {
  const response = await fetch('/api/v1/workspace/spaces', { credentials: 'same-origin' });
  const data = await readJson<{ spaces: CloudSpace[] }>(response);
  return data.spaces;
}

export interface CloudFolder {
  id: string;
  name: string;
}

export async function listCloudFolders(): Promise<CloudFolder[]> {
  const response = await fetch('/api/v1/workspace/folders', { credentials: 'same-origin' });
  const data = await readJson<{ folders: CloudFolder[] }>(response);
  return data.folders;
}

export async function createCloudFolder(name: string): Promise<CloudFolder> {
  const response = await fetch('/api/v1/workspace/folders', {
    method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
  });
  const data = await readJson<{ folder: CloudFolder }>(response);
  return data.folder;
}

export interface CloudInsights {
  days: 30 | 90;
  totalViews: number;
  totalVideos: number;
  series: { date: string; views: number; videos: number }[];
}

export async function getCloudInsights(days: 30 | 90): Promise<CloudInsights> {
  const response = await fetch(`/api/v1/workspace/insights?days=${days}`, { credentials: 'same-origin' });
  return readJson<CloudInsights>(response);
}

export async function listCloudScreenshots(): Promise<ScreenshotMeta[]> {
  const screenshots: Array<ScreenshotMeta & { createdAt: string | number; size: string | number }> = [];
  let cursor: { createdAt: string | number; id: string } | null = null;
  do {
    const query = new URLSearchParams();
    if (cursor) {
      query.set('cursorCreatedAt', new Date(cursor.createdAt).toISOString());
      query.set('cursorId', cursor.id);
    }
    const suffix = cursor ? `?${query.toString()}` : '';
    const response = await fetch(`/api/v1/screenshots${suffix}`, { credentials: 'same-origin' });
    const data = await readJson<{
      screenshots: Array<ScreenshotMeta & { createdAt: string | number; size: string | number }>;
      nextCursor: { createdAt: string | number; id: string } | null;
    }>(response);
    screenshots.push(...data.screenshots);
    cursor = data.nextCursor;
  } while (cursor);
  return screenshots.map((screenshot) => ({
    ...screenshot,
    createdAt: new Date(screenshot.createdAt).getTime(),
    size: Number(screenshot.size),
    cloudUrl: screenshot.cloudUrl ?? screenshot.preview,
    isCloud: true,
  }));
}

export async function saveCloudScreenshot(recordingId: string, title: string, blob: Blob): Promise<ScreenshotMeta> {
  const response = await fetch(`/api/v1/recordings/${recordingId}/screenshots`, {
    method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, sizeBytes: blob.size }),
  });
  const created = await readJson<{ id: string; upload: { method: 'PUT'; url: string; headers: Record<string, string> } }>(response);
  try {
    const upload = await fetch(created.upload.url, { method: created.upload.method, headers: created.upload.headers, body: blob });
    if (!upload.ok) throw new Error(`Cloud storage rejected the screenshot (${upload.status}).`);
    const completed = await fetch(`/api/v1/screenshots/${created.id}/complete`, { method: 'POST', credentials: 'same-origin' });
    const completedData = await readJson<{ download: { url: string } }>(completed);
    return {
      id: created.id, recordingId, title, createdAt: Date.now(), size: blob.size,
      preview: completedData.download.url, cloudUrl: completedData.download.url, isCloud: true,
    };
  } catch (error) {
    await deleteCloudScreenshot(created.id).catch(() => {});
    throw error;
  }
}

export async function deleteCloudScreenshot(id: string): Promise<void> {
  const response = await fetch(`/api/v1/screenshots/${id}`, { method: 'DELETE', credentials: 'same-origin' });
  if (!response.ok) await readJson(response);
}

export async function listCloudWatchLater(): Promise<string[]> {
  const response = await fetch('/api/v1/watch-later', { credentials: 'same-origin' });
  return (await readJson<{ recordingIds: string[] }>(response)).recordingIds;
}

export async function setCloudWatchLater(recordingId: string, active: boolean): Promise<void> {
  const response = await fetch('/api/v1/watch-later', {
    method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recordingId, active }),
  });
  await readJson(response);
}

export async function getCloudWorkspaceSettings(): Promise<{ allowPublicLinks: boolean; allowMeetingRecordings: boolean; canManage: boolean; canChangeDefaults: boolean }> {
  const response = await fetch('/api/v1/workspace/settings', { credentials: 'same-origin' });
  return (await readJson<{ settings: { allowPublicLinks: boolean; allowMeetingRecordings: boolean; canManage: boolean; canChangeDefaults: boolean } }>(response)).settings;
}

export async function setCloudAllowPublicLinks(allowPublicLinks: boolean): Promise<void> {
  const response = await fetch('/api/v1/workspace/settings', {
    method: 'PATCH', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ allowPublicLinks }),
  });
  await readJson(response);
}

export async function setCloudMeetingRecordingsEnabled(enabled: boolean): Promise<void> {
  const response = await fetch('/api/v1/workspace/settings', {
    method: 'PATCH', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ allowMeetingRecordings: enabled }),
  });
  await readJson(response);
}

export async function createCloudShareLink(recordingId: string): Promise<string> {
  const response = await fetch(`/api/v1/recordings/${recordingId}/share`, { method: 'POST', credentials: 'same-origin' });
  return (await readJson<{ url: string }>(response)).url;
}

export async function revokeCloudShareLink(recordingId: string): Promise<void> {
  const response = await fetch(`/api/v1/recordings/${recordingId}/share`, { method: 'DELETE', credentials: 'same-origin' });
  await readJson(response);
}

export async function getPublicShare(token: string): Promise<{ recording: { title: string; mimeType: string; durationMs: number; transcript: TranscriptCue[] }; url: string }> {
  const response = await fetch(`/api/v1/share/${encodeURIComponent(token)}`, { credentials: 'omit' });
  const data = await readJson<{ recording: { title: string; mimeType: string; durationMs: number; transcript?: TranscriptCue[] }; download: { url: string } }>(response);
  return { recording: { ...data.recording, transcript: data.recording.transcript ?? [] }, url: data.download.url };
}

export async function createCloudSpace(space: Pick<CloudSpace, 'name' | 'privacy'> & { members?: string }): Promise<CloudSpace> {
  const response = await fetch('/api/v1/workspace/spaces', {
    method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...space, members: space.members?.split(',').map((name) => name.trim()).filter(Boolean) ?? [] }),
  });
  const data = await readJson<{ space: CloudSpace }>(response);
  return data.space;
}

export async function addCloudTranscriptCue(id: string, startMs: number, text: string): Promise<TranscriptCue> {
  const response = await fetch(`/api/v1/recordings/${id}/transcript`, {
    method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ startMs, text }),
  });
  const data = await readJson<{ cue: TranscriptCue }>(response);
  return data.cue;
}

export async function deleteCloudTranscriptCue(id: string, cueId: string): Promise<void> {
  const response = await fetch(`/api/v1/recordings/${id}/transcript/${cueId}`, { method: 'DELETE', credentials: 'same-origin' });
  if (!response.ok) await readJson(response);
}

export async function downloadCloudRecording(id: string): Promise<string> {
  const response = await fetch(`/api/v1/recordings/${id}/download`, { credentials: 'same-origin' });
  const data = await readJson<{ download: { url: string } }>(response);
  return data.download.url;
}
