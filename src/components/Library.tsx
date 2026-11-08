import { useEffect, useState } from 'react';
import type { RecordingMeta, ScreenshotMeta } from '../lib/db';
import { getVideo } from '../lib/db';
import { getCloudPreviewUrl, getCloudThumbnailUrl } from '../lib/recordingsApi';
import { fmtDate, fmtSize, fmtTime } from '../lib/format';
import { Ico } from './Icons';

interface Props {
  items: RecordingMeta[];
  archivedItems: RecordingMeta[];
  total: number;
  storageUsed: number;
  recordingCount: number;
  maxVideos: number;
  onOpen: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (meta: RecordingMeta) => void;
  onNew: () => void;
  onArchive: (meta: RecordingMeta) => void;
  onUpload: (meta: RecordingMeta) => void;
  onDownload: (meta: RecordingMeta) => void;
  uploadingId: string | null;
  canUpload: boolean;
  canDownload: boolean;
  onUpgrade: () => void;
  watchLaterIds: string[];
  onToggleWatchLater: (id: string) => void;
  screenshots: ScreenshotMeta[];
  onDeleteScreenshot: (id: string) => void;
  onDownloadScreenshot: (item: ScreenshotMeta) => void;
  spaces: { id: string; name: string; privacy: 'open' | 'closed' }[];
  onAssignSpaces: (id: string, spaceIds: string[]) => void;
  onSetAccess: (id: string, access: 'private' | 'workspace') => void;
  workspaceFolders?: { id: string; name: string }[];
  onCreateFolder?: (name: string) => Promise<void>;
  onSetFolder?: (id: string, name: string) => void;
  searchQuery?: string;
  searchLoading?: boolean;
  searchHasMore?: boolean;
  onLoadMoreSearch?: () => void;
}

const displaySize = (bytes: number) => bytes < 1_000_000
  ? `${bytes === 0 ? 0 : Math.max(1, Math.round(bytes / 1000))} KB`
  : `${(bytes / 1_000_000).toFixed(0)} MB`;

type LibraryView = 'videos' | 'screenshots' | 'archive';
type FilterKey = 'type' | 'access' | 'activity' | 'date';
type Filters = Record<FilterKey, string[]>;
const FILTER_OPTIONS: Record<FilterKey, string[]> = {
  type: ['Meeting recordings', 'Screen recordings'],
  access: ['Only me', 'Workspace'],
  activity: ['Never watched', 'Stale', 'Older than 30 days', 'Older than 90 days', 'Older than 180 days'],
  date: ['Today', 'This month', 'This year'],
};
const EMPTY_FILTERS: Filters = { type: [], access: [], activity: [], date: [] };

