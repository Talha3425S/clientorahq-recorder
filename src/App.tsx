import { useCallback, useEffect, useState } from 'react';
import * as I from './components/Icons';
import Library from './components/Library';
import RecorderUI from './components/RecorderUI';
import VideoPage from './components/VideoPage';
import { useRecorder } from './hooks/useRecorder';
import { deleteRecording, listRecordings, markRecordingViewed, renameRecording, saveRecording, setRecordingArchived, type RecordingMeta } from './lib/db';
import { checkSupport } from './lib/support';
import { AdminOverview, AdminSpaces, AdminUsers, CreateSpaceModal, InsightsPage, MeetingsPage, PlaylistsPage, RecentPage, SettingsPage, UpgradeModal, WorkspaceSettings, type WorkspaceSpace } from './components/WorkspacePages';
import AuthPage from './components/AuthPage';

type Page = 'for-you' | 'library' | 'meetings' | 'playlists' | 'recent' | 'settings' | 'admin-overview' | 'admin-users' | 'admin-spaces' | 'admin-insights' | 'workspace-settings' | 'admin-billing' | 'admin-atlassian' | 'record';

function readWorkspaceSpaces(): WorkspaceSpace[] {
  try { const stored: unknown = JSON.parse(localStorage.getItem('clientorahq-spaces') ?? '[]'); return Array.isArray(stored) ? stored as WorkspaceSpace[] : []; }
  catch { return []; }
}

function AppHeader({ page, count, search, spaces, onSearch, onNavigate, onRecord, onCreateSpace, onUpgrade }: { page: Page; count: number; search: string; spaces: WorkspaceSpace[]; onSearch: (value: string) => void; onNavigate: (page: Page) => void; onRecord: () => void; onCreateSpace: () => void; onUpgrade: () => void }) {
  return (
    <>
      <header className="loom-topbar">
        <div className="loom-top-left"><button className="top-icon collapse-icon" aria-label="Collapse sidebar">◧</button><button className="top-icon apps-icon" aria-label="Apps">▦</button><div className="loom-logo"><span>✳</span><strong>Clientora<span>HQ</span></strong></div></div>
        <label className="global-search"><span>⌕</span><input value={search} onChange={(event) => onSearch(event.currentTarget.value)} placeholder="Search for people, tags, folders, Spaces, Playlists, and videos" aria-label="Search" /></label>
        <div className="loom-top-actions"><button className="upgrade-button" onClick={onUpgrade}>♢ Upgrade</button><button className="top-icon" aria-label="Help">?</button><button className="top-icon notification-button" aria-label="Notifications">♧<i>2</i></button><a className="user-avatar" aria-label="Sign up or sign in" title="Sign up or sign in" href="/signup">TJ</a></div>
      </header>
      <aside className="loom-sidebar">
        <div className="loom-sidebar-scroll">
        <div className="workspace-card"><strong title="ClientoraHQ workspace">ClientoraHQ workspace <span>⌄</span></strong><div><span className="default-chip">Default</span><span>ⓘ</span><i /> <span>1 member</span></div><button>♙ &nbsp; Invite teammates</button></div>
        <nav className="workspace-nav" aria-label="Workspace navigation">
          <button className={page === 'for-you' ? 'is-active' : ''} onClick={() => onNavigate('for-you')}><span>◎</span>For you</button>
          <button className={page === 'library' ? 'is-active' : ''} onClick={() => onNavigate('library')}><span>▣</span>Library{count > 0 && <small>{count}</small>}</button>
          <button className={page === 'meetings' ? 'is-active' : ''} onClick={() => onNavigate('meetings')}><span>▦</span>Meetings</button>
          <button className={page === 'playlists' ? 'is-active' : ''} onClick={() => onNavigate('playlists')}><span>▣</span>Playlists</button>
          <button className={page === 'recent' ? 'is-active' : ''} onClick={() => onNavigate('recent')}><span>◷</span>Recent</button>
          <button className={page === 'settings' ? 'is-active' : ''} onClick={() => onNavigate('settings')}><span>⚙</span>Personal settings</button>
        </nav>
        <div className="sidebar-divider" />
        <p className="sidebar-section-label">Admin tools</p>
        <nav className="workspace-nav admin-nav" aria-label="Admin tools">
          <button className={page === 'admin-overview' ? 'is-active' : ''} onClick={() => onNavigate('admin-overview')}><span>◎</span>Overview</button>
          <button className={page === 'admin-users' || page === 'admin-spaces' ? 'is-active' : ''} onClick={() => onNavigate('admin-users')}><span>▣</span>Manage</button>
          <button className={`admin-subnav${page === 'admin-users' ? ' is-active' : ''}`} onClick={() => onNavigate('admin-users')}>Users</button>
          <button className={`admin-subnav${page === 'admin-spaces' ? ' is-active' : ''}`} onClick={() => onNavigate('admin-spaces')}>Spaces</button>
          <button className={page === 'admin-insights' ? 'is-active' : ''} onClick={() => onNavigate('admin-insights')}><span>⌁</span>Insights</button>
          <button className={page === 'workspace-settings' ? 'is-active' : ''} onClick={() => onNavigate('workspace-settings')}><span>⚙</span>Workspace</button>
          <button onClick={() => onNavigate('admin-billing')}><span>▤</span>Billing <small>↗</small></button>
          <button onClick={() => onNavigate('admin-atlassian')}><span>▧</span>Atlassian Admin <small>↗</small></button>
        </nav>
        <div className="sidebar-divider spaces-divider" />
        <div className="sidebar-spaces-heading"><span>Spaces</span><button aria-label="Create a space" title="Create a space" onClick={onCreateSpace}>+</button></div>
        <nav className="workspace-nav spaces-nav" aria-label="Spaces"><button onClick={() => onNavigate('admin-spaces')}><span>♧</span>View all Spaces</button>{spaces.map((space) => <button key={space.id} onClick={() => onNavigate('admin-spaces')}><b className="space-avatar">{space.name.slice(0, 1).toUpperCase()}</b>{space.name}</button>)}<button onClick={() => onNavigate('admin-spaces')}><b className="space-avatar">A</b>All ClientoraHQ workspace</button></nav>
        <div className="sidebar-local-note"><i /> Saved on this device</div>
        </div>
        <button className="sidebar-record-button" onClick={onRecord}><span>✳</span> Record a video</button>
      </aside>
    </>
  );
}

