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
  source?: 'recorded' | 'uploaded' | 'meeting';
  lastViewedAt?: number;
}

interface Schema extends DBSchema {
  meta: { key: string; value: RecordingMeta; indexes: { 'by-date': number } };
  videos: { key: string; value: Blob };
  chunks: { key: [string, number]; value: Blob }; // [recording id, chunk index]
}

let dbPromise: Promise<IDBPDatabase<Schema>> | null = null;

export const getDb = () =>
  (dbPromise ??= openDB<Schema>('clientorahq-recorder', 2, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        db.createObjectStore('meta', { keyPath: 'id' }).createIndex('by-date', 'createdAt');
        db.createObjectStore('videos');
        db.createObjectStore('chunks');
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
  r: { id: string; blob: Blob; durationMs: number; mimeType: string; source?: RecordingMeta['source'] },
  title?: string,
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
  };
  const db = await getDb();
  const tx = db.transaction(['meta', 'videos'], 'readwrite');
  await Promise.all([tx.objectStore('meta').put(meta), tx.objectStore('videos').put(r.blob, r.id), tx.done]);
  await clearChunks(r.id);
  return meta;
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

export async function setRecordingArchived(id: string, archived: boolean) {
  const db = await getDb();
  const meta = await db.get('meta', id);
  if (!meta) throw new Error('This recording is no longer in the library.');
  const updated = { ...meta, archived };
  await db.put('meta', updated);
  return updated;
}

export async function markRecordingViewed(id: string) {
  const db = await getDb();
  const meta = await db.get('meta', id);
  if (!meta) return;
  const updated = { ...meta, lastViewedAt: Date.now() };
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
  const tx = db.transaction(['meta', 'videos'], 'readwrite');
  await Promise.all([tx.objectStore('meta').delete(id), tx.objectStore('videos').delete(id), tx.done]);
}

/** Asks the browser not to evict the library when disk space runs low. */
export const requestPersistence = async () => (await navigator.storage?.persist?.()) ?? false;
