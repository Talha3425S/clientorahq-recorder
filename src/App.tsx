import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import * as I from './components/Icons';
import Library from './components/Library';
import RecorderUI from './components/RecorderUI';
import VideoPage from './components/VideoPage';
import PublicSharePage from './components/PublicSharePage';
import { useRecorder } from './hooks/useRecorder';
import { deleteRecording, deleteScreenshot, getScreenshotBlob, getVideo, listRecordings, listScreenshots, markRecordingViewed, renameRecording, saveRecording, saveScreenshot, setRecordingAccess, setRecordingArchived, setRecordingCloudId, setRecordingFolder, setRecordingSpaces, type RecordingMeta, type ScreenshotMeta } from './lib/db';
import { addCloudTranscriptCue, createCloudComment, createCloudFolder, createCloudShareLink, createCloudSpace, deleteCloudRecording, deleteCloudScreenshot, deleteCloudTranscriptCue, downloadCloudRecording, getCloudPlaybackUrl, getCloudWorkspaceSettings, listCloudFolders, listCloudRecordings, listCloudScreenshots, listCloudSpaces, listCloudWatchLater, renameCloudRecording, replaceCloudRecordingVideo, revokeCloudShareLink, saveCloudScreenshot, searchCloudRecordings, setCloudReaction, setCloudRecordingFolder, setCloudRecordingSpaces, setCloudWatchLater, shareCloudRecordingToSlack, transferCloudRecordingOwnership, updateCloudRecording, uploadRecordingToCloud, type CloudFolder } from './lib/recordingsApi';
import { downloadRecording } from './lib/download';
import { checkSupport } from './lib/support';
import { AdminOverview, AdminSpaces, AdminUsers, CreateSpaceModal, InsightsPage, MeetingsPage, PlaylistsPage, RecentPage, SettingsPage, SpacePage, UpgradeModal, WatchLaterPage, WorkspaceSettings, type WorkspaceSpace } from './components/WorkspacePages';
import AuthPage from './components/AuthPage';
import { isPlanId, PLAN_CAPABILITIES, PLANS, type PlanId } from './lib/plans';

type Page = 'for-you' | 'library' | 'meetings' | 'playlists' | 'watch-later' | 'recent' | 'settings' | 'admin-overview' | 'admin-users' | 'admin-spaces' | 'admin-insights' | 'workspace-settings' | 'admin-billing' | 'admin-atlassian' | 'space' | 'record';

function readWorkspaceSpaces(): WorkspaceSpace[] {
  try { const stored: unknown = JSON.parse(localStorage.getItem('clientorahq-spaces') ?? '[]'); return Array.isArray(stored) ? stored as WorkspaceSpace[] : []; }
  catch { return []; }
}

function readWatchLaterIds(): string[] {
  try {
    const ids: unknown = JSON.parse(localStorage.getItem('clientorahq-watch-later') ?? '[]');
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [];
  } catch { return []; }
}

const Ico = I.Ico;

function AppHeader({ page, count, search, spaces, remote = false, canSearch, onSearch, onNavigate, onSelectSpace, onRecord, onCreateSpace, onUpgrade, onLogout }: { page: Page; count: number; search: string; spaces: WorkspaceSpace[]; remote?: boolean; canSearch: boolean; onSearch: (value: string) => void; onNavigate: (page: Page) => void; onSelectSpace: (id: string | null) => void; onRecord: () => void; onCreateSpace: () => void; onUpgrade: () => void; onLogout: () => void }) {
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const shortcut = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘K' : 'Ctrl K';
  const item = (id: Page, icon: string, label: string, extra?: ReactNode) => (
    <button className={page === id ? 'is-active' : ''} aria-current={page === id ? 'page' : undefined} onClick={() => onNavigate(id)}><Ico n={icon} />{label}{extra}</button>
  );
  return (
    <>
      <header className="loom-topbar">
        <div className="loom-top-left"><button className="top-icon collapse-icon" aria-label="Collapse sidebar"><Ico n="panel" /></button><button className="top-icon apps-icon" aria-label="Apps"><Ico n="grid" /></button><div className="loom-logo"><span><Ico n="logo" size={19} /></span><strong>Clientora<span>HQ</span></strong></div></div>
        <label className={canSearch ? 'global-search' : 'global-search is-locked'}><Ico n="search" size={17} /><input value={search} onChange={(event) => onSearch(event.currentTarget.value)} onClick={() => { if (!canSearch) onUpgrade(); }} readOnly={!canSearch} title={canSearch ? undefined : 'Upgrade to Business to search your workspace.'} placeholder={canSearch ? 'Search videos, folders and transcripts' : 'Search is available on Business'} aria-label={canSearch ? 'Search workspace content' : 'Search (Business plan required)'} />{canSearch && <kbd>{shortcut}</kbd>}</label>
        <div className="loom-top-actions"><button className="upgrade-button" onClick={onUpgrade}><Ico n="spark" size={15} />Upgrade</button><button className="top-icon" aria-label="Help"><Ico n="help" /></button><button className="top-icon notification-button" aria-label="Notifications"><Ico n="bell" /><i>2</i></button><div className="account-menu-anchor"><button className="user-avatar" aria-label="Account menu" title="Account menu" aria-haspopup="menu" aria-expanded={profileMenuOpen} onClick={() => setProfileMenuOpen((open) => !open)}>TJ</button>{profileMenuOpen && <div className="profile-menu" role="menu"><strong>Account</strong><button role="menuitem" onClick={() => { setProfileMenuOpen(false); onLogout(); }}>Sign out</button></div>}</div></div>
      </header>
      <aside className="loom-sidebar">
        <div className="loom-sidebar-scroll">
        <div className="workspace-card"><strong title="ClientoraHQ workspace">ClientoraHQ <span><Ico n="chevron" size={16} /></span></strong><div><span className="default-chip">Default</span><i /><span>1 member</span></div><button onClick={() => onNavigate('admin-users')}><Ico n="userPlus" size={16} />Invite teammates</button></div>
        <nav className="workspace-nav" aria-label="Workspace navigation">
          {item('for-you', 'compass', 'For you')}
          {item('library', 'play', 'Library', count > 0 ? <small>{count}</small> : null)}
          {item('meetings', 'calendar', 'Meetings')}
          {item('playlists', 'list', 'Playlists')}
          {item('watch-later', 'clock', 'Watch later')}
          {item('recent', 'history', 'Recent')}
          {item('settings', 'sliders', 'Personal settings')}
        </nav>
        <div className="sidebar-divider" />
        <p className="sidebar-section-label">Admin tools</p>
        <nav className="workspace-nav admin-nav" aria-label="Admin tools">
          {item('admin-overview', 'grid', 'Overview')}
          <button className={page === 'admin-users' || page === 'admin-spaces' ? 'is-active' : ''} onClick={() => onNavigate('admin-users')}><Ico n="users" />Manage</button>
          <button className={`admin-subnav${page === 'admin-users' ? ' is-active' : ''}`} onClick={() => onNavigate('admin-users')}>Users</button>
          <button className={`admin-subnav${page === 'admin-spaces' ? ' is-active' : ''}`} onClick={() => onNavigate('admin-spaces')}>Spaces</button>
          {item('admin-insights', 'chart', 'Insights')}
          {item('workspace-settings', 'building', 'Workspace')}
          {item('admin-billing', 'card', 'Billing')}
          {item('admin-atlassian', 'plug', 'Integrations')}
        </nav>
        <div className="sidebar-divider spaces-divider" />
        <div className="sidebar-spaces-heading"><span>Spaces</span><button aria-label="Create a space" title="Create a space" onClick={onCreateSpace}><Ico n="plus" size={16} /></button></div>
        <nav className="workspace-nav spaces-nav" aria-label="Spaces"><button onClick={() => onNavigate('admin-spaces')}><Ico n="layers" />Browse all Spaces</button>{spaces.map((space) => <button key={space.id} className={page === 'space' ? 'is-active' : ''} onClick={() => { onSelectSpace(space.id); onNavigate('space'); }}><b className="space-avatar">{space.name.slice(0, 1).toUpperCase()}</b>{space.name}</button>)}<button onClick={() => { onSelectSpace(null); onNavigate('library'); }}><b className="space-avatar">A</b>All workspace videos</button></nav>
        <div className="sidebar-local-note"><i /> {remote ? 'Workspace synced' : 'Saved on this device'}</div>
        </div>
        <button className="sidebar-record-button" onClick={onRecord}><Ico n="video" size={20} /> New recording</button>
      </aside>
    </>
  );
}