export default function App() {
  const support = checkSupport();
  const [items, setItems] = useState<RecordingMeta[]>([]);
  const [page, setPage] = useState<Page>('for-you');
  const [openId, setOpenId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [spaces, setSpaces] = useState<WorkspaceSpace[]>(readWorkspaceSpaces);
  const [showCreateSpace, setShowCreateSpace] = useState(false);
  const [showUpgrade, setShowUpgrade] = useState(false);
  const isSignupPage = window.location.pathname === '/signup';

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
  const filteredItems = search.trim() ? items.filter((item) => item.title.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())) : items;
  const activeItems = filteredItems.filter((item) => !item.archived);
  const archivedItems = filteredItems.filter((item) => item.archived);
  const visiblePage: Page = page === 'record' && rec.phase === 'idle' && !openId ? 'for-you' : page;

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
    setPage(next);
  };

  const updateSearch = (value: string) => {
    setSearch(value);
    if (value.trim()) { setOpenId(null); setPage('library'); }
  };

  const toggleArchive = async (meta: RecordingMeta) => {
    const updated = await setRecordingArchived(meta.id, !meta.archived);
    setItems((previous) => previous.map((item) => item.id === updated.id ? updated : item));
    setNotice(updated.archived ? 'Video moved to Archive.' : 'Video restored to Videos.');
  };

  const openRecording = (id: string) => {
    setOpenId(id);
    void markRecordingViewed(id).then((updated) => {
      if (updated) setItems((previous) => previous.map((item) => item.id === id ? updated : item));
    });
  };

  const uploadVideo = async (file: File) => {
    if (!file.type.startsWith('video/')) { setMessage('Choose a video file to add it to your library.'); return; }
    try {
      const durationMs = await readVideoDuration(file);
      const source = /meeting/i.test(file.name) ? 'meeting' : 'uploaded';
      const meta = await saveRecording({ id: crypto.randomUUID(), blob: file, durationMs, mimeType: file.type || 'video/webm', source }, file.name.replace(/\.[^.]+$/, '').slice(0, 120));
      onSaved(meta);
      setMessage('Video added to your local library.');
    } catch {
      setMessage('Could not add this video. Check available browser storage and try again.');
    }
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

  if (isSignupPage) return <AuthPage />;

  if (support.ok === false) {
    return (
      <div className="min-h-screen bg-[#f3f7fa]">
        <AppHeader page="library" count={activeItems.length} search={search} spaces={spaces} onSearch={updateSearch} onNavigate={navigate} onRecord={startRecording} onCreateSpace={() => setShowCreateSpace(true)} onUpgrade={() => setShowUpgrade(true)} />
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
    <div className="loom-app-shell">
      <AppHeader page={visiblePage} count={activeItems.length} search={search} spaces={spaces} onSearch={updateSearch} onNavigate={navigate} onRecord={startRecording} onCreateSpace={() => setShowCreateSpace(true)} onUpgrade={() => setShowUpgrade(true)} />
      <main className={`loom-main${visiblePage === 'for-you' && !current ? ' is-home' : ''}`}>
        {(message || notice) && <p role="status" className="pdf-message">{message || notice}<button aria-label="Dismiss message" onClick={() => { setMessage(null); setNotice(null); }}><I.Close /></button></p>}
        {current ? (
          <VideoPage
            key={current.id}
            meta={current}
            onBack={() => setOpenId(null)}
            onRename={(title) => void rename(current.id, title)}
            onDelete={() => void remove(current)}
            onTrimmed={(updated) => setItems((prev) => prev.map((item) => item.id === updated.id ? updated : item))}
          />
        ) : visiblePage === 'library' ? (
          <Library
            items={activeItems}
            archivedItems={archivedItems}
            total={activeItems.length}
            storageUsed={storageUsed}
            onOpen={openRecording}
            onRename={(id, title) => void rename(id, title)}
            onDelete={(meta) => void remove(meta)}
            onNew={startRecording}
            onArchive={(meta) => void toggleArchive(meta)}
          />
        ) : visiblePage === 'meetings' ? (
          <MeetingsPage onConnect={() => setNotice('Calendar connection is not configured in this local workspace.')} />
        ) : visiblePage === 'playlists' ? (
          <PlaylistsPage />
        ) : visiblePage === 'recent' ? (
          <RecentPage items={activeItems} onOpen={openRecording} />
        ) : visiblePage === 'settings' ? (
          <SettingsPage onConnect={() => setNotice('Calendar connection is not configured in this local workspace.')} />
        ) : visiblePage === 'admin-overview' ? (
          <AdminOverview items={items} onNavigate={navigate} onInvite={() => setNotice('Invitations require an account and server integration.')} />
        ) : visiblePage === 'admin-users' ? (
          <AdminUsers onInvite={() => setNotice('Invitations require an account and server integration.')} />
        ) : visiblePage === 'admin-spaces' ? (
          <AdminSpaces items={activeItems} spaces={spaces} />
        ) : visiblePage === 'admin-insights' ? (
          <InsightsPage items={items} />
        ) : visiblePage === 'workspace-settings' ? (
          <WorkspaceSettings items={items} onConnect={() => setNotice('Calendar connection is not configured in this local workspace.')} />
        ) : visiblePage === 'admin-billing' || visiblePage === 'admin-atlassian' ? (
          <section className="admin-placeholder"><h1>{visiblePage === 'admin-billing' ? 'Billing' : 'Atlassian Admin'}</h1><p>This workspace is running locally and is not connected to an account service.</p></section>
        ) : visiblePage === 'for-you' ? (
          <section className="loom-home-empty">
            <div className="bulb-art" aria-hidden="true"><i className="bulb-rays ray-one"/><i className="bulb-rays ray-two"/><i className="bulb-rays ray-three"/><span className="bulb-glass"/><span className="bulb-neck"/><i className="bulb-filament filament-left"/><i className="bulb-filament filament-right"/></div>
            <h1>Record a video</h1>
            <p>Stay aligned without another meeting — share an async<br className="desktop-break" /> video with your team.</p>
            <div className="home-actions"><button className="home-record-button" onClick={startRecording}><span>✳</span> Record a video</button><label className="home-upload-button">Upload a video<input type="file" accept="video/*" onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) void uploadVideo(file); event.currentTarget.value = ''; }} /></label></div>
            <span className="home-local-hint">Your videos stay private on this device.</span>
          </section>
        ) : (
          <div className="pdf-preparing"><span className="pdf-spinner" />Preparing recording devices…</div>
        )}
      </main>
      <RecorderUI r={rec} libraryCount={items.length} />
      {showCreateSpace && <CreateSpaceModal onClose={() => setShowCreateSpace(false)} onCreate={(space) => { const next = [space, ...spaces]; setSpaces(next); localStorage.setItem('clientorahq-spaces', JSON.stringify(next)); setShowCreateSpace(false); setNotice(`Space “${space.name}” created locally.`); }} />}
      {showUpgrade && <UpgradeModal onClose={() => setShowUpgrade(false)} onChoose={(plan) => { setShowUpgrade(false); setNotice(`Plan selection for ${plan} requires a connected billing account.`); }} />}
    </div>
  );
}

function readVideoDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    const url = URL.createObjectURL(file);
    video.preload = 'metadata';
    video.onloadedmetadata = () => { const duration = Number.isFinite(video.duration) ? Math.round(video.duration * 1000) : 0; URL.revokeObjectURL(url); resolve(duration); };
    video.onerror = () => { URL.revokeObjectURL(url); resolve(0); };
    video.src = url;
  });
}
