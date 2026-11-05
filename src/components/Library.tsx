import { useState } from 'react';
import type { RecordingMeta } from '../lib/db';
import { fmtDate, fmtSize, fmtTime } from '../lib/format';

interface Props {
  items: RecordingMeta[];
  archivedItems: RecordingMeta[];
  total: number;
  storageUsed: number;
  onOpen: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (meta: RecordingMeta) => void;
  onNew: () => void;
  onArchive: (meta: RecordingMeta) => void;
  onUpload: (meta: RecordingMeta) => void;
  onDownload: (meta: RecordingMeta) => void;
  uploadingId: string | null;
}

const displaySize = (bytes: number) => bytes < 1_000_000
  ? `${bytes === 0 ? 0 : Math.max(1, Math.round(bytes / 1000))} KB`
  : `${(bytes / 1_000_000).toFixed(0)} MB`;

type LibraryView = 'videos' | 'screenshots' | 'archive';
type FilterKey = 'type' | 'access' | 'activity' | 'date';
type Filters = Record<FilterKey, string[]>;
const FILTER_OPTIONS: Record<FilterKey, string[]> = {
  type: ['Meeting recordings', 'Loom videos'],
  access: ['Public', 'Open', 'Restricted'],
  activity: ['Never watched', 'Stale', 'Older than 30 days', 'Older than 90 days', 'Older than 180 days'],
  date: ['Today', 'This month', 'This year'],
};
const EMPTY_FILTERS: Filters = { type: [], access: [], activity: [], date: [] };

