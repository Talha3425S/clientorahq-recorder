import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as I from './components/Icons';
import Library from './components/Library';
import Menu from './components/Menu';
import RecorderUI from './components/RecorderUI';
import VideoPage from './components/VideoPage';
import { useRecorder } from './hooks/useRecorder';
import { deleteRecording, listRecordings, renameRecording, saveRecording, type RecordingMeta } from './lib/db';
import { applyFilters, type Range, type Sort } from './lib/library';
import { readDuration } from './lib/media';
import { checkSupport } from './lib/support';

const RANGES: { value: Range; label: string }[] = [
  { value: 'any', label: 'Any time' },
  { value: 'today', label: 'Today' },
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
];
const SORTS: { value: Sort; label: string }[] = [
  { value: 'newest', label: 'Newest to oldest' },
  { value: 'oldest', label: 'Oldest to newest' },
  { value: 'longest', label: 'Longest first' },
  { value: 'title', label: 'Title A–Z' },
];

function PillSelect<T extends string>({ label, value, onChange, options }: {
  label: string; value: T; onChange: (v: T) => void; options: { value: T; label: string }[];
}) {
  return (
    <label className="relative">
      <span className="sr-only">{label}</span>
      <select
        value={value} onChange={(e) => onChange(e.target.value as T)}
        className="appearance-none rounded-lg border border-line bg-white py-2 pr-9 pl-3.5 font-medium hover:bg-wash"
      >
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-muted"><I.Chevron /></span>
    </label>
  );
}