export default function Library({ items, archivedItems, total, storageUsed, recordingCount, maxVideos, onOpen, onRename, onDelete, onNew, onArchive, onUpload, onDownload, uploadingId, canUpload, canDownload, onUpgrade, watchLaterIds, onToggleWatchLater, screenshots, onDeleteScreenshot, onDownloadScreenshot, spaces, onAssignSpaces, onSetAccess, workspaceFolders, onCreateFolder, onSetFolder, searchQuery = '', searchLoading = false, searchHasMore = false, onLoadMoreSearch }: Props) {
  const [now] = useState(() => Date.now());
  const [view, setView] = useState<LibraryView>('videos');
  const [folders, setFolders] = useState<string[]>(() => {
    try { const value: unknown = JSON.parse(localStorage.getItem('clientorahq-folders') ?? '[]'); return Array.isArray(value) ? value.filter((name): name is string => typeof name === 'string') : []; }
    catch { return []; }
  });
  const [folderByRecording, setFolderByRecording] = useState<Record<string, string>>(() => {
    try { const value: unknown = JSON.parse(localStorage.getItem('clientorahq-recording-folders') ?? '{}'); return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, string> : {}; }
    catch { return {}; }
  });
  const [activeFolder, setActiveFolder] = useState('');
  const folderNames = workspaceFolders?.map((folder) => folder.name) ?? folders;
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [draftFilter, setDraftFilter] = useState<string[]>([]);
  const [openFilter, setOpenFilter] = useState<FilterKey | 'sort' | null>(null);
  const [sortOldest, setSortOldest] = useState(false);
  const visibleItems = view === 'archive' ? archivedItems : items;
  const heading = view === 'videos' ? 'Videos' : view === 'screenshots' ? 'Screenshots' : 'Archive';
  const count = view === 'archive' ? archivedItems.length : total;
  const filteredItems = visibleItems.filter((meta) => {
    if (activeFolder && (meta.folderName ?? folderByRecording[meta.id]) !== activeFolder) return false;
    const date = new Date(meta.createdAt);
    const today = new Date();
    const selectedType = filters.type;
    if (selectedType.length && !selectedType.some((type) => type === 'Meeting recordings' ? meta.source === 'meeting' : meta.source !== 'meeting')) return false;
    if (filters.access.length && !filters.access.includes(meta.access === 'workspace' ? 'Workspace' : 'Only me')) return false;
    if (filters.activity.includes('Never watched') && meta.lastViewedAt) return false;
    const staleThreshold = filters.activity.includes('Older than 180 days') ? 180 : filters.activity.includes('Older than 90 days') ? 90 : filters.activity.includes('Older than 30 days') || filters.activity.includes('Stale') ? 30 : 0;
    if (staleThreshold && (!meta.lastViewedAt || now - meta.lastViewedAt < staleThreshold * 86_400_000)) return false;
    if (filters.date.includes('Today') && date.toDateString() !== today.toDateString()) return false;
    if (filters.date.includes('This month') && (date.getMonth() !== today.getMonth() || date.getFullYear() !== today.getFullYear())) return false;
    if (filters.date.includes('This year') && date.getFullYear() !== today.getFullYear()) return false;
    return true;
  }).sort((a, b) => sortOldest ? a.createdAt - b.createdAt : b.createdAt - a.createdAt);

  const openFilterMenu = (key: FilterKey) => { setDraftFilter(filters[key]); setOpenFilter(openFilter === key ? null : key); };
  const toggleDraft = (value: string) => setDraftFilter((previous) => previous.includes(value) ? previous.filter((entry) => entry !== value) : [...previous, value]);
  const saveFilter = (key: FilterKey) => { setFilters((previous) => ({ ...previous, [key]: draftFilter })); setOpenFilter(null); };
  const createFolder = async () => {
    const name = window.prompt('Name this folder')?.trim();
    if (!name) return;
    if (folderNames.some((folder) => folder.toLocaleLowerCase() === name.toLocaleLowerCase())) { window.alert('A folder with that name already exists.'); return; }
    if (onCreateFolder) {
      try { await onCreateFolder(name); setActiveFolder(name); }
      catch (error) { window.alert(error instanceof Error ? error.message : 'Could not create this folder.'); }
      return;
    }
    const next = [...folders, name];
    try { localStorage.setItem('clientorahq-folders', JSON.stringify(next)); setFolders(next); setActiveFolder(name); }
    catch { window.alert('Could not save this folder in browser storage.'); }
  };
  const moveToFolder = (id: string, folder: string) => {
    if (onSetFolder) { onSetFolder(id, folder); return; }
    const next = { ...folderByRecording };
    if (folder) next[id] = folder;
    else delete next[id];
    try { localStorage.setItem('clientorahq-recording-folders', JSON.stringify(next)); setFolderByRecording(next); }
    catch { window.alert('Could not save the folder assignment.'); }
  };

  return (
    <section className="pdf-library-content" aria-label="Library">
      <div className="loom-library-heading">
        <div><span>Library</span><h1>{heading}</h1></div>
        {view === 'videos' && <div className="library-heading-actions"><button className="new-folder-button" onClick={createFolder}>New folder</button><button className="library-new-video" onClick={onNew}><Ico n="plus" size={15} />New video</button></div>}
        {view === 'archive' && <div className="library-heading-actions"><button className="library-new-video" onClick={onNew}><Ico n="plus" size={15} />New video</button></div>}
      </div>
      <div className="library-tabs" role="tablist" aria-label="Library views">
        <button className={view === 'videos' ? 'is-active' : ''} role="tab" aria-selected={view === 'videos'} onClick={() => setView('videos')}>Videos</button>
        <button className={view === 'screenshots' ? 'is-active' : ''} role="tab" aria-selected={view === 'screenshots'} onClick={() => setView('screenshots')}>Screenshots</button>
        <button className={view === 'archive' ? 'is-active' : ''} role="tab" aria-selected={view === 'archive'} onClick={() => setView('archive')}>Archive</button>
        {view !== 'screenshots' && <span>{count} {count === 1 ? 'video' : 'videos'}</span>}
      </div>

      {view === 'screenshots' ? (
        screenshots.length ? (
          <ul className="screenshot-grid">
            {screenshots.map((screenshot) => (
              <li className="screenshot-card" key={screenshot.id}>
                <button className="screenshot-preview" onClick={() => onOpen(screenshot.recordingId)} aria-label={`Open recording ${screenshot.title}`}><img src={screenshot.preview} alt={`Screenshot from ${screenshot.title}`} /></button>
                <div className="screenshot-card-details"><strong>{screenshot.title}</strong><span>{fmtDate(screenshot.createdAt)} · {displaySize(screenshot.size)}</span></div>
                <div className="screenshot-card-actions"><button onClick={() => onOpen(screenshot.recordingId)}>Open recording</button><button onClick={() => onDownloadScreenshot(screenshot)}>Download</button><button className="is-danger" onClick={() => onDeleteScreenshot(screenshot.id)}>Delete</button></div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="screenshot-empty"><div className="screenshot-art" aria-hidden="true"><span /><i /><i /><b /></div><h2>No screenshots yet</h2><p>Open a saved recording and choose “Capture screenshot” to save a frame here.</p></div>
        )
      ) : filteredItems.length === 0 ? (
        <div className="loom-library-empty"><div className="archive-art" aria-hidden="true"><i /><span /><b /></div><h2>{searchQuery.trim() ? 'No matching videos' : view === 'archive' ? 'No archived content' : 'No videos yet'}</h2><p>{searchQuery.trim() ? searchLoading ? 'Searching workspace content…' : 'Try a different title, folder, Space, comment, or transcript phrase.' : view === 'archive' ? "When you archive videos, they'll show up here." : 'Record a video or upload one to see it here.'}</p>{searchQuery.trim() && searchHasMore && <button className="new-folder-button" onClick={onLoadMoreSearch} disabled={searchLoading}>{searchLoading ? 'Loading…' : 'Load more results'}</button>}{view === 'videos' && !searchQuery.trim() && <button className="library-new-video" onClick={onNew}>Record a video</button>}</div>
      ) : (
        <>
          {view === 'videos' && folderNames.length > 0 && <label className="library-folder-filter">Folder <select value={activeFolder} onChange={(event) => setActiveFolder(event.currentTarget.value)}><option value="">All folders</option>{folderNames.map((folder) => <option key={folder} value={folder}>{folder}</option>)}</select></label>}
          <div className="library-filters"><label className="select-all-videos"><input type="checkbox" disabled /> Select all videos</label><div>{(['type', 'access', 'activity', 'date'] as const).map((key) => <div className="filter-menu-anchor" key={key}><button className={openFilter === key ? 'is-open' : ''} onClick={() => openFilterMenu(key)}>{key === 'type' ? 'Video type' : key === 'date' ? 'Upload date' : key[0].toUpperCase() + key.slice(1)} <span><Ico n={openFilter === key ? 'chevUp' : 'chevron'} size={14} /></span></button>{openFilter === key && <div className="filter-popover"><strong>{key === 'type' ? 'Video type' : key === 'date' ? 'Upload date' : key[0].toUpperCase() + key.slice(1)}</strong>{FILTER_OPTIONS[key].map((option) => <label key={option}><input type={key === 'activity' || key === 'date' ? 'radio' : 'checkbox'} name={`filter-${key}`} checked={draftFilter.includes(option)} onChange={() => key === 'activity' || key === 'date' ? setDraftFilter([option]) : toggleDraft(option)} />{option}</label>)}<footer><button className="filter-clear" onClick={() => { setDraftFilter([]); setFilters((previous) => ({ ...previous, [key]: [] })); setOpenFilter(null); }}>Clear</button><button onClick={() => setOpenFilter(null)}>Cancel</button><button className="filter-save" onClick={() => saveFilter(key)}>Save</button></footer></div>}</div>)}<div className="filter-menu-anchor"><button className={openFilter === 'sort' ? 'is-open' : ''} onClick={() => setOpenFilter(openFilter === 'sort' ? null : 'sort')}>{sortOldest ? 'Oldest to Newest' : 'Newest to Oldest'} <span><Ico n={openFilter === 'sort' ? 'chevUp' : 'chevron'} size={14} /></span></button>{openFilter === 'sort' && <div className="filter-popover sort-popover">{[['Newest to Oldest', false], ['Oldest to Newest', true]].map(([label, oldest]) => <button key={String(label)} className="sort-option" onClick={() => { setSortOldest(Boolean(oldest)); setOpenFilter(null); }}>{label}{sortOldest === oldest && <b>✓</b>}</button>)}</div>}</div></div></div>
          <ul className="pdf-recording-grid">
            {filteredItems.map((meta) => (
              <li key={meta.id} className="pdf-recording-card">
                <VideoCardPreview meta={meta} onOpen={() => onOpen(meta.id)} />
                <h2>{meta.title}</h2>
                <div className="library-card-byline"><span className="mini-avatar">TJ</span><p><strong>You</strong><span>{fmtDate(meta.createdAt)} <i /> {displaySize(meta.size)}</span></p><span className="library-view-count" title="Viewer insights"><Ico n="eye" size={14} /> {meta.viewCount ?? meta.viewEvents?.length ?? 0}</span><button aria-label={`More actions for ${meta.title}`}><Ico n="more" size={16} /></button></div>
                <div className="pdf-recording-actions">
                  <button onClick={() => onOpen(meta.id)}>Play</button>
                  {(!meta.isCloud || meta.canManage) && <button onClick={() => { const next = window.prompt('Rename recording', meta.title)?.trim(); if (next) onRename(meta.id, next); }}>Rename</button>}
                  <button onClick={() => canDownload ? onDownload(meta) : onUpgrade()}>{canDownload ? 'Download' : 'Download · Business'}</button>
                  {(!meta.isCloud || meta.canManage) && <button onClick={() => onArchive(meta)}>{view === 'archive' ? 'Restore' : 'Archive'}</button>}
                  <button onClick={() => onToggleWatchLater(meta.id)}>{watchLaterIds.includes(meta.id) ? 'Remove from Watch later' : 'Watch later'}</button>
                  {view === 'videos' && (!meta.isCloud || meta.canManage) && <label className="folder-assignment">Access <select value={meta.access ?? 'private'} onChange={(event) => onSetAccess(meta.id, event.currentTarget.value as 'private' | 'workspace')} aria-label={`Access for ${meta.title}`}><option value="private">Private</option><option value="workspace">Workspace</option></select></label>}
                  {view === 'videos' && <label className="folder-assignment">Folder <select aria-label={`Move ${meta.title} to a folder`} value={meta.folderName ?? folderByRecording[meta.id] ?? ''} onChange={(event) => moveToFolder(meta.id, event.currentTarget.value)}><option value="">None</option>{folderNames.map((folder) => <option key={folder} value={folder}>{folder}</option>)}</select></label>}
                  {view === 'videos' && (!meta.isCloud || meta.canManage) && spaces.length > 0 && <label className="folder-assignment">Spaces <select aria-label={`Share ${meta.title} with a Space`} value="" onChange={(event) => { const id = event.currentTarget.value; if (id) onAssignSpaces(meta.id, (meta.spaceIds ?? []).includes(id) ? (meta.spaceIds ?? []).filter((spaceId) => spaceId !== id) : [...(meta.spaceIds ?? []), id]); }}><option value="">{(meta.spaceIds ?? []).length ? `${(meta.spaceIds ?? []).length} selected` : 'Add to…'}</option>{spaces.map((space) => <option value={space.id} key={space.id}>{(meta.spaceIds ?? []).includes(space.id) ? '✓ ' : ''}{space.name} · {space.privacy}</option>)}</select></label>}
                  {!meta.isCloud && <button onClick={() => canUpload ? onUpload(meta) : onUpgrade()} disabled={uploadingId !== null || Boolean(meta.cloudId)}>{uploadingId === meta.id ? 'Uploading…' : meta.cloudId ? 'Uploaded to cloud' : canUpload ? 'Upload to cloud' : 'Cloud upload · Business'}</button>}
                  {(!meta.isCloud || meta.canManage) && <button className="is-danger" onClick={() => onDelete(meta)}>Delete</button>}
                </div>
              </li>
            ))}
          </ul>
          {searchQuery.trim() && searchHasMore && <div className="library-search-more"><button className="new-folder-button" onClick={onLoadMoreSearch} disabled={searchLoading}>{searchLoading ? 'Loading…' : 'Load more results'}</button></div>}
        </>
      )}
      <div className="pdf-storage-note"><span><i className="local-storage-dot" />{Number.isFinite(maxVideos) ? `Starter plan: ${recordingCount} of ${maxVideos} videos used (meeting recordings don’t count)` : `Saved recordings: ${total}`} · Storage used on this device: {fmtSize(storageUsed)}</span>{Number.isFinite(maxVideos) && <progress value={Math.min(recordingCount, maxVideos)} max={maxVideos} aria-label="Starter video limit used" />}</div>
    </section>
  );
}

function VideoCardPreview({ meta, onOpen }: { meta: RecordingMeta; onOpen: () => void }) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [active, setActive] = useState(false);
  const [refreshedThumbnail, setRefreshedThumbnail] = useState<{ base: string; url: string | null } | null>(null);
  const thumbnailSrc = refreshedThumbnail?.base === meta.thumb ? refreshedThumbnail.url : meta.thumb;
  const thumbnailRefreshAttempted = refreshedThumbnail?.base === meta.thumb;
  useEffect(() => () => { if (previewUrl?.startsWith('blob:')) URL.revokeObjectURL(previewUrl); }, [previewUrl]);
  const startPreview = () => {
    setActive(true);
    if (previewUrl) return;
    if (meta.isCloud) {
      void getCloudPreviewUrl(meta.id).then(setPreviewUrl).catch(() => undefined);
      return;
    }
    void getVideo(meta.id).then((blob) => {
      if (blob) setPreviewUrl(URL.createObjectURL(blob));
    });
  };
  return <button className="pdf-recording-preview" onClick={onOpen} onMouseEnter={startPreview} onMouseLeave={() => setActive(false)} onFocus={startPreview} onBlur={() => setActive(false)} aria-label={`Play ${meta.title}`}>
    {previewUrl && active ? <video src={previewUrl} crossOrigin={meta.isCloud ? 'anonymous' : undefined} onError={() => { if (meta.isCloud) setPreviewUrl(null); }} muted loop playsInline autoPlay preload="metadata" /> : thumbnailSrc ? <img src={thumbnailSrc} alt="" onError={() => {
      if (!meta.isCloud || thumbnailRefreshAttempted || !meta.thumb) { setRefreshedThumbnail({ base: meta.thumb ?? '', url: null }); return; }
      void getCloudThumbnailUrl(meta.id).then((url) => setRefreshedThumbnail({ base: meta.thumb!, url })).catch(() => setRefreshedThumbnail({ base: meta.thumb!, url: null }));
    }} /> : <span className="pdf-recording-placeholder" />}
    <span className="pdf-duration">{fmtTime(meta.durationMs)}</span>
  </button>;
}
