import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { ChunkSink } from './sink';
import { makeThumbnail } from './thumbnail';

export interface RecordingMeta {
  id: string;
  title: string;
  createdAt: number;
  durationMs: number;
  mimeType: string;
  size: number;
  thumb: string | null; // data URL, so there is no blob URL to manage
  archived?: boolean;
  access?: 'private' | 'workspace';
  source?: 'recorded' | 'uploaded' | 'meeting';
  lastViewedAt?: number;
  viewCount?: number;
  viewEvents?: number[];
  spaceIds?: string[];
  folderId?: string | null;
  folderName?: string | null;
  cloudId?: string;
  isCloud?: boolean;
  canManage?: boolean;
  reacted?: boolean;
  reactionCount?: number;
  reactions?: Record<string, number>;
  myReactions?: string[];
  comments?: RecordingComment[];
  transcript?: TranscriptCue[];
}

export interface RecordingComment {
  id: string;
  text: string;
  createdAt: number;
  author: string;
}

export interface TranscriptCue {
  id: string;
  startMs: number;
  text: string;
}

export interface ScreenshotMeta {
  id: string;
  recordingId: string;
  title: string;
  createdAt: number;
  size: number;
  preview: string;
  cloudUrl?: string;
  isCloud?: boolean;
}

export class RecordingLimitError extends Error {
  constructor(limit: number) {
    super(`This plan allows up to ${limit} saved videos. Delete a video or upgrade your plan to record another.`);
    this.name = 'RecordingLimitError';
  }
}

interface Schema extends DBSchema {
  meta: { key: string; value: RecordingMeta; indexes: { 'by-date': number } };
  videos: { key: string; value: Blob };
  chunks: { key: [string, number]; value: Blob }; // [recording id, chunk index]
  screenshots: { key: string; value: ScreenshotMeta; indexes: { 'by-date': number } };
  screenshotBlobs: { key: string; value: Blob };
}

let dbPromise: Promise<IDBPDatabase<Schema>> | null = null;

export const getDb = () =>
  (dbPromise ??= openDB<Schema>('clientorahq-recorder', 3, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        db.createObjectStore('meta', { keyPath: 'id' }).createIndex('by-date', 'createdAt');
        db.createObjectStore('videos');
        db.createObjectStore('chunks');
      }
      if (oldVersion < 3) {
        db.createObjectStore('screenshots', { keyPath: 'id' }).createIndex('by-date', 'createdAt');
        db.createObjectStore('screenshotBlobs');
      }
    },
  }));

const chunkRange = (id: string) => IDBKeyRange.bound([id, 0], [id, Infinity]);

async function clearChunks(id: string) {
  await (await getDb()).delete('chunks', chunkRange(id));
}

/** Writes every MediaRecorder chunk to IndexedDB as it arrives, so a long take is not held in memory. */
export class IdbSink implements ChunkSink {
  readonly id = crypto.randomUUID();
  private n = 0;
  private queue: Promise<void> = Promise.resolve();
  private error: unknown = null;

  add(chunk: Blob) {
    const i = this.n++;
    this.queue = this.queue.then(async () => {
      if (this.error) return;
      try {
        await (await getDb()).put('chunks', chunk, [this.id, i]);
      } catch (e) {
        this.error = e; // usually quota; reported when the recording finishes
      }
    });
  }

  async finish(type: string) {
    await this.queue;
    if (this.error) throw this.error;
    const parts = await (await getDb()).getAll('chunks', chunkRange(this.id));
    return new Blob(parts, { type });
  }

  async discard() {
    await this.queue;
    await clearChunks(this.id);
  }
}

