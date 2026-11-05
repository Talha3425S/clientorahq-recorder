import { useCallback, useEffect, useState } from 'react';
import * as I from './components/Icons';
import Library from './components/Library';
import RecorderUI from './components/RecorderUI';
import VideoPage from './components/VideoPage';
import { useRecorder } from './hooks/useRecorder';
import { deleteRecording, getVideo, listRecordings, markRecordingViewed, renameRecording, saveRecording, setRecordingArchived, setRecordingCloudId, type RecordingMeta } from './lib/db';
import { deleteCloudRecording, downloadCloudRecording, getCloudPlaybackUrl, listCloudRecordings, renameCloudRecording, uploadRecordingToCloud } from './lib/recordingsApi';
import { downloadRecording } from './lib/download';
import { checkSupport } from './lib/support';
import { AdminOverview, AdminSpaces, AdminUsers, CreateSpaceModal, InsightsPage, MeetingsPage, PlaylistsPage, RecentPage, SettingsPage, UpgradeModal, WorkspaceSettings, type WorkspaceSpace } from './components/WorkspacePages';
import AuthPage from './components/AuthPage';

type Page = 'for-you' | 'library' | 'meetings' | 'playlists' | 'recent' | 'settings' | 'admin-overview' | 'admin-users' | 'admin-spaces' | 'admin-insights' | 'workspace-settings' | 'admin-billing' | 'admin-atlassian' | 'record';

function readWorkspaceSpaces(): WorkspaceSpace[] {
  try { const stored: unknown = JSON.parse(localStorage.getItem('clientorahq-spaces') ?? '[]'); return Array.isArray(stored) ? stored as WorkspaceSpace[] : []; }
  catch { return []; }
}

