import type { RecordingMeta } from './db';

export type Sort = 'newest' | 'oldest' | 'longest' | 'title';
export type Range = 'any' | 'today' | '7' | '30';

const DAY = 86_400_000;

function since(range: Range) {
  if (range === 'any') return 0;
  if (range === 'today') {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }
  return Date.now() - Number(range) * DAY;
}

const SORTS: Record<Sort, (a: RecordingMeta, b: RecordingMeta) => number> = {
  newest: (a, b) => b.createdAt - a.createdAt,
  oldest: (a, b) => a.createdAt - b.createdAt,
  longest: (a, b) => b.durationMs - a.durationMs,
  title: (a, b) => a.title.localeCompare(b.title),
};

export function applyFilters(items: RecordingMeta[], query: string, range: Range, sort: Sort) {
  const q = query.trim().toLowerCase();
  const from = since(range);
  return items.filter((m) => m.createdAt >= from && (!q || m.title.toLowerCase().includes(q))).sort(SORTS[sort]);
}