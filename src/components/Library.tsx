import type { RecordingMeta } from '../lib/db';
import { downloadRecording } from '../lib/download';
import { fmtDate, fmtSize, fmtTime } from '../lib/format';
import * as I from './Icons';

interface Props {
  items: RecordingMeta[];
  total: number;
  storageUsed: number;
  onOpen: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (meta: RecordingMeta) => void;
  onNew: () => void;
}

const displaySize = (bytes: number) => bytes < 1_000_000
  ? `${Math.max(1, Math.round(bytes / 1000))} KB`
  : `${(bytes / 1_000_000).toFixed(0)} MB`;

export default function Library({ items, total, storageUsed, onOpen, onRename, onDelete, onNew }: Props) {
  if (total === 0) {
    return (
      <section className="pdf-library-empty">
        <h1>Library</h1>
        <button className="pdf-new-recording" onClick={onNew}>New recording</button>
        <div className="pdf-empty-card">
          <div>
            <h2>No videos yet</h2>
            <p>Record your screen with your voice and camera.<br />Videos are saved in this browser only.</p>
            <button className="pdf-empty-record" onClick={onNew}><I.VideoCam /> Record a video</button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="pdf-library-content" aria-label="Library">
      <div className="pdf-library-title-row">
        <h1>Library</h1>
        <button className="pdf-new-recording" onClick={onNew}>New recording</button>
      </div>
      <ul className="pdf-recording-grid">
        {items.map((meta) => (
          <li key={meta.id} className="pdf-recording-card">
            <button className="pdf-recording-preview" onClick={() => onOpen(meta.id)} aria-label={`Play ${meta.title}`}>
              {meta.thumb ? <img src={meta.thumb} alt="" /> : <span className="pdf-recording-placeholder" />}
              <span className="pdf-duration">{fmtTime(meta.durationMs)}</span>
            </button>
            <h2>{meta.title}</h2>
            <p className="pdf-recording-meta">{fmtDate(meta.createdAt)} · {displaySize(meta.size)}</p>
            <div className="pdf-recording-actions">
              <button onClick={() => onOpen(meta.id)}>Play</button>
              <button onClick={() => {
                const next = window.prompt('Rename recording', meta.title)?.trim();
                if (next) onRename(meta.id, next);
              }}>Rename</button>
              <button onClick={() => void downloadRecording(meta)}>Download</button>
              <button className="is-danger" onClick={() => onDelete(meta)}>Delete</button>
            </div>
          </li>
        ))}
      </ul>
      <p className="pdf-storage-note">{fmtSize(storageUsed)} used on this computer · recordings survive page reloads</p>
    </section>
  );
}