export default function App() {
  const support = checkSupport();
  const fileRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<RecordingMeta[]>([]);
  const [query, setQuery] = useState('');
  const [range, setRange] = useState<Range>('any');
  const [sort, setSort] = useState<Sort>('newest');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

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

  const shown = useMemo(() => applyFilters(items, query, range, sort), [items, query, range, sort]);
  const current = items.find((m) => m.id === openId) ?? null;
  const allSelected = shown.length > 0 && shown.every((m) => selected.has(m.id));
  const alert = message ?? (rec.phase === 'idle' ? rec.error : null);

  const rename = async (id: string, title: string) => {
    await renameRecording(id, title);
    setItems((prev) => prev.map((m) => (m.id === id ? { ...m, title } : m)));
  };

  const removeMany = async (list: RecordingMeta[]) => {
    if (!list.length) return;
    const text = list.length === 1 ? `Delete “${list[0].title}”? This cannot be undone.` : `Delete ${list.length} videos? This cannot be undone.`;
    if (!window.confirm(text)) return;
    await Promise.all(list.map((m) => deleteRecording(m.id)));
    const gone = new Set(list.map((m) => m.id));
    setItems((prev) => prev.filter((m) => !gone.has(m.id)));
    setSelected((prev) => new Set([...prev].filter((id) => !gone.has(id))));
    setOpenId(null);
  };

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const upload = async (files: FileList | null) => {
    const added: RecordingMeta[] = [];
    for (const f of Array.from(files ?? [])) {
      if (!f.type.startsWith('video/')) {
        setMessage(`“${f.name}” is not a video file.`);
        continue;
      }
      try {
        const durationMs = await readDuration(f);
        added.push(await saveRecording({ id: crypto.randomUUID(), blob: f, durationMs, mimeType: f.type }, f.name.replace(/\.[^.]+$/, '')));
      } catch {
        setMessage('Could not save the video. The browser may be out of storage.');
      }
    }
    if (added.length) setItems((prev) => [...added.reverse(), ...prev]);
  };

  const newVideo = () => {
    setOpenId(null);
    setMessage(null);
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
      <aside className="loom-sidebar sticky top-0 hidden h-screen shrink-0 flex-col border-r border-line bg-white md:flex">
        <div className="loom-brand-row">
          <span className="loom-logo"><I.LoomMark /></span>
          <span className="text-[20px] font-bold tracking-[-.5px]">Loom</span>
          <button className="loom-collapse" aria-label="Collapse sidebar"><I.SidebarToggle /></button>
        </div>

        <button className="loom-workspace" aria-label="Workspace menu">
          <div className="loom-workspace-top">
            <span className="truncate font-semibold">jk9224090-1793171721...</span>
            <I.Chevron />
          </div>
          <div className="loom-workspace-meta">
            <span className="loom-default">Default</span>
            <span className="loom-info">i</span>
            <span className="loom-members">1 member</span>
          </div>
          <span className="loom-invite"><I.Invite /> Invite teammates</span>
        </button>

        <nav aria-label="Main" className="loom-nav">
          <a href="#for-you" className="loom-nav-item"><I.UserCircle /> <span>For you</span></a>
          <a href="#library" aria-current="page" onClick={() => setOpenId(null)} className="loom-nav-item is-active"><I.Film /> <span>Library</span></a>
          <a href="#meetings" className="loom-nav-item"><I.Calendar /> <span>Meetings</span></a>
          <a href="#playlists" className="loom-nav-item"><I.Playlist /> <span>Playlists</span><span className="loom-new">New</span></a>
          <a href="#recent" className="loom-nav-item"><I.Clock /> <span>Recent</span></a>
          <a href="#settings" className="loom-nav-item"><I.Settings /> <span>Personal settings</span></a>
        </nav>

        <div className="loom-admin">
          <p>Admin tools</p>
          <a href="#overview" className="loom-nav-item"><I.Globe /> <span>Overview</span></a>
        </div>
        <button onClick={newVideo} className="loom-record"><I.LoomMark /> Record a video</button>
      </aside>

      <main className="min-w-0 flex-1">
        <header className="flex items-center gap-4 px-6 py-3">
          <span className="font-bold md:hidden">ClientoraHQ Recorder</span>
          <label className="relative max-w-3xl flex-1">
            <span className="sr-only">Search videos</span>
            <span className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-muted"><I.Search /></span>
            <input
              type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search your videos"
              className="w-full rounded-lg border border-line bg-white py-2.5 pr-4 pl-10"
            />
          </label>
          <span className="ml-auto hidden items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-sm text-muted lg:inline-flex">
            <I.Lock /> Private · nothing leaves this computer
          </span>
        </header>

        <div className="px-6 pt-4 pb-10">
          {alert && (
            <p role="alert" className="mb-4 flex items-center justify-between gap-3 rounded-lg bg-red-50 px-4 py-3 text-rec">
              {alert}
              {message && <button onClick={() => setMessage(null)} aria-label="Dismiss message"><I.Close /></button>}
            </p>
          )}

          {current ? (
            <VideoPage
              meta={current} onBack={() => setOpenId(null)}
              onRename={(t) => void rename(current.id, t)} onDelete={() => void removeMany([current])}
            />
          ) : (
            <>
              <div className="flex items-end justify-between gap-4">
                <div>
                  <p className="text-sm text-muted">Library</p>
                  <h1 className="text-3xl font-bold">Videos</h1>
                </div>
                <Menu
                  buttonLabel="New video" buttonClass="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2.5 font-semibold text-white hover:bg-brand-dark"
                  button={<>New video <I.Chevron /></>}
                  items={[
                    { label: 'Record a video', icon: <I.VideoCam />, onSelect: newVideo },
                    { label: 'Upload a video', icon: <I.Upload />, onSelect: () => fileRef.current?.click() },
                  ]}
                />
              </div>

              <div className="mt-5 flex items-end justify-between border-b border-line">
                <p className="-mb-px border-b-2 border-brand px-1 pb-2.5 font-semibold text-brand">All videos</p>
                <p className="pb-2.5 text-sm text-muted">{items.length} {items.length === 1 ? 'video' : 'videos'}</p>
              </div>

              <div className="mt-5 flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2.5 font-medium">
                  <input
                    type="checkbox" checked={allSelected} disabled={shown.length === 0} className="size-4 accent-brand"
                    onChange={() => setSelected(allSelected ? new Set() : new Set(shown.map((m) => m.id)))}
                  />
                  Select all videos
                </label>
                {selected.size > 0 && (
                  <button
                    onClick={() => void removeMany(items.filter((m) => selected.has(m.id)))}
                    className="rounded-lg border border-line px-3 py-2 font-semibold text-rec hover:bg-red-50"
                  >
                    Delete {selected.size} selected
                  </button>
                )}
                <div className="ml-auto flex flex-wrap gap-3">
                  <PillSelect label="Upload date" value={range} onChange={setRange} options={RANGES} />
                  <PillSelect label="Sort videos" value={sort} onChange={setSort} options={SORTS} />
                </div>
              </div>

              <Library
                items={shown} total={items.length} selected={selected} onToggle={toggle} onOpen={setOpenId}
                onRename={(id, t) => void rename(id, t)} onDelete={(m) => void removeMany([m])} onNew={newVideo}
              />
            </>
          )}
        </div>
        <input
          ref={fileRef} type="file" accept="video/*" multiple hidden
          onChange={(e) => {
            const input = e.currentTarget;
            void upload(input.files).then(() => { input.value = ''; });
          }}
        />
      </main>

      <RecorderUI r={rec} />
    </div>
  );
}