export default function Library({ items, archivedItems, total, storageUsed, onOpen, onRename, onDelete, onNew, onArchive, onUpload, onDownload, uploadingId }: Props) {
  const [view, setView] = useState<LibraryView>('videos');
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [draftFilter, setDraftFilter] = useState<string[]>([]);
  const [openFilter, setOpenFilter] = useState<FilterKey | 'sort' | null>(null);
  const [sortOldest, setSortOldest] = useState(false);
  const visibleItems = view === 'archive' ? archivedItems : items;
  const heading = view === 'videos' ? 'Videos' : view === 'screenshots' ? 'Screenshots' : 'Archive';
  const count = view === 'archive' ? archivedItems.length : total;
  const filteredItems = visibleItems.filter((meta) => {
    const date = new Date(meta.createdAt);
    const today = new Date();
    const selectedType = filters.type;
    if (selectedType.length && !selectedType.some((type) => type === 'Meeting recordings' ? meta.source === 'meeting' : meta.source !== 'meeting')) return false;
    if (filters.access.length && !filters.access.includes('Restricted')) return false;
    if (filters.activity.includes('Never watched') && meta.lastViewedAt) return false;
    const staleThreshold = filters.activity.includes('Older than 180 days') ? 180 : filters.activity.includes('Older than 90 days') ? 90 : filters.activity.includes('Older than 30 days') || filters.activity.includes('Stale') ? 30 : 0;
    if (staleThreshold && (!meta.lastViewedAt || Date.now() - meta.lastViewedAt < staleThreshold * 86_400_000)) return false;
    if (filters.date.includes('Today') && date.toDateString() !== today.toDateString()) return false;
    if (filters.date.includes('This month') && (date.getMonth() !== today.getMonth() || date.getFullYear() !== today.getFullYear())) return false;
    if (filters.date.includes('This year') && date.getFullYear() !== today.getFullYear()) return false;
    return true;
  }).sort((a, b) => sortOldest ? a.createdAt - b.createdAt : b.createdAt - a.createdAt);

  const openFilterMenu = (key: FilterKey) => { setDraftFilter(filters[key]); setOpenFilter(openFilter === key ? null : key); };
  const toggleDraft = (value: string) => setDraftFilter((previous) => previous.includes(value) ? previous.filter((entry) => entry !== value) : [...previous, value]);
  const saveFilter = (key: FilterKey) => { setFilters((previous) => ({ ...previous, [key]: draftFilter })); setOpenFilter(null); };

  return (
    <section className="pdf-library-content" aria-label="Library">
      <div className="loom-library-heading">
        <div><span>Library</span><h1>{heading}</h1></div>
        {view === 'videos' && <div className="library-heading-actions"><button className="new-folder-button" disabled>New folder</button><button className="library-new-video" onClick={onNew}>New video <span>v</span></button></div>}
        {view === 'archive' && <div className="library-heading-actions"><button className="library-new-video" onClick={onNew}>New video <span>v</span></button></div>}
      </div>
      <div className="library-tabs" role="tablist" aria-label="Library views">
        <button className={view === 'videos' ? 'is-active' : ''} role="tab" aria-selected={view === 'videos'} onClick={() => setView('videos')}>Videos</button>
        <button className={view === 'screenshots' ? 'is-active' : ''} role="tab" aria-selected={view === 'screenshots'} onClick={() => setView('screenshots')}>Screenshots</button>
        <button className={view === 'archive' ? 'is-active' : ''} role="tab" aria-selected={view === 'archive'} onClick={() => setView('archive')}>Archive</button>
        {view !== 'screenshots' && <span>{count} {count === 1 ? 'video' : 'videos'}</span>}
      </div>

      {view === 'screenshots' ? (
        <div className="screenshot-empty"><div className="screenshot-art" aria-hidden="true"><span /><i /><i /><b /></div><h2>No screenshots yet</h2><p>Use the shortcut Alt+Shift+2 in the desktop app to capture a screenshot.</p></div>
      ) : filteredItems.length === 0 ? (
        <div className="loom-library-empty"><div className="archive-art" aria-hidden="true"><i /><span /><b /></div><h2>{view === 'archive' ? 'No archived content' : 'No videos yet'}</h2><p>{view === 'archive' ? "When you archive videos, they'll show up here." : 'Record a video or upload one to see it here.'}</p>{view === 'videos' && <button className="library-new-video" onClick={onNew}>Record a video</button>}</div>
      ) : (
        <>
          <div className="library-filters"><label className="select-all-videos"><input type="checkbox" disabled /> Select all videos</label><div>{(['type', 'access', 'activity', 'date'] as const).map((key) => <div className="filter-menu-anchor" key={key}><button className={openFilter === key ? 'is-open' : ''} onClick={() => openFilterMenu(key)}>{key === 'type' ? 'Video type' : key === 'date' ? 'Upload date' : key[0].toUpperCase() + key.slice(1)} <span>{openFilter === key ? '⌃' : '⌄'}</span></button>{openFilter === key && <div className="filter-popover"><strong>{key === 'type' ? 'Video type' : key === 'date' ? 'Upload date' : key[0].toUpperCase() + key.slice(1)}</strong>{FILTER_OPTIONS[key].map((option) => <label key={option}><input type={key === 'activity' || key === 'date' ? 'radio' : 'checkbox'} name={`filter-${key}`} checked={draftFilter.includes(option)} onChange={() => key === 'activity' || key === 'date' ? setDraftFilter([option]) : toggleDraft(option)} />{option}</label>)}<footer><button className="filter-clear" onClick={() => { setDraftFilter([]); setFilters((previous) => ({ ...previous, [key]: [] })); setOpenFilter(null); }}>Clear</button><button onClick={() => setOpenFilter(null)}>Cancel</button><button className="filter-save" onClick={() => saveFilter(key)}>Save</button></footer></div>}</div>)}<div className="filter-menu-anchor"><button className={openFilter === 'sort' ? 'is-open' : ''} onClick={() => setOpenFilter(openFilter === 'sort' ? null : 'sort')}>{sortOldest ? 'Oldest to Newest' : 'Newest to Oldest'} <span>{openFilter === 'sort' ? '⌃' : '⌄'}</span></button>{openFilter === 'sort' && <div className="filter-popover sort-popover">{[['Newest to Oldest', false], ['Oldest to Newest', true]].map(([label, oldest]) => <button key={String(label)} className="sort-option" onClick={() => { setSortOldest(Boolean(oldest)); setOpenFilter(null); }}>{label}{sortOldest === oldest && <b>✓</b>}</button>)}</div>}</div></div></div>
          <ul className="pdf-recording-grid">
            {filteredItems.map((meta) => (
              <li key={meta.id} className="pdf-recording-card">
                <button className="pdf-recording-preview" onClick={() => onOpen(meta.id)} aria-label={`Play ${meta.title}`}>
                  {meta.thumb ? <img src={meta.thumb} alt="" /> : <span className="pdf-recording-placeholder" />}
                  <span className="pdf-duration">{fmtTime(meta.durationMs)}</span>
                </button>
                <h2>{meta.title}</h2>
                <div className="library-card-byline"><span className="mini-avatar">TJ</span><p><strong>You</strong><span>{fmtDate(meta.createdAt)} <i /> {displaySize(meta.size)}</span></p><button aria-label={`More actions for ${meta.title}`}>...</button></div>
                <div className="pdf-recording-actions">
                  <button onClick={() => onOpen(meta.id)}>Play</button>
                  <button onClick={() => { const next = window.prompt('Rename recording', meta.title)?.trim(); if (next) onRename(meta.id, next); }}>Rename</button>
                  <button onClick={() => onDownload(meta)}>Download</button>
                  <button onClick={() => onArchive(meta)} disabled={meta.isCloud}>{view === 'archive' ? 'Restore' : 'Archive'}</button>
                  {!meta.isCloud && <button onClick={() => onUpload(meta)} disabled={uploadingId !== null || Boolean(meta.cloudId)}>{uploadingId === meta.id ? 'Uploading…' : meta.cloudId ? 'Uploaded to cloud' : 'Upload to cloud'}</button>}
                  <button className="is-danger" onClick={() => onDelete(meta)}>Delete</button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="pdf-storage-note"><span className="local-storage-dot" /> Local videos stay on this device - {fmtSize(storageUsed)} used. Cloud videos are stored in your workspace.</p>
    </section>
  );
}
