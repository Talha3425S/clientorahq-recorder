// Temporary library list for testing the database. The designed version comes with the real UI.
import { useEffect, useState } from 'react';
import { deleteRecording, getVideo, listRecordings, renameRecording, type RecordingMeta } from './lib/db';

const fmt = (ms: number) => {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export default function Library({ refreshKey }: { refreshKey: number }) {
  const [items, setItems] = useState<RecordingMeta[]>([]);
  const [playing, setPlaying] = useState<{ id: string; url: string } | null>(null);
  const [version, setVersion] = useState(0); // bump to reload the list

  useEffect(() => {
    let cancelled = false;
    void listRecordings().then((list) => {
      if (!cancelled) setItems(list);
    });
    return () => { cancelled = true; };
  }, [refreshKey, version]);
  useEffect(() => () => { if (playing) URL.revokeObjectURL(playing.url); }, [playing]);

  const play = async (id: string) => {
    const blob = await getVideo(id);
    if (blob) setPlaying({ id, url: URL.createObjectURL(blob) });
  };

  const download = async (m: RecordingMeta) => {
    const blob = await getVideo(m.id);
    if (!blob) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${m.title.replace(/[\\/:*?"<>|]+/g, '-')}.${m.mimeType.includes('mp4') ? 'mp4' : 'webm'}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  };

  const rename = async (m: RecordingMeta) => {
    const next = window.prompt('Rename recording', m.title);
    if (next?.trim()) {
      await renameRecording(m.id, next.trim());
      setVersion((v) => v + 1);
    }
  };

  const remove = async (m: RecordingMeta) => {
    if (!window.confirm(`Delete "${m.title}"? This cannot be undone.`)) return;
    await deleteRecording(m.id);
    if (playing?.id === m.id) setPlaying(null);
    setVersion((v) => v + 1);
  };

  return (
    <section aria-label="Library" style={{ marginTop: 24 }}>
      <h2>Library ({items.length})</h2>
      <p>Recordings are saved in this browser only. Nothing is uploaded.</p>
      {playing && <video src={playing.url} controls autoPlay style={{ width: '100%' }} />}
      <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: 12 }}>
        {items.map((m) => (
          <li key={m.id} style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            {typeof m.thumb === 'string' ? (
              <img src={m.thumb} alt={`Thumbnail of ${m.title}`} width={120} height={68} style={{ objectFit: 'cover' }} />
            ) : (
              <div style={{ width: 120, height: 68, background: '#333' }} aria-hidden />
            )}
            <div style={{ flex: 1, minWidth: 160 }}>
              <strong>{m.title}</strong>
              <br />
              {fmt(m.durationMs)} · {new Date(m.createdAt).toLocaleString()}
            </div>
            <button onClick={() => play(m.id)} aria-label={`Play ${m.title}`}>Play</button>
            <button onClick={() => rename(m)} aria-label={`Rename ${m.title}`}>Rename</button>
            <button onClick={() => download(m)} aria-label={`Download ${m.title}`}>Download</button>
            <button onClick={() => remove(m)} aria-label={`Delete ${m.title}`}>Delete</button>
          </li>
        ))}
      </ul>
    </section>
  );
}