export default function App() {
  const support = checkSupport();
  const [items, setItems] = useState<RecordingMeta[]>([]);
  const [screenshots, setScreenshots] = useState<ScreenshotMeta[]>([]);
  const [cloudItems, setCloudItems] = useState<RecordingMeta[]>([]);
  const [searchResults, setSearchResults] = useState<RecordingMeta[]>([]);
  const [searchResultsQuery, setSearchResultsQuery] = useState('');
  const [searchHasMore, setSearchHasMore] = useState(false);
  const [searchNextOffset, setSearchNextOffset] = useState<number | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [cloudPlaybackUrl, setCloudPlaybackUrl] = useState<string | null>(null);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [page, setPage] = useState<Page>('for-you');
  const [openId, setOpenId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [spaces, setSpaces] = useState<WorkspaceSpace[]>(readWorkspaceSpaces);
  const [workspaceFolders, setWorkspaceFolders] = useState<CloudFolder[]>([]);
  const [selectedSpaceId, setSelectedSpaceId] = useState<string | null>(null);
  const [showCreateSpace, setShowCreateSpace] = useState(false);
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [plan, setPlan] = useState<PlanId>('starter');
  const [localDemo, setLocalDemo] = useState(false);
  const [watchLaterIds, setWatchLaterIds] = useState<string[]>(readWatchLaterIds);
  const planCapabilities = PLAN_CAPABILITIES[plan];
  const authFlow = window.location.pathname === '/login' ? 'login' : 'signup';
  const isAuthPage = window.location.pathname === '/signup' || window.location.pathname === '/login';
  const [authStatus, setAuthStatus] = useState<'checking' | 'authenticated' | 'unauthenticated' | 'error'>('checking');

  useEffect(() => {
    const onQuickSearch = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLocaleLowerCase() !== 'k' || event.altKey) return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return;
      if (localStorage.getItem('clientorahq-keyboard-shortcuts-enabled') === 'false') return;
      event.preventDefault();
      if (!planCapabilities.canSearch) { setShowUpgrade(true); return; }
      document.querySelector<HTMLInputElement>('.global-search input')?.focus();
    };
    window.addEventListener('keydown', onQuickSearch);
    return () => window.removeEventListener('keydown', onQuickSearch);
  }, [planCapabilities.canSearch]);

  useEffect(() => {
    let cancelled = false;
    void fetch('/api/v1/auth/me', { credentials: 'same-origin' }).then(async (response) => {
      if (cancelled) return;
      if (response.ok) {
        const payload = await response.json() as { user?: { plan?: unknown } };
        if (isPlanId(payload.user?.plan)) setPlan(payload.user.plan);
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
    let cancelled = false;
    void listScreenshots().then((list) => { if (!cancelled) setScreenshots((current) => [...current.filter((item) => item.isCloud), ...list]); }).catch(() => {
      if (!cancelled) setMessage('Could not open your local screenshots.');
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (authStatus !== 'authenticated' || localDemo) return;
    let cancelled = false;
    void listCloudRecordings().then((list) => { if (!cancelled) setCloudItems(list); }).catch((error) => {
      if (!cancelled) setMessage(error instanceof Error ? `Cloud library unavailable: ${error.message}` : 'Could not load cloud recordings.');
    });
    return () => { cancelled = true; };
  }, [authStatus, localDemo]);

  useEffect(() => {
    const query = search.trim();
    if (!planCapabilities.canSearch || authStatus !== 'authenticated' || localDemo || query.length < 2 || page === 'playlists') return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setSearchLoading(true);
      void searchCloudRecordings(query).then((result) => {
        if (cancelled) return;
        setSearchResults(result.recordings);
        setSearchResultsQuery(query);
        setSearchHasMore(result.hasMore);
        setSearchNextOffset(result.nextOffset);
      }).catch((error) => {
        if (!cancelled) setNotice(error instanceof Error ? error.message : 'Workspace search could not be completed.');
      }).finally(() => { if (!cancelled) setSearchLoading(false); });
    }, 250);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [authStatus, localDemo, page, planCapabilities.canSearch, search]);

  useEffect(() => {
    if (authStatus !== 'authenticated' || localDemo) return;
    let cancelled = false;
    void listCloudScreenshots().then((list) => { if (!cancelled) setScreenshots((current) => [...list, ...current.filter((item) => !item.isCloud)]); }).catch((error) => {
      if (!cancelled) setMessage(error instanceof Error ? `Cloud screenshots unavailable: ${error.message}` : 'Could not load workspace screenshots.');
    });
    return () => { cancelled = true; };
  }, [authStatus, localDemo]);

  useEffect(() => {
    if (authStatus !== 'authenticated' || localDemo) return;
    let cancelled = false;
    void listCloudWatchLater().then((ids) => {
      if (cancelled) return;
      setWatchLaterIds(ids);
      try { localStorage.setItem('clientorahq-watch-later', JSON.stringify(ids)); } catch { /* The server list remains available for this session. */ }
    }).catch((error) => { if (!cancelled) setMessage(error instanceof Error ? `Watch later sync unavailable: ${error.message}` : 'Could not sync Watch later.'); });
    return () => { cancelled = true; };
  }, [authStatus, localDemo]);

  useEffect(() => {
    if (authStatus !== 'authenticated' || localDemo) return;
    let cancelled = false;
    void listCloudFolders().then((list) => { if (!cancelled) setWorkspaceFolders(list); }).catch((error) => {
      if (!cancelled) setMessage(error instanceof Error ? `Workspace folders unavailable: ${error.message}` : 'Could not load workspace folders.');
    });
    return () => { cancelled = true; };
  }, [authStatus, localDemo]);

  useEffect(() => {
    if (authStatus !== 'authenticated' || localDemo) return;
    let cancelled = false;
    void listCloudSpaces().then((list) => { if (!cancelled) setSpaces(list); }).catch((error) => {
      if (!cancelled) setMessage(error instanceof Error ? `Workspace Spaces unavailable: ${error.message}` : 'Could not load workspace Spaces.');
    });
    return () => { cancelled = true; };
  }, [authStatus, localDemo]);

  const syncedCloudIds = new Set(cloudItems.map((meta) => meta.id));
  const recordingCount = items.filter((meta) => meta.source !== 'meeting' && (!meta.cloudId || !syncedCloudIds.has(meta.cloudId))).length
    + cloudItems.filter((meta) => meta.source !== 'meeting').length;
  const nextRecordingTitleRef = useRef<string | null>(null);

  const onSaved = useCallback((meta: RecordingMeta) => {
    const selectedTitle = nextRecordingTitleRef.current;
    nextRecordingTitleRef.current = null;
    const savedMeta = selectedTitle ? { ...meta, title: selectedTitle.slice(0, 120) } : meta;
    if (savedMeta.source !== 'meeting' && recordingCount >= planCapabilities.maxVideos) {
      void deleteRecording(meta.id);
      setNotice('Starter includes up to 25 saved videos. Delete a video or choose a paid plan to record another.');
      setShowUpgrade(true);
      setPage('library');
      return;
    }
    setItems((prev) => [savedMeta, ...prev]);
    setPage('library');
    setOpenId(meta.id);
    if (authStatus === 'authenticated' && !localDemo) {
      void (async () => {
        setUploadingId(meta.id);
        try {
          const blob = await getVideo(meta.id);
          if (!blob) throw new Error('The saved recording is no longer available in browser storage.');
          const cloudMeta = await uploadRecordingToCloud(savedMeta, blob);
          await setRecordingCloudId(meta.id, cloudMeta.id);
          setItems((previous) => previous.map((item) => item.id === meta.id ? { ...item, cloudId: cloudMeta.id } : item));
          setCloudItems((previous) => [cloudMeta, ...previous.filter((item) => item.id !== cloudMeta.id)]);
          setNotice('Recording saved in your cloud library.');
        } catch (error) {
          setMessage(error instanceof Error ? `Recording is saved on this device; cloud backup failed: ${error.message}` : 'Recording is saved on this device; cloud backup failed.');
        } finally {
          setUploadingId(null);
        }
      })();
    }
  }, [authStatus, localDemo, planCapabilities.maxVideos, recordingCount]);
  const rec = useRecorder(onSaved, planCapabilities.maxRecordingSeconds, plan === 'starter' ? 1280 : 1920, plan === 'starter' ? 720 : 1080, planCapabilities.maxVideos, (message) => {
    setNotice(message);
    if (plan === 'starter') setShowUpgrade(true);
    setPage('library');
  }, planCapabilities.canSuppressBackgroundNoise);
  const localCloudIds = new Set(items.map((meta) => meta.cloudId).filter((id): id is string => Boolean(id)));
  const cloudById = new Map(cloudItems.map((meta) => [meta.id, meta]));
  const libraryItems = [
    ...items.map((item) => {
      const cloud = item.cloudId ? cloudById.get(item.cloudId) : undefined;
      return cloud ? { ...item, title: cloud.title, summary: cloud.summary, meetingRecap: cloud.meetingRecap, access: cloud.access, archived: cloud.archived, viewCount: cloud.viewCount, canManage: cloud.canManage, comments: cloud.comments, reactions: cloud.reactions, myReactions: cloud.myReactions, reactionCount: cloud.reactionCount, reacted: cloud.reacted, transcript: cloud.transcript, spaceIds: cloud.spaceIds, folderId: cloud.folderId, folderName: cloud.folderName, isCloud: false } : item;
    }),
    ...cloudItems.filter((meta) => !localCloudIds.has(meta.id)),
  ];
  const current = libraryItems.find((meta) => meta.id === openId) ?? null;
  const selectedSpace = spaces.find((space) => space.id === selectedSpaceId) ?? null;
  const searchTerm = search.trim().toLocaleLowerCase();
  const serverSearchActive = authStatus === 'authenticated' && !localDemo && planCapabilities.canSearch && search.trim().length >= 2 && page !== 'playlists';
  const loadMoreSearchResults = async () => {
    if (searchLoading || !searchHasMore || searchNextOffset === null) return;
    setSearchLoading(true);
    try {
      const result = await searchCloudRecordings(search.trim(), searchNextOffset);
      setSearchResults((previous) => [...previous, ...result.recordings.filter((item) => !previous.some((existing) => existing.id === item.id))]);
      setSearchHasMore(result.hasMore);
      setSearchNextOffset(result.nextOffset);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not load more search results.');
    } finally {
      setSearchLoading(false);
    }
  };
  const filteredItems = serverSearchActive
    ? searchResultsQuery === search.trim() ? searchResults : []
    : planCapabilities.canSearch && searchTerm
    ? libraryItems.filter((item) => {
      const folderName = item.folderName ?? workspaceFolders.find((folder) => folder.id === item.folderId)?.name ?? '';
      const linkedSpaceNames = spaces
        .filter((space) => item.spaceIds?.includes(space.id))
        .map((space) => space.name);
      const searchableText = [
        item.title,
        item.source === 'meeting' ? 'meeting recording' : 'video',
        folderName,
        ...linkedSpaceNames,
        ...(item.comments ?? []).map((comment) => comment.text),
        ...(item.transcript ?? []).map((cue) => cue.text),
      ].join('\n').toLocaleLowerCase();
      return searchableText.includes(searchTerm);
    })
    : libraryItems;
  const activeItems = filteredItems.filter((item) => !item.archived);
  const availableRecordings = libraryItems.filter((item) => !item.archived);
  const watchLaterItems = availableRecordings.filter((item) => watchLaterIds.includes(item.id));
  const archivedItems = filteredItems.filter((item) => item.archived);
  const visiblePage: Page = page === 'record' && rec.phase === 'idle' && !openId ? 'for-you' : page;

  const startRecording = (source: 'recorded' | 'meeting' = 'recorded', meetingTitle?: string) => {
    if (source !== 'meeting' && recordingCount >= planCapabilities.maxVideos) {
      setNotice(`Starter includes up to 25 saved videos. Delete a video or choose a paid plan to record another.`);
      setShowUpgrade(true);
      return;
    }
    const openRecorder = () => {
      nextRecordingTitleRef.current = source === 'meeting' ? meetingTitle?.trim() || null : null;
      setMessage(null);
      setOpenId(null);
      setPage('record');
      void rec.openPanel(source);
    };
    if (source === 'meeting') {
      if (authStatus === 'authenticated' && !localDemo) {
        void getCloudWorkspaceSettings().then((settings) => {
          if (!settings.allowMeetingRecordings) {
            setNotice('Meeting recordings are disabled for this workspace. Ask a workspace admin to enable them.');
            return;
          }
          openRecorder();
        }).catch(() => setNotice('Could not load meeting recording settings. Please try again.'));
        return;
      }
      if (localStorage.getItem('clientorahq-meeting-access') === 'false') {
        setNotice('Meeting recordings are disabled in workspace settings.');
        return;
      }
    }
    openRecorder();
  };

  const navigate = (next: Page) => {
    if (next === 'record') {
      startRecording();
      return;
    }
    if (rec.phase !== 'idle') rec.cancel();
    setOpenId(null);
    if (next === 'playlists') setSearchLoading(false);
    setPage(next);
  };

  const updateSearch = (value: string) => {
    setSearch(value);
    setSearchResults([]);
    setSearchResultsQuery('');
    setSearchHasMore(false);
    setSearchNextOffset(null);
    setSearchLoading(false);
    if (value.trim()) { setOpenId(null); setPage((current) => current === 'playlists' ? 'playlists' : 'library'); }
  };

  const toggleArchive = async (meta: RecordingMeta) => {
    const cloudId = meta.isCloud ? meta.id : meta.cloudId;
    const archived = !meta.archived;
    if (cloudId) {
      await updateCloudRecording(cloudId, { archived });
      setCloudItems((previous) => previous.map((item) => item.id === cloudId ? { ...item, archived } : item));
    }
    if (items.some((item) => item.id === meta.id)) {
      const updated = await setRecordingArchived(meta.id, archived);
      setItems((previous) => previous.map((item) => item.id === updated.id ? updated : item));
    }
    setNotice(archived ? 'Video moved to Archive.' : 'Video restored to Videos.');
  };

  const assignRecordingSpaces = async (id: string, spaceIds: string[]) => {
    try {
      const current = libraryItems.find((item) => item.id === id);
      const cloudId = current?.isCloud ? current.id : current?.cloudId;
      if (cloudId) {
        await setCloudRecordingSpaces(cloudId, spaceIds);
        setCloudItems((previous) => previous.map((item) => item.id === cloudId ? { ...item, spaceIds } : item));
      }
      if (items.some((item) => item.id === id)) {
        const updated = await setRecordingSpaces(id, spaceIds);
        setItems((previous) => previous.map((item) => item.id === id ? updated : item));
      }
      setNotice(spaceIds.length ? 'Space assignment saved.' : 'Space assignment removed.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not update this recording’s Spaces.'); }
  };

  const assignRecordingFolder = async (id: string, folderName: string) => {
    try {
      const current = libraryItems.find((item) => item.id === id);
      const cloudId = current?.isCloud ? current.id : current?.cloudId;
      const folder = workspaceFolders.find((entry) => entry.name === folderName);
      if (cloudId) {
        const updated = await setCloudRecordingFolder(cloudId, folder?.id ?? null);
        setCloudItems((previous) => previous.map((item) => item.id === cloudId ? { ...item, folderId: updated.folderId ?? null, folderName: (updated.folderName ?? folderName) || null } : item));
      }
      if (items.some((item) => item.id === id)) {
        const updated = await setRecordingFolder(id, folderName || null, folder?.id ?? null);
        setItems((previous) => previous.map((item) => item.id === id ? updated : item));
      }
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not move this video to the folder.'); }
  };

  const changeRecordingAccess = async (id: string, access: 'private' | 'workspace') => {
    try {
      const current = libraryItems.find((item) => item.id === id);
      const cloudId = current?.isCloud ? current.id : current?.cloudId;
      if (cloudId) {
        await updateCloudRecording(cloudId, { access });
        setCloudItems((previous) => previous.map((item) => item.id === cloudId ? { ...item, access } : item));
      }
      if (items.some((item) => item.id === id)) {
        const updated = await setRecordingAccess(id, access);
        setItems((previous) => previous.map((item) => item.id === id ? updated : item));
      }
      setNotice(access === 'private' ? 'Recording is private.' : 'Recording is shared with workspace members.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not update recording access.'); }
  };

  const toggleWatchLater = async (id: string) => {
    const meta = libraryItems.find((item) => item.id === id);
    const cloudId = meta?.isCloud ? meta.id : meta?.cloudId;
    const watchId = cloudId ?? id;
    const active = !watchLaterIds.includes(watchId) && !watchLaterIds.includes(id);
    if (cloudId && authStatus === 'authenticated' && !localDemo) {
      try { await setCloudWatchLater(cloudId, active); }
      catch (error) { setMessage(error instanceof Error ? error.message : 'Could not sync Watch later.'); return; }
    }
    const next = active
      ? [...watchLaterIds.filter((entry) => entry !== id), watchId]
      : watchLaterIds.filter((entry) => entry !== id && entry !== watchId);
    try {
      localStorage.setItem('clientorahq-watch-later', JSON.stringify(next));
      setWatchLaterIds(next);
      setNotice(next.includes(id) ? 'Added to Watch later.' : 'Removed from Watch later.');
    } catch {
      setMessage('Could not save your Watch later list in this browser.');
    }
  };

  const captureScreenshot = async (recording: RecordingMeta, blob: Blob, preview: string) => {
    try {
      if (recording.isCloud || recording.cloudId) {
        const screenshot = await saveCloudScreenshot(recording.isCloud ? recording.id : recording.cloudId!, recording.title, blob);
        setScreenshots((previous) => [screenshot, ...previous]);
        setNotice('Screenshot saved to your workspace Library.');
        return;
      }
      const screenshot = await saveScreenshot(recording.id, recording.title, blob, preview);
      setScreenshots((previous) => [screenshot, ...previous]);
      setNotice('Screenshot saved to your local Library.');
    } catch {
      setMessage('Could not save this screenshot. Check available browser storage.');
    }
  };

  const downloadScreenshot = async (screenshot: ScreenshotMeta) => {
    try {
      const blob = screenshot.isCloud && screenshot.cloudUrl
        ? await fetch(screenshot.cloudUrl).then((response) => {
          if (!response.ok) throw new Error('The screenshot download link expired. Reload the Library and try again.');
          return response.blob();
        })
        : await getScreenshotBlob(screenshot.id);
      if (!blob) throw new Error('This screenshot is no longer available in browser storage.');
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${screenshot.title.replace(/[\\/:*?"<>|]+/g, '-')}-screenshot.jpg`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not download this screenshot.'); }
  };

  const removeScreenshot = async (id: string) => {
    try {
      if (screenshots.find((screenshot) => screenshot.id === id)?.isCloud) await deleteCloudScreenshot(id);
      else await deleteScreenshot(id);
      setScreenshots((previous) => previous.filter((screenshot) => screenshot.id !== id));
      setNotice('Screenshot deleted.');
    } catch { setMessage('Could not delete this screenshot.'); }
  };

  const openRecording = async (id: string) => {
    const meta = libraryItems.find((item) => item.id === id);
    if (meta?.isCloud || meta?.cloudId) {
      const cloudId = meta.isCloud ? meta.id : meta.cloudId!;
      setMessage(null);
      try {
        const cloud = await getCloudPlaybackUrl(cloudId);
        setCloudItems((previous) => [cloud.recording, ...previous.filter((item) => item.id !== cloudId)]);
        if (meta.isCloud) {
          setCloudPlaybackUrl(cloud.url);
          setOpenId(id);
          return;
        }
      } catch (error) {
        if (meta.isCloud) {
          setMessage(error instanceof Error ? error.message : 'Could not open this cloud recording.');
          return;
        }
      }
    }
    setCloudPlaybackUrl(null);
    setOpenId(id);
    void markRecordingViewed(id).then((updated) => {
      if (updated) setItems((previous) => previous.map((item) => item.id === id ? updated : item));
    });
  };

  const uploadToCloud = async (meta: RecordingMeta) => {
    if (!planCapabilities.canUpload) {
      setNotice('Cloud uploads are available on Business plans. Choose a plan to continue.');
      setShowUpgrade(true);
      return;
    }
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

  const retryCloudBackup = async (meta: RecordingMeta) => {
    if (authStatus !== 'authenticated' || localDemo || uploadingId) return;
    setUploadingId(meta.id);
    setMessage(null);
    try {
      const blob = await getVideo(meta.id);
      if (!blob) throw new Error('This video is no longer available in local browser storage.');
      const cloudMeta = await uploadRecordingToCloud(meta, blob);
      await setRecordingCloudId(meta.id, cloudMeta.id);
      setItems((previous) => previous.map((item) => item.id === meta.id ? { ...item, cloudId: cloudMeta.id } : item));
      setCloudItems((previous) => [cloudMeta, ...previous.filter((item) => item.id !== cloudMeta.id)]);
      setNotice('Recording backed up. Share links are available; embedded players require Business.');
    } catch (error) {
      setMessage(error instanceof Error ? `Could not back up this recording: ${error.message}` : 'Could not back up this recording. Check the workspace storage connection.');
    } finally {
      setUploadingId(null);
    }
  };

  const uploadVideo = async (file: File) => {
    if (!planCapabilities.canUpload) {
      setNotice('Video uploads are available on Business plans. Choose a plan to continue.');
      setShowUpgrade(true);
      return;
    }
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
        if (meta?.cloudId) {
          await renameCloudRecording(meta.cloudId, title);
          setCloudItems((prev) => prev.map((item) => item.id === meta.cloudId ? { ...item, title } : item));
        }
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
        setScreenshots((previous) => previous.filter((shot) => !localCopies.some((item) => item.id === shot.recordingId)));
      } else {
        if (meta.cloudId) {
          await deleteCloudRecording(meta.cloudId);
          setCloudItems((prev) => prev.filter((item) => item.id !== meta.cloudId));
        }
        await deleteRecording(meta.id);
        setItems((prev) => prev.filter((item) => item.id !== meta.id));
        setScreenshots((previous) => previous.filter((shot) => shot.recordingId !== meta.id));
      }
      if (openId === meta.id) setOpenId(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not delete this video.');
    }
  };

  const download = async (meta: RecordingMeta) => {
    if (!planCapabilities.canDownload) {
      setNotice('Video downloads are available on Business plans. Choose a plan to continue.');
      setShowUpgrade(true);
      return;
    }
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

  const shareRecording = async (meta: RecordingMeta) => createCloudShareLink(meta.isCloud ? meta.id : meta.cloudId!);
  const sendRecordingToSlack = async (meta: RecordingMeta, shareUrl: string) => shareCloudRecordingToSlack(meta.isCloud ? meta.id : meta.cloudId!, shareUrl);
  const revokeRecordingShare = async (meta: RecordingMeta) => revokeCloudShareLink(meta.isCloud ? meta.id : meta.cloudId!);
  const transferRecordingOwnership = useCallback(async (meta: RecordingMeta, memberId: string) => {
    const cloudId = meta.isCloud ? meta.id : meta.cloudId;
    if (!cloudId) throw new Error('Only cloud recordings can be transferred to a workspace member.');
    await transferCloudRecordingOwnership(cloudId, memberId);
    const localCopies = items.filter((item) => item.id === meta.id || item.cloudId === cloudId);
    await Promise.all(localCopies.map((item) => deleteRecording(item.id)));
    setItems((previous) => previous.filter((item) => !localCopies.some((copy) => copy.id === item.id)));
    const refreshed = await listCloudRecordings();
    setCloudItems(refreshed);
    setOpenId(null);
    setCloudPlaybackUrl(null);
    setPage('library');
    setNotice('Recording ownership transferred. The new owner now manages the cloud recording.');
  }, [items]);

  const logOut = async () => {
    try {
      const response = await fetch('/api/v1/auth/logout', { method: 'POST', credentials: 'same-origin' });
      if (!response.ok) throw new Error('Could not sign out right now. Please try again.');
      window.location.replace('/login');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not sign out right now. Check your connection and try again.');
    }
  };

  const choosePlan = async (nextPlan: PlanId) => {
    try {
      const response = await fetch('/api/v1/account/plan', {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: nextPlan }),
      });
      const payload = await response.json() as { plan?: unknown; error?: { message?: string } };
      if (!response.ok || !isPlanId(payload.plan)) throw new Error(payload.error?.message || 'Could not update your plan.');
      setPlan(payload.plan);
      setShowUpgrade(false);
      const selectedName = PLANS.find((entry) => entry.id === payload.plan)?.name ?? 'Starter';
      setNotice(`${selectedName} selected for feature testing. No payment was processed.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not update your plan. Check your connection and try again.');
    }
  };

  const shareToken = window.location.pathname.match(/^\/share\/([^/]+)\/?$/)?.[1];
  if (shareToken) return <PublicSharePage token={shareToken} />;
  if (authStatus === 'checking') return <div className="pdf-preparing"><span className="pdf-spinner" />Signing you in…</div>;
  if (authStatus === 'error') return <main className="pdf-error-page"><article className="pdf-error-card"><h1>We can’t reach your account</h1><p>Check your internet connection and try again. If the problem continues, the sign-in service may be temporarily unavailable.</p><button onClick={() => window.location.reload()}>Try again</button><p><a href="/login">Go to sign in</a></p>{import.meta.env.DEV && <div className="local-demo-entry"><p>For UI work, open the device-only Starter demo. This bypasses sign-in in this development build; videos stay in this browser.</p><button onClick={() => { if (isAuthPage) window.history.replaceState({}, '', '/'); setLocalDemo(true); setAuthStatus('authenticated'); }}>Open local Starter demo</button></div>}</article></main>;
  if (isAuthPage) return <AuthPage initialFlow={authFlow} />;

  if (support.ok === false) {
    return (
      <div className="min-h-screen bg-wash">
        <AppHeader page="library" count={activeItems.length} search={search} spaces={spaces} canSearch={planCapabilities.canSearch} remote={authStatus === 'authenticated' && !localDemo} onSearch={updateSearch} onNavigate={navigate} onSelectSpace={setSelectedSpaceId} onRecord={() => startRecording()} onCreateSpace={() => setShowCreateSpace(true)} onUpgrade={() => setShowUpgrade(true)} onLogout={() => void logOut()} />
        <main className="pdf-error-page">
          <article className="pdf-error-card">
            <span className="pdf-error-icon is-info">i</span>
            <h1>Please use a desktop browser</h1>
            <p>{support.reason} For the best experience, open ClientoraHQ in the latest desktop version of Chrome, Edge, or Firefox.</p>
            <button onClick={() => void copyPageLink()}>{message === 'Page link copied.' ? 'Link copied' : 'Copy page link'}</button>
          </article>
        </main>
      </div>
    );
  }

  const storageUsed = items.reduce((sum, meta) => sum + meta.size, 0) + screenshots.reduce((sum, screenshot) => sum + screenshot.size, 0);

  return (
    <div className="loom-app-shell">
      <AppHeader page={visiblePage} count={activeItems.length} search={search} spaces={spaces} canSearch={planCapabilities.canSearch} remote={authStatus === 'authenticated' && !localDemo} onSearch={updateSearch} onNavigate={navigate} onSelectSpace={setSelectedSpaceId} onRecord={() => startRecording()} onCreateSpace={() => setShowCreateSpace(true)} onUpgrade={() => setShowUpgrade(true)} onLogout={() => void logOut()} />
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
            canShare={Boolean((current.isCloud || current.cloudId) && current.canManage && authStatus === 'authenticated' && !localDemo)}
            cloudBackupBusy={uploadingId === current.id}
            onRetryCloudBackup={authStatus === 'authenticated' && !localDemo && !current.isCloud && !current.cloudId ? () => void retryCloudBackup(current) : undefined}
            onShare={() => shareRecording(current)}
            onRevokeShare={() => revokeRecordingShare(current)}
            onShareSlack={(shareUrl) => sendRecordingToSlack(current, shareUrl)}
            onTransferOwnership={current.canManage && (current.isCloud || current.cloudId) && authStatus === 'authenticated' && !localDemo ? (memberId) => transferRecordingOwnership(current, memberId) : undefined}
            canTrim={planCapabilities.canTrim}
            canDownload={planCapabilities.canDownload}
            canEmbed={planCapabilities.canEmbed}
            canGenerateAi={planCapabilities.hasAi && authStatus === 'authenticated' && !localDemo && current.canManage !== false && Boolean(current.isCloud || current.cloudId)}
            onUpgrade={() => setShowUpgrade(true)}
            isWatchLater={watchLaterIds.includes(current.id)}
            onToggleWatchLater={() => toggleWatchLater(current.id)}
            onInteractionUpdated={(updated) => {
              setItems((previous) => previous.map((item) => item.id === updated.id ? updated : item));
              const cloudId = current.isCloud ? current.id : current.cloudId;
              if (cloudId) setCloudItems((previous) => previous.map((item) => item.id === cloudId ? { ...item, title: updated.title, summary: updated.summary, meetingRecap: updated.meetingRecap, comments: updated.comments, reactions: updated.reactions, myReactions: updated.myReactions, reactionCount: updated.reactionCount, reacted: updated.reacted, transcript: updated.transcript } : item));
            }}
            onCloudComment={async (text) => current.isCloud || current.cloudId ? createCloudComment(current.isCloud ? current.id : current.cloudId!, text) : null}
            onCloudReaction={async (emoji, active) => current.isCloud || current.cloudId ? setCloudReaction(current.isCloud ? current.id : current.cloudId!, emoji, active) : null}
            onCloudAddTranscript={async (startMs, text) => current.isCloud || current.cloudId ? addCloudTranscriptCue(current.isCloud ? current.id : current.cloudId!, startMs, text) : null}
            onCloudDeleteTranscript={async (cueId) => { if (current.isCloud || current.cloudId) await deleteCloudTranscriptCue(current.isCloud ? current.id : current.cloudId!, cueId); }}
            onCaptureScreenshot={(blob, preview) => void captureScreenshot(current, blob, preview)}
            onTrimmed={async (updated) => {
              if (updated.isCloud) {
                setCloudItems((previous) => previous.map((item) => item.id === updated.id ? updated : item));
                try {
                  const playback = await getCloudPlaybackUrl(updated.id);
                  setCloudPlaybackUrl(playback.url);
                  setCloudItems((previous) => previous.map((item) => item.id === updated.id ? playback.recording : item));
                } catch (error) {
                  setMessage(error instanceof Error ? `Trimmed video saved, but the updated player link could not be loaded: ${error.message}` : 'Trimmed video saved, but the updated player link could not be loaded.');
                }
                return;
              }
              setItems((previous) => previous.map((item) => item.id === updated.id ? updated : item));
              if (updated.cloudId && authStatus === 'authenticated' && !localDemo) {
                try {
                  const blob = await getVideo(updated.id);
                  if (!blob) throw new Error('The saved local copy is missing.');
                  const cloudRecording = await replaceCloudRecordingVideo(updated.cloudId, blob, updated.durationMs, updated.mimeType, updated.transcript);
                  setCloudItems((previous) => previous.map((item) => item.id === updated.cloudId ? cloudRecording : item));
                } catch (error) {
                  setMessage(error instanceof Error ? `Trimmed video is saved on this device, but cloud sync failed: ${error.message}` : 'Trimmed video is saved on this device, but cloud sync failed.');
                }
              }
            }}
          />
        ) : visiblePage === 'library' ? (
          <Library
            items={activeItems}
            archivedItems={archivedItems}
            total={activeItems.length}
            storageUsed={storageUsed}
            recordingCount={recordingCount}
            maxVideos={planCapabilities.maxVideos}
            onOpen={openRecording}
            onRename={(id, title) => void rename(id, title)}
            onDelete={(meta) => void remove(meta)}
            onNew={startRecording}
            onArchive={(meta) => void toggleArchive(meta)}
            onUpload={(meta) => void uploadToCloud(meta)}
            onDownload={(meta) => void download(meta)}
            uploadingId={uploadingId}
            canUpload={planCapabilities.canUpload}
            canDownload={planCapabilities.canDownload}
            onUpgrade={() => setShowUpgrade(true)}
            watchLaterIds={watchLaterIds}
            onToggleWatchLater={toggleWatchLater}
            screenshots={screenshots}
            onDeleteScreenshot={(id) => void removeScreenshot(id)}
            onDownloadScreenshot={(screenshot) => void downloadScreenshot(screenshot)}
            spaces={spaces}
            onAssignSpaces={(id, spaceIds) => void assignRecordingSpaces(id, spaceIds)}
            onSetAccess={(id, access) => void changeRecordingAccess(id, access)}
            workspaceFolders={authStatus === 'authenticated' && !localDemo ? workspaceFolders : undefined}
            onCreateFolder={authStatus === 'authenticated' && !localDemo ? async (name) => {
              const folder = await createCloudFolder(name);
              setWorkspaceFolders((previous) => [...previous, folder]);
            } : undefined}
            onSetFolder={authStatus === 'authenticated' && !localDemo ? (id, name) => void assignRecordingFolder(id, name) : undefined}
            searchQuery={serverSearchActive ? search : ''}
            searchLoading={searchLoading}
            searchHasMore={serverSearchActive && searchHasMore}
            onLoadMoreSearch={loadMoreSearchResults}
          />
        ) : visiblePage === 'meetings' ? (
          <MeetingsPage remote={authStatus === 'authenticated' && !localDemo} onRecord={(title) => startRecording('meeting', title)} />
        ) : visiblePage === 'playlists' ? (
          <PlaylistsPage recordings={availableRecordings} searchQuery={planCapabilities.canSearch ? search : ''} onOpenRecording={openRecording} onOpenLibrary={() => navigate('library')} />
        ) : visiblePage === 'watch-later' ? (
          <WatchLaterPage items={watchLaterItems} onOpen={openRecording} onRemove={toggleWatchLater} />
        ) : visiblePage === 'recent' ? (
          <RecentPage items={activeItems} onOpen={openRecording} />
        ) : visiblePage === 'settings' ? (
          <SettingsPage onConnect={() => setNotice('Calendar connection is not configured in this local workspace.')} />
        ) : visiblePage === 'admin-overview' ? (
          <AdminOverview items={libraryItems} onNavigate={navigate} onInvite={() => navigate('admin-users')} canViewEngagementInsights={planCapabilities.canViewEngagementInsights} onUpgrade={() => setShowUpgrade(true)} />
        ) : visiblePage === 'admin-users' ? (
          <AdminUsers maxUsers={planCapabilities.maxUsers} remote={!localDemo} onNotice={setNotice} />
        ) : visiblePage === 'admin-spaces' ? (
          <AdminSpaces items={activeItems} spaces={spaces} remote={authStatus === 'authenticated' && !localDemo} />
        ) : visiblePage === 'space' && selectedSpace ? (
          <SpacePage space={selectedSpace} items={activeItems} onOpen={openRecording} onUnshare={(meta) => { void assignRecordingSpaces(meta.id, (meta.spaceIds ?? []).filter((id) => id !== selectedSpace.id)); }} remote={authStatus === 'authenticated' && !localDemo} />
        ) : visiblePage === 'admin-insights' ? (
          planCapabilities.canViewEngagementInsights ? <InsightsPage items={libraryItems} remote={authStatus === 'authenticated' && !localDemo} /> : <section className="admin-page"><p className="settings-owner">Workspace</p><h1>Insights</h1><div className="settings-card plan-feature-locked"><h2>Engagement insights are part of Business</h2><p>See workspace-wide video views and recording activity. Starter still includes viewer insights on individual recordings.</p><button className="library-new-video" onClick={() => setShowUpgrade(true)}>View plans</button></div></section>
        ) : visiblePage === 'workspace-settings' ? (
          <WorkspaceSettings items={items} remote={authStatus === 'authenticated' && !localDemo} plan={plan} onUpgrade={() => setShowUpgrade(true)} onConnect={() => setNotice('Calendar connection is not configured in this local workspace.')} />
        ) : visiblePage === 'admin-billing' || visiblePage === 'admin-atlassian' ? (
          <section className="admin-placeholder"><h1>{visiblePage === 'admin-billing' ? 'Billing' : 'Integrations'}</h1><p>This section becomes available once your workspace is connected to an account service.</p></section>
        ) : visiblePage === 'for-you' ? (
          <section className="loom-home-empty">
            <div className="home-hero-icon" aria-hidden="true"><Ico n="video" size={38} /></div>
            <span className="home-eyebrow">Welcome to ClientoraHQ</span>
            <h1>Say it with a video, not another meeting</h1>
            <p>Record your screen and camera in seconds, then share a link your team can watch whenever it suits them.</p>
            <div className="home-actions"><button className="home-record-button" onClick={() => startRecording()}><Ico n="video" size={19} /> Start recording</button><label className="home-upload-button"><Ico n="upload" size={17} /> Upload a video{!planCapabilities.canUpload && <em>Business</em>}<input type="file" accept="video/*" onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) void uploadVideo(file); event.currentTarget.value = ''; }} /></label></div>
            <span className="home-local-hint">{authStatus === 'authenticated' && !localDemo ? 'Your recordings are backed up to your workspace library.' : 'Your recordings are saved privately on this device.'}</span>
          </section>
        ) : (
          <div className="pdf-preparing"><span className="pdf-spinner" />Getting your camera and microphone ready…</div>
        )}
      </main>
      <RecorderUI r={rec} libraryCount={items.length} />
      {showCreateSpace && <CreateSpaceModal onClose={() => setShowCreateSpace(false)} remote={authStatus === 'authenticated' && !localDemo} onCreate={(space) => {
        void (async () => {
          try {
            const created = authStatus === 'authenticated' && !localDemo ? await createCloudSpace(space) : space;
            const next = [created, ...spaces];
            setSpaces(next);
            if (!(authStatus === 'authenticated' && !localDemo)) localStorage.setItem('clientorahq-spaces', JSON.stringify(next));
            setShowCreateSpace(false);
            setNotice(authStatus === 'authenticated' && !localDemo ? `Space “${space.name}” created for the workspace.` : `Space “${space.name}” created locally.`);
          } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not create this Space.'); }
        })();
      }} />}
      {showUpgrade && <UpgradeModal currentPlan={plan} onClose={() => setShowUpgrade(false)} onChoose={(nextPlan) => void choosePlan(nextPlan)} />}
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
