import type { RecordingMeta } from '../lib/db';
import { downloadRecording } from '../lib/download';
import { fmtAgo, fmtDate, fmtSize, fmtTime } from '../lib/format';
import * as I from './Icons';
import Menu from './Menu';

interface Props {
  items: RecordingMeta[];
  total: number;
  selected: Set<string>;
  onToggle: (id: string) => void;
  onOpen: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (m: RecordingMeta) => void;
  onNew: () => void;
}

export default function Library({ items, total, selected, onToggle, onOpen, onRename, onDelete, onNew }: Props) {
  if (total === 0) {
    return (
      <div className="mt-8 grid place-items-center rounded-2xl border border-dashed border-line p-12 text-center">
        <p className="text-lg font-semibold">No videos yet</p>
        <p className="mt-1 max-w-sm text-muted">Record your screen with your voice and camera. Videos are saved in this browser only.</p>
        <button onClick={onNew} className="mt-5 inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2.5 font-semibold text-white hover:bg-brand-dark">
          <I.VideoCam /> Record a video
        </button>
      </div>
    );
  }
  if (items.length === 0) return <p className="mt-8 text-muted">No videos match your filters.</p>;

  const anySelected = selected.size > 0;
  return (
    <ul className="mt-5 grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
      {items.map((m) => {
        const sel = selected.has(m.id);
        return (
          <li key={m.id} className="group">
            <div className={`rounded-xl border bg-white ${sel ? 'border-brand ring-2 ring-brand' : 'border-line'}`}>
              <div className="relative overflow-hidden rounded-t-[11px]">
                <button onClick={() => onOpen(m.id)} aria-label={`Open ${m.title}`} className="relative block aspect-video w-full bg-ink">
                  {typeof m.thumb === 'string' && <img src={m.thumb} alt="" className="size-full object-cover" />}
                  <span className="absolute right-2 bottom-2 rounded bg-black/75 px-1.5 py-0.5 text-xs font-semibold text-white">
                    {fmtTime(m.durationMs)}
                  </span>
                </button>
                <label
                  className={`absolute top-2 left-2 grid size-7 place-items-center rounded-md bg-white/95 shadow focus-within:opacity-100 ${
                    anySelected || sel ? '' : 'opacity-0 group-hover:opacity-100'
                  }`}
                >
                  <input type="checkbox" checked={sel} onChange={() => onToggle(m.id)} aria-label={`Select ${m.title}`} className="size-4 accent-brand" />
                </label>
              </div>
              <div className="p-3">
                <div className="flex items-center gap-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-full bg-tint text-brand"><I.Film /></span>
                  <div className="min-w-0 flex-1 text-sm">
                    <p className="font-medium">Recorded · {fmtAgo(m.createdAt)}</p>
                    <p className="text-muted">Saved on this device</p>
                  </div>
                  <Menu
                    buttonLabel={`Actions for ${m.title}`} buttonClass="rounded-lg p-2 text-muted hover:bg-wash" button={<I.More />}
                    items={[
                      { label: 'Rename', onSelect: () => {
                        const next = window.prompt('Rename video', m.title)?.trim();
                        if (next) onRename(m.id, next);
                      } },
                      { label: 'Download', onSelect: () => void downloadRecording(m) },
                      { label: 'Delete', danger: true, onSelect: () => onDelete(m) },
                    ]}
                  />
                </div>
                <h3 className="mt-3 line-clamp-2 font-semibold">{m.title}</h3>
                <p className="mt-1 text-sm text-muted">
                  {fmtDate(m.createdAt)} · {fmtSize(m.size)} · {m.mimeType.includes('mp4') ? 'MP4' : 'WebM'}
                </p>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}