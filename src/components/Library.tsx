import type { RecordingMeta } from '../lib/db';
import { downloadRecording } from '../lib/download';
import { fmtDate, fmtSize, fmtTime } from '../lib/format';
import * as I from './Icons';

interface Props {
  items: RecordingMeta[];
  total: number;
  onOpen: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (m: RecordingMeta) => void;
  onNew: () => void;
}

const action = 'rounded-md px-2 py-1 text-sm font-semibold text-brand hover:bg-tint';

export default function Library({ items, total, onOpen, onRename, onDelete, onNew }: Props) {
  if (total === 0) {
    return (
      <div className="mt-8 grid place-items-center rounded-2xl border border-dashed border-line p-12 text-center">
        <p className="text-lg font-semibold">No videos yet</p>
        <p className="mt-1 max-w-sm text-muted">Record your screen with your voice and camera. Videos are saved in this browser only.</p>
        <button onClick={onNew} className="mt-5 inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2.5 font-semibold text-white hover:bg-brand-dark">
          <I.Dot /> New video
        </button>
      </div>
    );
  }
  if (items.length === 0) return <p className="mt-8 text-muted">No videos match your search.</p>;

  return (
    <ul className="mt-6 grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
      {items.map((m) => (
        <li key={m.id} className="overflow-hidden rounded-xl border border-line bg-white">
          <button onClick={() => onOpen(m.id)} aria-label={`Open ${m.title}`} className="relative block aspect-video w-full bg-ink">
            {typeof m.thumb === 'string' && <img src={m.thumb} alt="" className="size-full object-cover" />}
            <span className="absolute right-2 bottom-2 rounded bg-black/75 px-1.5 py-0.5 text-xs font-semibold text-white">
              {fmtTime(m.durationMs)}
            </span>
          </button>
          <div className="p-3">
            <h3 className="truncate font-semibold">{m.title}</h3>
            <p className="text-sm text-muted">{fmtDate(m.createdAt)} · {fmtSize(m.size)}</p>
            <div className="mt-2 -ml-2 flex gap-1">
              <button className={action} aria-label={`Rename ${m.title}`} onClick={() => {
                const next = window.prompt('Rename video', m.title)?.trim();
                if (next) onRename(m.id, next);
              }}>Rename</button>
              <button className={action} aria-label={`Download ${m.title}`} onClick={() => void downloadRecording(m)}>Download</button>
              <button className={`${action} text-rec`} aria-label={`Delete ${m.title}`} onClick={() => onDelete(m)}>Delete</button>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}