export async function saveRecording(
  r: { id: string; blob: Blob; durationMs: number; mimeType: string; source?: RecordingMeta['source']; transcript?: TranscriptCue[] },
  title?: string,
  maxVideos = Infinity,
): Promise<RecordingMeta> {
  const createdAt = Date.now();
  const meta: RecordingMeta = {
    id: r.id,
    title: title?.trim() || `Recording ${new Date(createdAt).toLocaleString()}`,
    createdAt,
    durationMs: r.durationMs,
    mimeType: r.mimeType,
    size: r.blob.size,
    thumb: await makeThumbnail(r.blob),
    archived: false,
    source: r.source ?? 'recorded',
    transcript: r.transcript ?? [],
  };
  const db = await getDb();
  const tx = db.transaction(['meta', 'videos'], 'readwrite');
  try {
    const metaStore = tx.objectStore('meta');
    const savedMetadata = await metaStore.getAll();
    const currentCount = savedMetadata.filter((entry) => entry.source !== 'meeting').length;
    if (currentCount >= maxVideos) {
      tx.abort();
      throw new RecordingLimitError(maxVideos);
    }
    await Promise.all([metaStore.put(meta), tx.objectStore('videos').put(r.blob, r.id), tx.done]);
    return meta;
  } catch (error) {
    await tx.done.catch(() => undefined);
    throw error;
  } finally {
    await clearChunks(r.id);
  }
}

export async function listRecordings(): Promise<RecordingMeta[]> {
  return (await (await getDb()).getAllFromIndex('meta', 'by-date')).reverse(); // newest first
}

export async function getVideo(id: string) {
  return (await getDb()).get('videos', id);
}

export async function renameRecording(id: string, title: string) {
  const db = await getDb();
  const meta = await db.get('meta', id);
  if (meta) await db.put('meta', { ...meta, title });
}

export async function setRecordingCloudId(id: string, cloudId: string) {
  const db = await getDb();
  const meta = await db.get('meta', id);
  if (!meta) throw new Error('This recording is no longer in the library.');
  await db.put('meta', { ...meta, cloudId });
}

export async function setRecordingArchived(id: string, archived: boolean) {
  const db = await getDb();
  const meta = await db.get('meta', id);
  if (!meta) throw new Error('This recording is no longer in the library.');
  const updated = { ...meta, archived };
  await db.put('meta', updated);
  return updated;
}

export async function setRecordingAccess(id: string, access: 'private' | 'workspace') {
  const db = await getDb();
  const meta = await db.get('meta', id);
  if (!meta) throw new Error('This recording is no longer in the library.');
  const updated = { ...meta, access };
  await db.put('meta', updated);
  return updated;
}

export async function setRecordingSpaces(id: string, spaceIds: string[]) {
  const db = await getDb();
  const meta = await db.get('meta', id);
  if (!meta) throw new Error('This recording is no longer in the library.');
  const updated = { ...meta, spaceIds: [...new Set(spaceIds)] };
  await db.put('meta', updated);
  return updated;
}

export async function setRecordingFolder(id: string, folderName: string | null, folderId?: string | null) {
  const db = await getDb();
  const meta = await db.get('meta', id);
  if (!meta) throw new Error('This recording is no longer in the library.');
  const updated = { ...meta, folderName, folderId: folderId ?? null };
  await db.put('meta', updated);
  return updated;
}

export async function markRecordingViewed(id: string) {
  const db = await getDb();
  const meta = await db.get('meta', id);
  if (!meta) return;
  const viewedAt = Date.now();
  const updated = { ...meta, lastViewedAt: viewedAt, viewCount: (meta.viewCount ?? 0) + 1, viewEvents: [...(meta.viewEvents ?? []), viewedAt].slice(-1000) };
  await db.put('meta', updated);
  return updated;
}

export async function setRecordingReaction(id: string, reacted: boolean) {
  const db = await getDb();
  const meta = await db.get('meta', id);
  if (!meta) throw new Error('This recording is no longer in the library.');
  const reactionCount = Math.max(0, (meta.reactionCount ?? 0) + (reacted ? 1 : -1));
  const updated = { ...meta, reacted, reactionCount };
  await db.put('meta', updated);
  return updated;
}

export async function setRecordingEmojiReaction(id: string, emoji: string, reacted: boolean) {
  const db = await getDb();
  const meta = await db.get('meta', id);
  if (!meta) throw new Error('This recording is no longer in the library.');
  const reactions = { ...(meta.reactions ?? {}) };
  const myReactions = new Set(meta.myReactions ?? (meta.reacted ? ['👍'] : []));
  const count = Math.max(0, (reactions[emoji] ?? (emoji === '👍' ? meta.reactionCount ?? 0 : 0)) + (reacted ? 1 : -1));
  if (count) reactions[emoji] = count;
  else delete reactions[emoji];
  if (reacted) myReactions.add(emoji);
  else myReactions.delete(emoji);
  const updated = { ...meta, reactions, myReactions: [...myReactions], reacted: myReactions.has('👍'), reactionCount: reactions['👍'] ?? 0 };
  await db.put('meta', updated);
  return updated;
}