function AppHeader({ page, count, search, spaces, onSearch, onNavigate, onRecord, onCreateSpace, onUpgrade, onLogout }: { page: Page; count: number; search: string; spaces: WorkspaceSpace[]; onSearch: (value: string) => void; onNavigate: (page: Page) => void; onRecord: () => void; onCreateSpace: () => void; onUpgrade: () => void; onLogout: () => void }) {
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  return (
    <>
      <header className="loom-topbar">
        <div className="loom-top-left"><button className="top-icon collapse-icon" aria-label="Collapse sidebar">◧</button><button className="top-icon apps-icon" aria-label="Apps">▦</button><div className="loom-logo"><span>✳</span><strong>Clientora<span>HQ</span></strong></div></div>
        <label className="global-search"><span>⌕</span><input value={search} onChange={(event) => onSearch(event.currentTarget.value)} placeholder="Search for people, tags, folders, Spaces, Playlists, and videos" aria-label="Search" /></label>
        <div className="loom-top-actions"><button className="upgrade-button" onClick={onUpgrade}>♢ Upgrade</button><button className="top-icon" aria-label="Help">?</button><button className="top-icon notification-button" aria-label="Notifications">♧<i>2</i></button><div className="account-menu-anchor"><button className="user-avatar" aria-label="Account menu" title="Account menu" aria-haspopup="menu" aria-expanded={profileMenuOpen} onClick={() => setProfileMenuOpen((open) => !open)}>TJ</button>{profileMenuOpen && <div className="profile-menu" role="menu"><strong>Signed in</strong><button role="menuitem" onClick={() => { setProfileMenuOpen(false); onLogout(); }}>Sign out</button></div>}</div></div>
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
  const [cloudItems, setCloudItems] = useState<RecordingMeta[]>([]);
  const [cloudPlaybackUrl, setCloudPlaybackUrl] = useState<string | null>(null);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [page, setPage] = useState<Page>('for-you');
  const [openId, setOpenId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [spaces, setSpaces] = useState<WorkspaceSpace[]>(readWorkspaceSpaces);
  const [showCreateSpace, setShowCreateSpace] = useState(false);
  const [showUpgrade, setShowUpgrade] = useState(false);
  const authFlow = window.location.pathname === '/login' ? 'login' : 'signup';
  const isAuthPage = window.location.pathname === '/signup' || window.location.pathname === '/login';
  const [authStatus, setAuthStatus] = useState<'checking' | 'authenticated' | 'unauthenticated' | 'error'>('checking');

  useEffect(() => {
    let cancelled = false;
    void fetch('/api/v1/auth/me', { credentials: 'same-origin' }).then((response) => {
      if (cancelled) return;
      if (response.ok) {
        if (isAuthPage) window.location.replace('/');
        else setAuthStatus('authenticated');
      } else if (response.status === 401) {
        if (isAuthPage) setAuthStatus('unauthenticated');
        else window.location.replace('/login');
      } else {
        setAuthStatus('error');
      }
    }).catch(() => {
      if (!cancelled) setAuthStatus('error');
    });
    return () => { cancelled = true; };
  }, [isAuthPage]);

  useEffect(() => {
    let cancelled = false;
    void listRecordings().then((list) => { if (!cancelled) setItems(list); }).catch(() => {
      if (!cancelled) setMessage('Could not open the local video library. Check this browser’s storage settings.');
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (authStatus !== 'authenticated') return;
    let cancelled = false;
    void listCloudRecordings().then((list) => { if (!cancelled) setCloudItems(list); }).catch((error) => {
      if (!cancelled) setMessage(error instanceof Error ? `Cloud library unavailable: ${error.message}` : 'Could not load cloud recordings.');
    });
    return () => { cancelled = true; };
  }, [authStatus]);

  const onSaved = useCallback((meta: RecordingMeta) => {
    setItems((prev) => [meta, ...prev]);
    setPage('library');
    setOpenId(meta.id);
  }, []);
  const rec = useRecorder(onSaved);
  const syncedCloudIds = new Set(cloudItems.map((meta) => meta.id));
  const libraryItems = [...items.filter((meta) => !meta.cloudId || !syncedCloudIds.has(meta.cloudId)), ...cloudItems];
  const current = libraryItems.find((meta) => meta.id === openId) ?? null;
  const filteredItems = search.trim() ? libraryItems.filter((item) => item.title.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())) : libraryItems;
  const activeItems = filteredItems.filter((item) => !item.archived);
  const availableRecordings = libraryItems.filter((item) => !item.archived);
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

  const openRecording = async (id: string) => {
    const meta = libraryItems.find((item) => item.id === id);
    if (meta?.isCloud) {
      setMessage(null);
      try {
        setCloudPlaybackUrl(await getCloudPlaybackUrl(id));
        setOpenId(id);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : 'Could not open this cloud recording.');
      }
      return;
    }
    setCloudPlaybackUrl(null);
    setOpenId(id);
    void markRecordingViewed(id).then((updated) => {
      if (updated) setItems((previous) => previous.map((item) => item.id === id ? updated : item));
    });
  };

  const uploadToCloud = async (meta: RecordingMeta) => {
    if (uploadingId) return;
    setUploadingId(meta.id);
    setMessage(null);
    try {
      const blob = await getVideo(meta.id);
      if (!blob) throw new Error('This video is no longer available in local browser storage.');
      const cloudMeta = await uploadRecordingToCloud(meta, blob);
      await setRecordingCloudId(meta.id, cloudMeta.id);
      setItems((previous) => previous.map((item) => item.id === meta.id ? { ...item, cloudId: cloudMeta.id } : item));
      setCloudItems((previous) => [cloudMeta, ...previous.filter((item) => item.id !== cloudMeta.id)]);
      setNotice('Video uploaded to your cloud library.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not upload this video.');
    } finally {
      setUploadingId(null);
    }
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
    const meta = libraryItems.find((item) => item.id === id);
    try {
      if (meta?.isCloud) {
        await renameCloudRecording(id, title);
        setCloudItems((prev) => prev.map((item) => item.id === id ? { ...item, title } : item));
        const localCopy = items.find((item) => item.cloudId === id);
        if (localCopy) {
          await renameRecording(localCopy.id, title);
          setItems((prev) => prev.map((item) => item.id === localCopy.id ? { ...item, title } : item));
        }
      } else {
        await renameRecording(id, title);
        setItems((prev) => prev.map((item) => item.id === id ? { ...item, title } : item));
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not rename this video.');
    }
  };

  const remove = async (meta: RecordingMeta) => {
    if (!window.confirm(`Delete “${meta.title}”? This cannot be undone.`)) return;
    try {
      if (meta.isCloud) {
        await deleteCloudRecording(meta.id);
        const localCopies = items.filter((item) => item.cloudId === meta.id);
        await Promise.all(localCopies.map((item) => deleteRecording(item.id)));
        setCloudItems((prev) => prev.filter((item) => item.id !== meta.id));
        setItems((prev) => prev.filter((item) => item.cloudId !== meta.id));
      } else {
        await deleteRecording(meta.id);
        setItems((prev) => prev.filter((item) => item.id !== meta.id));
      }
      if (openId === meta.id) setOpenId(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not delete this video.');
    }
  };

  const download = async (meta: RecordingMeta) => {
    try {
      if (!meta.isCloud) return await downloadRecording(meta);
      const url = await downloadCloudRecording(meta.id);
      const link = document.createElement('a');
      link.href = url;
      link.rel = 'noreferrer';
      link.click();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not download this video.');
    }
  };

  const copyPageLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setMessage('Page link copied.');
    } catch {
      setMessage('Copying the page link is not available in this browser.');
    }
  };

  const logOut = async () => {
    try {
      const response = await fetch('/api/v1/auth/logout', { method: 'POST', credentials: 'same-origin' });
      if (!response.ok) throw new Error('Could not sign out right now. Please try again.');
      window.location.replace('/login');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not sign out right now. Check your connection and try again.');
    }
  };

  if (authStatus === 'checking') return <div className="pdf-preparing"><span className="pdf-spinner" />Checking your session…</div>;
  if (authStatus === 'error') return <main className="pdf-error-page"><article className="pdf-error-card"><h1>Can’t connect to your account</h1><p>Make sure the authentication server is running, then try again.</p><button onClick={() => window.location.reload()}>Try again</button><p><a href="/login">Go to sign in</a></p></article></main>;
  if (isAuthPage) return <AuthPage initialFlow={authFlow} />;

  if (support.ok === false) {
    return (
      <div className="min-h-screen bg-[#f3f7fa]">
        <AppHeader page="library" count={activeItems.length} search={search} spaces={spaces} onSearch={updateSearch} onNavigate={navigate} onRecord={startRecording} onCreateSpace={() => setShowCreateSpace(true)} onUpgrade={() => setShowUpgrade(true)} onLogout={() => void logOut()} />
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
      <AppHeader page={visiblePage} count={activeItems.length} search={search} spaces={spaces} onSearch={updateSearch} onNavigate={navigate} onRecord={startRecording} onCreateSpace={() => setShowCreateSpace(true)} onUpgrade={() => setShowUpgrade(true)} onLogout={() => void logOut()} />
      <main className={`loom-main${visiblePage === 'for-you' && !current ? ' is-home' : ''}`}>
        {(message || notice) && <p role="status" className="pdf-message">{message || notice}<button aria-label="Dismiss message" onClick={() => { setMessage(null); setNotice(null); }}><I.Close /></button></p>}
        {current ? (
          <VideoPage
            key={current.id}
            meta={current}
            onBack={() => setOpenId(null)}
            onRename={(title) => void rename(current.id, title)}
            onDelete={() => void remove(current)}
            videoSrc={current.isCloud ? cloudPlaybackUrl ?? undefined : undefined}
            onDownload={current.isCloud ? () => void download(current) : undefined}
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
            onUpload={(meta) => void uploadToCloud(meta)}
            onDownload={(meta) => void download(meta)}
            uploadingId={uploadingId}
          />
        ) : visiblePage === 'meetings' ? (
          <MeetingsPage onConnect={() => setNotice('Calendar connection is not configured in this local workspace.')} />
        ) : visiblePage === 'playlists' ? (
          <PlaylistsPage recordings={availableRecordings} onOpenRecording={openRecording} onOpenLibrary={() => navigate('library')} />
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
