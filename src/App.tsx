import { useCallback, useEffect, useMemo, useState } from 'react';
import { Dot, Film, Search } from './components/Icons';
import Library from './components/Library';
import RecorderUI from './components/RecorderUI';
import VideoPage from './components/VideoPage';
import { useRecorder } from './hooks/useRecorder';
import { deleteRecording, listRecordings, renameRecording, type RecordingMeta } from './lib/db';
import { checkSupport } from './lib/support';

export default function App() {
  const support = checkSupport();
  const [items, setItems] = useState<RecordingMeta[]>([]);
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void listRecordings().then((list) => { if (!cancelled) setItems(list); });
    return () => { cancelled = true; };
  }, []);

  const onSaved = useCallback((m: RecordingMeta) => {
    setItems((prev) => [m, ...prev]);
    setOpenId(m.id);
  }, []);
  const rec = useRecorder(onSaved);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? items.filter((m) => m.title.toLowerCase().includes(q)) : items;
  }, [items, query]);
  const current = items.find((m) => m.id === openId) ?? null;

  const rename = async (id: string, title: string) => {
    await renameRecording(id, title);
    setItems((prev) => prev.map((m) => (m.id === id ? { ...m, title } : m)));
  };
  const remove = async (m: RecordingMeta) => {
    if (!window.confirm(`Delete “${m.title}”? This cannot be undone.`)) return;
    await deleteRecording(m.id);
    setItems((prev) => prev.filter((x) => x.id !== m.id));
    setOpenId(null);
  };
  const newVideo = () => {
    setOpenId(null);
    void rec.openPanel();
  };

  if (!support.ok) {
    return (
      <main className="grid min-h-screen place-items-center p-6">
        <div className="max-w-md text-center">
          <h1 className="text-2xl font-bold">This browser can’t record here</h1>
          <p className="mt-3 text-muted">{support.reason}</p>
        </div>
      </main>
    );
  }

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-line bg-wash p-4 md:flex">
        <div className="flex items-center gap-2 px-2 py-1 text-lg font-bold">
          <span className="grid size-8 place-items-center rounded-lg bg-brand text-white"><Dot /></span>
          ClientoraHQ Recorder
        </div>
        <button onClick={newVideo} className="mt-6 inline-flex items-center justify-center gap-2 rounded-lg bg-brand px-4 py-2.5 font-semibold text-white hover:bg-brand-dark">
          <Dot /> New video
        </button>
        <nav aria-label="Main" className="mt-6">
          <a href="#library" aria-current="page" onClick={() => setOpenId(null)} className="flex items-center gap-2 rounded-lg bg-tint px-3 py-2 font-semibold text-brand-dark">
            <Film /> Library
          </a>
        </nav>
        <p className="mt-auto rounded-lg bg-white p-3 text-sm text-muted">
          <strong className="text-ink">Private by default.</strong> Recordings stay in this browser. Nothing is uploaded.
        </p>
      </aside>

      <main className="min-w-0 flex-1">
        <header className="flex items-center gap-3 border-b border-line px-6 py-3">
          <span className="font-bold md:hidden">ClientoraHQ Recorder</span>
          <label className="relative max-w-xl flex-1">
            <span className="sr-only">Search videos</span>
            <span className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-muted"><Search /></span>
            <input
              type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search your videos"
              className="w-full rounded-full border border-line bg-white py-2 pr-4 pl-10"
            />
          </label>
          <button onClick={newVideo} className="ml-auto inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 font-semibold text-white hover:bg-brand-dark md:hidden">
            <Dot /> New
          </button>
        </header>

        <div className="px-6 py-6">
          {rec.phase === 'idle' && rec.error && <p role="alert" className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-rec">{rec.error}</p>}
          {current ? (
            <VideoPage
              meta={current} onBack={() => setOpenId(null)}
              onRename={(t) => void rename(current.id, t)} onDelete={() => void remove(current)}
            />
          ) : (
            <>
              <p className="text-sm text-muted">Library</p>
              <div className="flex items-end justify-between">
                <h1 className="text-3xl font-bold">Videos</h1>
                <p className="text-sm text-muted">{items.length} {items.length === 1 ? 'video' : 'videos'}</p>
              </div>
              <Library
                items={shown} total={items.length} onOpen={setOpenId}
                onRename={(id, t) => void rename(id, t)} onDelete={(m) => void remove(m)} onNew={newVideo}
              />
            </>
          )}
        </div>
      </main>

      <RecorderUI r={rec} />
    </div>
  );
}