export async function addRecordingComment(id: string, text: string) {
  const db = await getDb();
  const meta = await db.get('meta', id);
  if (!meta) throw new Error('This recording is no longer in the library.');
  const comment: RecordingComment = { id: crypto.randomUUID(), text, author: 'You', createdAt: Date.now() };
  const updated = { ...meta, comments: [...(meta.comments ?? []), comment] };
  await db.put('meta', updated);
  return updated;
}

export async function addTranscriptCue(id: string, startMs: number, text: string) {
  const db = await getDb();
  const meta = await db.get('meta', id);
  if (!meta) throw new Error('This recording is no longer in the library.');
  const cue: TranscriptCue = { id: crypto.randomUUID(), startMs: Math.max(0, Math.round(startMs)), text };
  const updated = { ...meta, transcript: [...(meta.transcript ?? []), cue].sort((a, b) => a.startMs - b.startMs) };
  await db.put('meta', updated);
  return updated;
}

export async function deleteTranscriptCue(id: string, cueId: string) {
  const db = await getDb();
  const meta = await db.get('meta', id);
  if (!meta) throw new Error('This recording is no longer in the library.');
  const updated = { ...meta, transcript: (meta.transcript ?? []).filter((cue) => cue.id !== cueId) };
  await db.put('meta', updated);
  return updated;
}

export async function replaceRecordingVideo(id: string, blob: Blob, durationMs: number, mimeType: string) {
  const db = await getDb();
  const existing = await db.get('meta', id);
  if (!existing) throw new Error('This recording is no longer in the library.');
  const updated: RecordingMeta = {
    ...existing,
    durationMs,
    mimeType,
    size: blob.size,
    thumb: await makeThumbnail(blob),
  };
  const tx = db.transaction(['meta', 'videos'], 'readwrite');
  await Promise.all([tx.objectStore('meta').put(updated), tx.objectStore('videos').put(blob, id), tx.done]);
  return updated;
}

export async function deleteRecording(id: string) {
  const db = await getDb();
  const related = (await db.getAllFromIndex('screenshots', 'by-date')).filter((shot) => shot.recordingId === id);
  const tx = db.transaction(['meta', 'videos', 'screenshots', 'screenshotBlobs'], 'readwrite');
  await Promise.all([
    tx.objectStore('meta').delete(id),
    tx.objectStore('videos').delete(id),
    ...related.flatMap((shot) => [tx.objectStore('screenshots').delete(shot.id), tx.objectStore('screenshotBlobs').delete(shot.id)]),
    tx.done,
  ]);
}

export async function saveScreenshot(recordingId: string, title: string, blob: Blob, preview: string) {
  const db = await getDb();
  const screenshot: ScreenshotMeta = { id: crypto.randomUUID(), recordingId, title, createdAt: Date.now(), size: blob.size, preview };
  const tx = db.transaction(['screenshots', 'screenshotBlobs'], 'readwrite');
  await Promise.all([tx.objectStore('screenshots').put(screenshot), tx.objectStore('screenshotBlobs').put(blob, screenshot.id), tx.done]);
  return screenshot;
}

export async function listScreenshots() {
  return (await (await getDb()).getAllFromIndex('screenshots', 'by-date')).reverse();
}

export async function getScreenshotBlob(id: string) {
  return (await getDb()).get('screenshotBlobs', id);
}

export async function deleteScreenshot(id: string) {
  const db = await getDb();
  const tx = db.transaction(['screenshots', 'screenshotBlobs'], 'readwrite');
  await Promise.all([tx.objectStore('screenshots').delete(id), tx.objectStore('screenshotBlobs').delete(id), tx.done]);
}

/** Asks the browser not to evict the library when disk space runs low. */
export const requestPersistence = async () => (await navigator.storage?.persist?.()) ?? false;
