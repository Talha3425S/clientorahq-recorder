import { useCallback, useEffect, useState } from 'react';
import * as I from './components/Icons';
import Library from './components/Library';
import RecorderUI from './components/RecorderUI';
import VideoPage from './components/VideoPage';
import { useRecorder } from './hooks/useRecorder';
import { deleteRecording, listRecordings, renameRecording, type RecordingMeta } from './lib/db';
import { checkSupport } from './lib/support';

type Page = 'record' | 'library';

function AppHeader({ page, count, onNavigate }: { page: Page; count: number; onNavigate: (page: Page) => void }) {
  return (
    <header className="pdf-app-header">
      <div className="pdf-app-brand"><span>C</span><strong>ClientoraHQ Recorder</strong></div>
      <nav aria-label="Main pages">
        <button aria-current={page === 'record' ? 'page' : undefined} className={page === 'record' ? 'is-active' : ''} onClick={() => onNavigate('record')}>Record</button>
        <button aria-current={page === 'library' ? 'page' : undefined} className={page === 'library' ? 'is-active' : ''} onClick={() => onNavigate('library')}>Library ({count})</button>
      </nav>
    </header>
  );
}

export default function App() {
  const support = checkSupport();
  const [items, setItems] = useState<RecordingMeta[]>([]);
  const [page, setPage] = useState<Page>('library');
  const [openId, setOpenId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void listRecordings().then((list) => { if (!cancelled) setItems(list); }).catch(() => {
      if (!cancelled) setMessage('Could not open the local video library. Check this browser’s storage settings.');
    });
    return () => { cancelled = true; };
  }, []);

  const onSaved = useCallback((meta: RecordingMeta) => {
    setItems((prev) => [meta, ...prev]);
    setPage('library');
    setOpenId(meta.id);
  }, []);
  const rec = useRecorder(onSaved);
  const current = items.find((meta) => meta.id === openId) ?? null;

  useEffect(() => {
    if (page === 'record' && rec.phase === 'idle' && !openId) setPage('library');
  }, [openId, page, rec.phase]);

  const startRecording = () => {
    setMessage(null);
    setOpenId(null);
    setPage('record');
    void rec.openPanel();
  };

  const navigate = (next: Page) => {
    if (next === 'record') {
      startRecording();
      return;
    }
    if (rec.phase !== 'idle') rec.cancel();
    setOpenId(null);
    setPage('library');
  };

  const rename = async (id: string, title: string) => {
    await renameRecording(id, title);
    setItems((prev) => prev.map((meta) => meta.id === id ? { ...meta, title } : meta));
  };

  const remove = async (meta: RecordingMeta) => {
    if (!window.confirm(`Delete “${meta.title}”? This cannot be undone.`)) return;
    await deleteRecording(meta.id);
    setItems((prev) => prev.filter((item) => item.id !== meta.id));
    if (openId === meta.id) setOpenId(null);
  };

  const copyPageLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setMessage('Page link copied.');
    } catch {
      setMessage('Copying the page link is not available in this browser.');
    }
  };

  if (!support.ok) {
    return (
      <div className="min-h-screen bg-[#f3f7fa]">
        <AppHeader page="library" count={items.length} onNavigate={navigate} />
        <main className="pdf-error-page">
          <article className="pdf-error-card">
            <span className="pdf-error-icon is-info">i</span>
            <h1>Open on a computer</h1>
            <p>{support.reason} Use a current desktop version of Chrome, Edge, or Firefox.</p>
            <button onClick={() => void copyPageLink()}>{message === 'Page link copied.' ? 'Link copied' : 'Copy page link'}</button>
          </article>
        </main>
      </div>
    );
  }

  const storageUsed = items.reduce((sum, meta) => sum + meta.size, 0);

  return (
    <div className="min-h-screen bg-white">
      <AppHeader page={page} count={items.length} onNavigate={navigate} />
      <main className="pdf-library-page">
        {message && <p role="status" className="pdf-message">{message}<button aria-label="Dismiss message" onClick={() => setMessage(null)}><I.Close /></button></p>}
        {current ? (
          <VideoPage
            meta={current}
            onBack={() => setOpenId(null)}
            onRename={(title) => void rename(current.id, title)}
            onDelete={() => void remove(current)}
            onTrimmed={(updated) => setItems((prev) => prev.map((item) => item.id === updated.id ? updated : item))}
          />
        ) : page === 'library' ? (
          <Library
            items={items}
            total={items.length}
            storageUsed={storageUsed}
            onOpen={(id) => setOpenId(id)}
            onRename={(id, title) => void rename(id, title)}
            onDelete={(meta) => void remove(meta)}
            onNew={startRecording}
          />
        ) : (
          <div className="pdf-preparing"><span className="pdf-spinner" />Preparing recording devices…</div>
        )}
      </main>
      <RecorderUI r={rec} libraryCount={items.length} />
    </div>
  );
}
