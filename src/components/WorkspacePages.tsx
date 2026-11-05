import { useEffect, useState } from 'react';
import type { RecordingMeta } from '../lib/db';
import { fmtDate, fmtSize, fmtTime } from '../lib/format';

interface Playlist {
  id: string;
  name: string;
  description: string;
  recordingIds: string[];
  createdAt: number;
}

const PLAYLISTS_KEY = 'clientorahq-recorder-playlists';

function readPlaylists(): Playlist[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(PLAYLISTS_KEY) ?? '[]');
    return Array.isArray(value) ? value.map((entry) => {
      const playlist = entry as Partial<Playlist>;
      return {
        id: typeof playlist.id === 'string' ? playlist.id : crypto.randomUUID(),
        name: typeof playlist.name === 'string' ? playlist.name : 'Untitled playlist',
        description: typeof playlist.description === 'string' ? playlist.description : '',
        recordingIds: Array.isArray(playlist.recordingIds) ? playlist.recordingIds.filter((id): id is string => typeof id === 'string') : [],
        createdAt: typeof playlist.createdAt === 'number' ? playlist.createdAt : Date.now(),
      };
    }) : [];
  } catch {
    return [];
  }
}

export function MeetingsPage({ onConnect }: { onConnect: () => void }) {
  return (
    <section className="loom-meetings-page">
      <div className="meeting-preview"><video controls playsInline preload="metadata" aria-label="Meeting recording preview"><source src="/meeting-recording.webm" type="video/webm" />Your browser does not support WebM video.</video></div>
      <h1>Stay in the loop with meeting recordings</h1>
      <p>Connect a calendar to record, take notes, and send a meeting<br className="desktop-break" /> recap with Loom AI for meetings.</p>
      <div className="meeting-connect-actions"><button className="google-calendar-button" onClick={onConnect}><b>G</b> Connect Google Calendar</button><button onClick={onConnect}><b>▣</b> Connect Outlook Calendar</button></div>
      <small className="workspace-page-note">Calendar connections require a configured account integration.</small>
    </section>
  );
}

export function UpgradeModal({ onClose, onChoose }: { onClose: () => void; onChoose: (plan: string) => void }) {
  const [billing, setBilling] = useState<'annual' | 'monthly'>('monthly');
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);
  const price = billing === 'monthly' ? { business: 18, ai: 24 } : { business: 15, ai: 20 };
  const plans = [
    { name: 'Business', description: 'Move work forward faster with unlimited video messages and basic editing', price: `$${price.business}`, features: ['Unlimited videos', 'Unlimited recording time', 'Basic waveform editing', 'Remove Loom branding', 'Upload and download videos', 'Request email to view'], action: 'Select', onChoose: () => onChoose('Business') },
    { name: 'Business + AI', description: 'Communicate your best with videos auto-enhanced by AI and advanced editing', price: `$${price.ai}`, current: true, features: ['Automatic video enhancement', 'One-click AI video polish', 'Advanced editing', 'Video-to-text automation', 'Automatic meeting notes and recaps'], action: 'Keep full access', onChoose: () => onChoose('Business + AI') },
    { name: 'Enterprise', description: 'Control and securely manage your video content for the entire organization', price: "Let's Talk", features: ['Advanced security (SSO, SCIM)', 'Advanced content privacy', 'Custom data retention policies', 'Salesforce integration', 'Admin insights', '99.95% uptime SLA'], action: 'Contact sales', onChoose: () => onChoose('Enterprise') },
  ];
  return <div className="upgrade-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="upgrade-dialog" role="dialog" aria-modal="true" aria-labelledby="upgrade-title"><header><h1 id="upgrade-title">Choose your plan</h1><button onClick={onClose} aria-label="Close upgrade dialog">×</button></header><div className="upgrade-scroll-content"><fieldset className="billing-selector"><legend className="sr-only">Billing frequency</legend><label><input type="radio" name="billing-frequency" checked={billing === 'annual'} onChange={() => setBilling('annual')} />Annual {billing === 'annual' && <span>17% off</span>}</label><label><input type="radio" name="billing-frequency" checked={billing === 'monthly'} onChange={() => setBilling('monthly')} />Monthly</label></fieldset><div className="upgrade-plan-grid">{plans.map((plan) => <article className={`upgrade-plan${plan.current ? ' is-current' : ''}`} key={plan.name}>{plan.current && <span className="current-trial-pill">♢ Current trial</span>}<h2>{plan.name}</h2><p className="upgrade-plan-description">{plan.description}</p><div className={`upgrade-price${plan.name === 'Enterprise' ? ' is-enterprise' : ''}`}>{plan.price}{plan.name !== 'Enterprise' && <small>per seat / mo</small>}</div><strong className="upgrade-plan-subhead">Everything in {plan.name === 'Business' ? 'Starter' : plan.name === 'Enterprise' ? 'Business + AI' : 'Business'}, and</strong><ul>{plan.features.map((feature) => <li key={feature}>{feature}</li>)}</ul><button className={plan.current ? 'upgrade-plan-primary' : ''} onClick={plan.onChoose}>{plan.action}</button></article>)}</div></div></section></div>;
}

export function PlaylistsPage({ recordings, onOpenRecording, onOpenLibrary }: { recordings: RecordingMeta[]; onOpenRecording: (id: string) => void; onOpenLibrary: () => void }) {
  const [playlists, setPlaylists] = useState<Playlist[]>(readPlaylists);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<'create' | 'edit' | null>(null);
  const [showAddVideos, setShowAddVideos] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [error, setError] = useState('');
  const active = playlists.find((playlist) => playlist.id === activeId) ?? null;
  const playlistVideos = active ? active.recordingIds.map((id) => recordings.find((recording) => recording.id === id)).filter((recording): recording is RecordingMeta => Boolean(recording)) : [];

  const commit = (next: Playlist[]) => {
    try {
      localStorage.setItem(PLAYLISTS_KEY, JSON.stringify(next));
      setPlaylists(next);
      setError('');
      return true;
    } catch {
      setError('Could not save playlists in this browser. Check available storage and try again.');
      return false;
    }
  };
  const openCreate = () => { setName(''); setDescription(''); setDialog('create'); };
  const openEdit = () => { if (!active) return; setName(active.name); setDescription(active.description); setDialog('edit'); };
  const saveDetails = () => {
    const cleanName = name.trim();
    if (!cleanName) return;
    if (dialog === 'create') {
      const next = [{ id: crypto.randomUUID(), name: cleanName, description: description.trim(), recordingIds: [], createdAt: Date.now() }, ...playlists];
      if (commit(next)) { setActiveId(next[0].id); setDialog(null); }
      return;
    }
    if (!active) return;
    const next = playlists.map((playlist) => playlist.id === active.id ? { ...playlist, name: cleanName, description: description.trim() } : playlist);
    if (commit(next)) setDialog(null);
  };
  const deletePlaylist = () => {
    if (!active || !window.confirm(`Delete playlist “${active.name}”? Your videos will stay in the Library.`)) return;
    if (commit(playlists.filter((playlist) => playlist.id !== active.id))) setActiveId(null);
  };
  const openAddVideos = () => {
    if (!active) return;
    setSelectedIds(active.recordingIds.filter((id) => recordings.some((recording) => recording.id === id)));
    setShowAddVideos(true);
  };
  const saveVideos = () => {
    if (!active) return;
    const next = playlists.map((playlist) => playlist.id === active.id ? { ...playlist, recordingIds: selectedIds } : playlist);
    if (commit(next)) setShowAddVideos(false);
  };
  const moveVideo = (id: string, direction: -1 | 1) => {
    if (!active) return;
    const ids = [...active.recordingIds];
    const index = ids.indexOf(id);
    const destination = index + direction;
    if (index < 0 || destination < 0 || destination >= ids.length) return;
    [ids[index], ids[destination]] = [ids[destination], ids[index]];
    commit(playlists.map((playlist) => playlist.id === active.id ? { ...playlist, recordingIds: ids } : playlist));
  };
  const removeVideo = (id: string) => {
    if (!active) return;
    commit(playlists.map((playlist) => playlist.id === active.id ? { ...playlist, recordingIds: playlist.recordingIds.filter((recordingId) => recordingId !== id) } : playlist));
  };

  return (
    <section className="loom-playlists-page">
      {active ? <>
        <button className="playlist-back-button" onClick={() => setActiveId(null)}>← All playlists</button>
        <div className="playlist-detail-heading"><div><span className="playlist-feature-tag">PLAYLIST</span><h1>{active.name}</h1><p>{active.description || 'A playlist by you'} · {playlistVideos.length} {playlistVideos.length === 1 ? 'video' : 'videos'}</p></div><div><button onClick={openEdit}>Edit details</button><button onClick={deletePlaylist}>Delete playlist</button><button className="playlist-create-button" onClick={openAddVideos}>＋ Add videos</button></div></div>
        {playlistVideos.length === 0 ? <div className="playlist-empty"><span>▣</span><h3>This playlist is empty</h3><p>Add videos from your local Library to build a watch order.</p>{recordings.length ? <button onClick={openAddVideos}>Add videos</button> : <button onClick={onOpenLibrary}>Go to Library</button>}</div> : <ol className="playlist-video-list">{playlistVideos.map((recording, index) => <li key={recording.id}><span className="playlist-video-number">{index + 1}</span><button className="playlist-video-thumb" onClick={() => onOpenRecording(recording.id)}>{recording.thumb ? <img src={recording.thumb} alt="" /> : <span>▶</span>}</button><button className="playlist-video-title" onClick={() => onOpenRecording(recording.id)}><strong>{recording.title}</strong><small>{fmtTime(recording.durationMs)} · {fmtDate(recording.createdAt)}</small></button><div className="playlist-video-actions"><button aria-label={`Move ${recording.title} up`} disabled={index === 0} onClick={() => moveVideo(recording.id, -1)}>↑</button><button aria-label={`Move ${recording.title} down`} disabled={index === playlistVideos.length - 1} onClick={() => moveVideo(recording.id, 1)}>↓</button><button aria-label={`Remove ${recording.title} from playlist`} onClick={() => removeVideo(recording.id)}>Remove</button></div></li>)}</ol>}
      </> : <>
        <div className="playlist-feature"><div><span className="playlist-feature-tag">PLAYLISTS</span><h1>Turn scattered videos into guided journeys</h1><p>Group related recordings into a clear sequence for onboarding, training, and team updates.</p><button className="playlist-create-button" onClick={openCreate}>＋ Create a playlist</button></div><div className="playlist-feature-art" aria-hidden="true"><span>▶</span><i /><i /><i /></div></div>
        <div className="playlist-list-heading"><h2>Browse all playlists</h2><button onClick={openCreate}>＋ Create new playlist</button></div>
        {playlists.length === 0 ? <div className="playlist-empty"><span>▣</span><h3>No playlists in this workspace yet</h3><p>Create a playlist to group related videos and organize your recordings.</p><button onClick={openCreate}>Create new playlist</button></div> : <ul className="playlist-grid">{playlists.map((playlist) => {
          const covers = playlist.recordingIds.map((id) => recordings.find((recording) => recording.id === id)).filter((recording): recording is RecordingMeta => Boolean(recording && recording.thumb)).slice(0, 3);
          return <li key={playlist.id}><button className="playlist-tile-open" onClick={() => setActiveId(playlist.id)}><div className="playlist-tile-art">{covers.length ? covers.map((recording) => <img key={recording.id} src={recording.thumb ?? undefined} alt="" />) : <span>▶</span>}</div><h3>{playlist.name}</h3><p>{playlist.description || 'Playlist by you'} · {playlist.recordingIds.length} {playlist.recordingIds.length === 1 ? 'video' : 'videos'}</p></button><button className="playlist-tile-edit" onClick={() => { setActiveId(playlist.id); setName(playlist.name); setDescription(playlist.description); setDialog('edit'); }}>Edit</button></li>;
        })}</ul>}
      </>}
      {error && <p className="playlist-error" role="alert">{error}</p>}
      {dialog && <div className="playlist-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDialog(null); }}><form className="playlist-modal" role="dialog" aria-modal="true" aria-labelledby="playlist-modal-title" onSubmit={(event) => { event.preventDefault(); saveDetails(); }}><button type="button" className="playlist-modal-close" aria-label="Close" onClick={() => setDialog(null)}>×</button><h2 id="playlist-modal-title">{dialog === 'create' ? 'Create new playlist' : 'Edit playlist'}</h2><label><span>Name</span><input autoFocus maxLength={80} placeholder="My new playlist" value={name} onChange={(event) => setName(event.currentTarget.value)} required /></label><label><span>Description (Optional)</span><textarea maxLength={300} placeholder="What is this playlist for?" value={description} onChange={(event) => setDescription(event.currentTarget.value)} /></label><footer><button type="button" onClick={() => setDialog(null)}>Cancel</button><button type="submit" disabled={!name.trim()}>{dialog === 'create' ? 'Create playlist' : 'Save changes'}</button></footer></form></div>}
      {showAddVideos && active && <div className="playlist-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowAddVideos(false); }}><section className="playlist-modal playlist-add-modal" role="dialog" aria-modal="true" aria-labelledby="playlist-add-title"><button type="button" className="playlist-modal-close" aria-label="Close" onClick={() => setShowAddVideos(false)}>×</button><h2 id="playlist-add-title">Add videos to {active.name}</h2>{recordings.length === 0 ? <p>No videos are available in your Library yet.</p> : <div className="playlist-recording-picker">{recordings.map((recording) => <label key={recording.id}><input type="checkbox" checked={selectedIds.includes(recording.id)} onChange={() => setSelectedIds((ids) => ids.includes(recording.id) ? ids.filter((id) => id !== recording.id) : [...ids, recording.id])} /><span>{recording.thumb ? <img src={recording.thumb} alt="" /> : <i>▶</i>}</span><span><strong>{recording.title}</strong><small>{fmtTime(recording.durationMs)} · {fmtDate(recording.createdAt)}</small></span></label>)}</div>}<footer><button type="button" onClick={() => setShowAddVideos(false)}>Cancel</button><button type="button" onClick={saveVideos} disabled={recordings.length === 0}>Save videos</button></footer></section></div>}
    </section>
  );
}

export function RecentPage({ items, onOpen }: { items: RecordingMeta[]; onOpen: (id: string) => void }) {
  const groups = new Map<string, RecordingMeta[]>();
  for (const item of items) {
    const label = new Intl.DateTimeFormat(undefined, { month: 'long', day: 'numeric', year: 'numeric' }).format(item.createdAt);
    groups.set(label, [...(groups.get(label) ?? []), item]);
  }
  return <section className="recent-page"><h1>Recent</h1>{items.length === 0 ? <div className="settings-empty"><h2>No recent videos</h2><p>Record or upload a video and it will appear here.</p></div> : [...groups].map(([date, recordings]) => <section className="recent-date-group" key={date}><h2>{date}</h2><ul className="pdf-recording-grid">{recordings.map((meta) => <li key={meta.id} className="pdf-recording-card"><button className="pdf-recording-preview" onClick={() => onOpen(meta.id)} aria-label={`Play ${meta.title}`}>{meta.thumb ? <img src={meta.thumb} alt="" /> : <span className="pdf-recording-placeholder" />}<span className="pdf-duration">{fmtTime(meta.durationMs)}</span></button><h3>{meta.title}</h3><p>{fmtDate(meta.createdAt)} · {fmtSize(meta.size)}</p></li>)}</ul></section>)}</section>;
}

type SettingsTab = 'account' | 'meetings' | 'notifications' | 'integrations' | 'quick-record' | 'shortcuts';
const SETTINGS_TABS: [SettingsTab, string][] = [['account', 'My account'], ['meetings', 'Meeting recordings'], ['notifications', 'Push notifications'], ['integrations', 'Integrations'], ['quick-record', 'Quick record'], ['shortcuts', 'Keyboard shortcuts']];
const EMBED_INTEGRATIONS = [
  ['Dropbox', 'Reinventing teamwork just got a little easier with quick videos', 'dropbox', '◆'],
  ['GitHub', 'Built for developers, quick videos are for all things GitHub', 'github', '●'],
  ['GitLab', 'Platform for modern developers even more modern with quick videos', 'gitlab', '◆'],
  ['Gmail', 'Create and share quick videos right from your inbox', 'gmail', 'M'],
  ['Google Docs', 'Bring GDocs to life with quick videos', 'google-docs', '▲'],
  ['Hacker News', 'Remain on topic with quick videos in Hacker News', 'hacker-news', 'Y'],
  ['Intercom', 'Communicate with customers the new way with quick videos', 'intercom', '▥'],
  ['JIRA', 'Stay agile with quick videos in JIRA', 'jira', '➤'],
  ['Product Hunt', 'Get the best comments in Product Hunt daily with quick videos', 'product-hunt', 'P'],
  ['Salesforce', 'Success. Not software. With quick videos', 'salesforce', 'cloud'],
  ["SalesforceIQ", "Quick videos for growing business's CRM", 'salesforce-iq', 'Q'],
] as const;

export function SettingsPage({ onConnect }: { onConnect: () => void }) {
  const [tab, setTab] = useState<SettingsTab>('account');
  return <section className="personal-settings-page"><p className="settings-owner">Local workspace</p><h1>Personal Settings</h1><div className="settings-info"><span>ⓘ</span><p>This recorder stores videos in this browser. Account settings and cloud integrations are not connected.</p></div><nav className="settings-tabs" aria-label="Personal settings">{SETTINGS_TABS.map(([id, label]) => <button key={id} className={tab === id ? 'is-active' : ''} onClick={() => setTab(id)}>{label}</button>)}</nav>
    {tab === 'account' && <div className="settings-card"><h2>Manage your local workspace</h2><section><h3>Profile</h3><p>Your recordings and playlists are saved in this browser on this device.</p></section><section><h3>Storage</h3><p>Clear individual recordings from your Library to free browser storage.</p></section></div>}
    {tab === 'meetings' && <div className="settings-card"><h2>Calendar</h2><p>Connect a calendar to enable meeting recording workflows.</p><div className="settings-connect-row"><b>G&nbsp; Google Calendar</b><button onClick={onConnect}>Connect</button></div><div className="settings-connect-row"><b>▣&nbsp; Outlook Calendar</b><button onClick={onConnect}>Connect</button></div></div>}
    {tab === 'notifications' && <div className="settings-card"><div className="settings-notice-banner"><span>✳</span><div><h2>Push notifications</h2><p>Notifications are unavailable until an account service is configured.</p></div></div><h3>Notify me when...</h3>{['Someone watches your video','Someone comments on your video','A video upload finishes'].map((label, index) => <SettingRow key={label} label={label} settingKey={`notifications-${index}`} />)}</div>}
    {tab === 'integrations' && <section className="link-embedding-settings"><h2>Link Embedding</h2><p>Choose which services can preview links in this browser. These preferences do not connect external accounts.</p>{EMBED_INTEGRATIONS.map(([name, description, slug, mark]) => <LinkEmbeddingRow key={slug} name={name} description={description} slug={slug} mark={mark} />)}</section>}
    {tab === 'quick-record' && <div className="settings-card"><h2>Quick record controls</h2><p>Set whether the recorder should open in a quick setup flow.</p><SettingRow label="Enable quick record" settingKey="quick-record-enabled" /></div>}
    {tab === 'shortcuts' && <div className="settings-card"><h2>Keyboard shortcuts</h2><p>Use shortcuts to control an active recording.</p><div className="shortcut-list"><span>Start recording</span><kbd>Alt</kbd> + <kbd>Shift</kbd> + <kbd>R</kbd><span>Pause or resume</span><kbd>Alt</kbd> + <kbd>Shift</kbd> + <kbd>P</kbd><span>Stop recording</span><kbd>Alt</kbd> + <kbd>Shift</kbd> + <kbd>S</kbd></div></div>}
  </section>;
}

export function AdminOverview({ items, onNavigate, onInvite }: { items: RecordingMeta[]; onNavigate: (page: 'admin-insights' | 'admin-users') => void; onInvite: () => void }) {
  const active = items.filter((item) => !item.archived);
  const viewed = items.filter((item) => item.lastViewedAt).length;
  const meetings = items.filter((item) => item.source === 'meeting').length;
  return <section className="admin-page"><p className="settings-owner">Local workspace</p><h1>Overview</h1><div className="admin-stat-row"><article><strong>{active.length}</strong><span>Videos recorded ⓘ</span></article><article><strong>{viewed}</strong><span>Total video views ⓘ</span></article><article><strong>{meetings}</strong><span>Meeting recordings ⓘ</span></article></div><div className="admin-overview-grid"><article className="admin-card license-card"><header><h2>License allocation</h2><button onClick={onInvite}>Invite v</button></header><div className="license-content"><div className="license-donut"><span><strong>1</strong>total license</span></div><ul><li><i className="dot-muted" />Unclaimed: 0</li><li><i className="dot-pale" />Claimed - inactive: 0</li><li><i className="dot-blue" />Claimed - active: 1</li></ul></div></article><article className="admin-card active-users-card"><header><h2>Most active users</h2><select aria-label="Activity period"><option>90 Days</option><option>30 Days</option></select><button disabled>Download</button></header><div className="admin-no-users"><span className="mini-avatar">TJ</span><p>Your local workspace has one active member.</p><button onClick={onInvite}>Invite users ↗</button></div><button className="admin-card-link" onClick={() => onNavigate('admin-users')}>View all users ›</button></article></div><article className="admin-card admin-chart-card"><header><div><h2>Monthly active users in your organization ⓘ</h2><small>Local activity summary</small></div><div className="range-buttons"><button className="is-active">Last 30 days</button><button>Last 90 days</button></div></header><svg viewBox="0 0 900 170" role="img" aria-label="One active local workspace member"><defs><linearGradient id="chart-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#176be5" stopOpacity=".28"/><stop offset="1" stopColor="#176be5" stopOpacity="0"/></linearGradient></defs><path d="M36 32 H884 V130 H36 Z" fill="url(#chart-fill)"/><path d="M36 32 H884" fill="none" stroke="#176be5" strokeWidth="3"/><path d="M36 32 V130 H884" fill="none" stroke="#b9bdc5" strokeWidth="1"/><text x="5" y="36">1.0</text><text x="5" y="82">0.5</text><text x="5" y="134">0.0</text></svg><button className="admin-card-link" onClick={() => onNavigate('admin-insights')}>View all insights ›</button></article><div className="admin-overview-grid"><article className="admin-card"><header><h2>Security</h2><button onClick={() => onNavigate('admin-users')}>Manage</button></header><p className="security-line"><b>✓</b><span><strong>Private local storage</strong><small>Videos are saved in this browser only.</small></span></p><p className="security-line"><b>✓</b><span><strong>Local workspace</strong><small>No public links are enabled.</small></span></p></article><article className="admin-card"><header><h2>Team breakdown</h2></header><p className="team-empty">Team usage insights are available after connecting a workspace account.</p></article></div></section>;
}

export function AdminUsers({ onInvite }: { onInvite: () => void }) {
  return <section className="admin-page"><p className="settings-owner">Local workspace</p><h1>Users &amp; groups</h1><article className="admin-card admin-table-card"><header><div><h2>Users <small>(1)</small></h2><p>Manage access to your workspace. Account invitations are unavailable in local mode.</p></div><button className="library-new-video" onClick={onInvite}>Add user</button></header><div className="admin-table-tools"><input placeholder="Enter a name or email address" aria-label="Search users"/><select aria-label="Filter by role"><option>All Roles</option><option>Admin</option></select><select aria-label="Filter by status"><option>All members</option><option>Active</option></select></div><div className="admin-table-scroll"><table><thead><tr><th>Name</th><th>Role</th><th>Date added</th><th>Email address</th><th>Status</th></tr></thead><tbody><tr><td><span className="mini-avatar">TJ</span> Local user</td><td>Owner</td><td>Today</td><td>Browser profile</td><td>Active</td></tr></tbody></table></div></article><article className="admin-card admin-table-card"><header><div><h2>Groups <small>(1)</small></h2><p>Groups organize people and permissions in a connected workspace.</p></div></header><div className="admin-table-scroll"><table><thead><tr><th>Name</th><th>Description</th><th>Members</th><th>Created</th></tr></thead><tbody><tr><td>Workspace members</td><td>Members of this local workspace</td><td>1</td><td>Today</td></tr></tbody></table></div></article></section>;
}

export function AdminSpaces({ items, spaces = [] }: { items: RecordingMeta[]; spaces?: WorkspaceSpace[] }) {
  return <section className="admin-page"><p className="settings-owner">Local workspace</p><h1>Spaces</h1><div className="admin-table-tools"><input placeholder="Search spaces by name" aria-label="Search spaces"/><select aria-label="Filter spaces"><option>All</option><option>Open</option><option>Private</option></select></div><article className="admin-card admin-table-card"><div className="admin-table-scroll"><table><thead><tr><th>Name</th><th>Privacy</th><th>Members</th><th>Videos</th><th>Date created</th></tr></thead><tbody>{spaces.map((space) => <tr key={space.id}><td>{space.name}</td><td>{space.privacy === 'open' ? 'Open' : 'Closed'}</td><td>{space.members ? `${space.members.split(',').filter(Boolean).length + 1} members` : '1 member'}</td><td>0 videos</td><td>Today</td></tr>)}<tr><td>All ClientoraHQ workspace</td><td>Local</td><td>1 member</td><td>{items.length} videos</td><td>Today</td></tr></tbody></table></div></article></section>;
}

export interface WorkspaceSpace {
  id: string;
  name: string;
  privacy: 'open' | 'closed';
  members?: string;
}

export function CreateSpaceModal({ onClose, onCreate }: { onClose: () => void; onCreate: (space: WorkspaceSpace) => void }) {
  const [name, setName] = useState('');
  const [members, setMembers] = useState('');
  const [privacy, setPrivacy] = useState<'open' | 'closed'>('open');
  return <div className="playlist-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><form className="playlist-modal create-space-modal" role="dialog" aria-modal="true" aria-labelledby="create-space-heading" onSubmit={(event) => { event.preventDefault(); const cleanName = name.trim(); if (cleanName) onCreate({ id: crypto.randomUUID(), name: cleanName, privacy, members: members.trim() }); }}><button type="button" className="playlist-modal-close" aria-label="Close" onClick={onClose}>×</button><h2 id="create-space-heading">Create a new Space</h2><label><span>Name*</span><input autoFocus maxLength={20} placeholder="Up to 20 characters" value={name} onChange={(event) => setName(event.currentTarget.value)} required /></label><label><span>Members</span><small>Members can add others and change settings for this Space.</small><input placeholder="Enter names" value={members} onChange={(event) => setMembers(event.currentTarget.value)} /></label><fieldset className="space-privacy"><legend>Privacy</legend><label><input type="radio" name="space-privacy" checked={privacy === 'open'} onChange={() => setPrivacy('open')} /><span><strong>Open</strong> - Anyone in this workspace can join</span></label><label><input type="radio" name="space-privacy" checked={privacy === 'closed'} onChange={() => setPrivacy('closed')} /><span><strong>Closed</strong> - Only invited people can join</span></label></fieldset><footer><button type="button" onClick={onClose}>Cancel</button><button type="submit" disabled={!name.trim()}>Create Space</button></footer></form></div>;
}

export function InsightsPage({ items }: { items: RecordingMeta[] }) {
  const [range, setRange] = useState<30 | 90>(30);
  const now = Date.now();
  const viewedCount = items.filter((item) => item.lastViewedAt && now - item.lastViewedAt <= range * 86_400_000).length;
  const createdCount = items.filter((item) => now - item.createdAt <= range * 86_400_000).length;
  return <section className="admin-page"><p className="settings-owner">Local workspace</p><h1>Insights</h1><div className="settings-info"><span>▥</span><p>Local activity only. Connect an account to see organization-wide usage.</p></div><h2 className="insights-subheading">How your videos are getting views</h2><select className="insights-range" value={range} onChange={(event) => setRange(Number(event.currentTarget.value) as 30 | 90)}><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option></select><article className="admin-card insight-charts"><section><h3>Total views received <b>{viewedCount}</b></h3><ActivityChart color="#176be5" label={`${viewedCount} video views`} /></section><section><h3>Total videos created <b>{createdCount}</b></h3><ActivityChart color="#f15a3b" label={`${createdCount} videos created`} /></section></article></section>;
}

function ActivityChart({ color, label }: { color: string; label: string }) {
  return <svg viewBox="0 0 430 170" role="img" aria-label={label}><defs><linearGradient id={`fill-${color.slice(1)}`} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor={color} stopOpacity=".22"/><stop offset="1" stopColor={color} stopOpacity="0"/></linearGradient></defs><path d="M35 35 L420 35 V135 H35 Z" fill={`url(#fill-${color.slice(1)})`} /><path d="M35 35 L420 35" fill="none" stroke={color} strokeWidth="2.5"/><path d="M35 35 V135 H420" fill="none" stroke="#bfc3ca"/><text x="3" y="39">1</text><text x="3" y="88">0.5</text><text x="3" y="139">0</text></svg>;
}

type WorkspaceTab = 'general' | 'security' | 'data' | 'integrations' | 'ai' | 'meetings';
const WORKSPACE_TABS: [WorkspaceTab, string][] = [['general', 'General'], ['security', 'Security'], ['data', 'Data'], ['integrations', 'Integrations'], ['ai', 'Manage AI'], ['meetings', 'Meeting recordings']];

export function WorkspaceSettings({ onConnect, items = [] }: { onConnect: () => void; items?: RecordingMeta[] }) {
  const [tab, setTab] = useState<WorkspaceTab>('general');
  const [workspaceName, setWorkspaceName] = useState(() => localStorage.getItem('clientorahq-workspace-name') ?? 'My workspace');
  const [aiEnabled, setAiEnabled] = useState(() => localStorage.getItem('clientorahq-ai-enabled') !== 'false');
  const [meetingAccess, setMeetingAccess] = useState(() => localStorage.getItem('clientorahq-meeting-access') !== 'false');
  const [linkPolicy, setLinkPolicy] = useState(() => localStorage.getItem('clientorahq-link-policy') === 'members' ? 'members' : 'public');
  const [language, setLanguage] = useState(() => localStorage.getItem('clientorahq-meeting-language') ?? 'Auto-detect');
  const [retention, setRetention] = useState(() => localStorage.getItem('clientorahq-retention') ?? 'forever');
  const saveName = (value: string) => { setWorkspaceName(value); localStorage.setItem('clientorahq-workspace-name', value); };
  const exportActivity = () => {
    const rows = [['Title', 'Created', 'Duration (ms)', 'Size (bytes)', 'Status'], ...items.map((item) => [item.title, new Date(item.createdAt).toISOString(), String(item.durationMs), String(item.size), item.archived ? 'Archived' : 'Active'])];
    const csv = rows.map((row) => row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = 'workspace-activity.csv'; link.click(); URL.revokeObjectURL(url);
  };
  return <section className="personal-settings-page"><p className="settings-owner">Local workspace</p><h1>Workspace Settings</h1><div className="settings-info"><span>ⓘ</span><p>This local workspace is not connected to an account service. Settings apply only in this browser.</p></div><nav className="settings-tabs" aria-label="Workspace settings">{WORKSPACE_TABS.map(([id, label]) => <button key={id} className={tab === id ? 'is-active' : ''} onClick={() => setTab(id)}>{label}</button>)}</nav>
    {tab === 'general' && <><div className="settings-card"><h2>General</h2><p>Settings applied automatically to new recordings in this workspace.</p><div className="workspace-name-row"><div><strong>Workspace name</strong><small>The name that appears for your workspace.</small></div><input aria-label="Workspace name" value={workspaceName} onChange={(event) => saveName(event.currentTarget.value)} /></div><div className="workspace-name-row"><div><strong>Workspace logo</strong><small>Choose a logo for this workspace.</small></div><label className="settings-upload-button">Upload logo<input type="file" accept="image/*" onChange={() => localStorage.setItem('clientorahq-workspace-logo-selected', 'true')} /></label></div></div><div className="settings-card"><h2>Appearance</h2><p>Preferences for the local video player.</p><SettingRow label="Logo on video player" settingKey="workspace-player-logo" /><SettingRow label="Use custom video player color" settingKey="workspace-player-color" /><SettingRow label="Hide recorder branding" settingKey="workspace-hide-branding" /></div></>}
    {tab === 'security' && <><div className="settings-card"><h2>Access &amp; viewing</h2><p>Public links are disabled in this local-only app.</p><div className="security-choice-grid"><label><input type="radio" name="workspace-links" checked={linkPolicy === 'public'} onChange={() => { setLinkPolicy('public'); localStorage.setItem('clientorahq-link-policy', 'public'); }} /><span><strong>Allow public links</strong><small>New content can be shared publicly when hosted sharing is enabled.</small></span></label><label><input type="radio" name="workspace-links" checked={linkPolicy === 'members'} onChange={() => { setLinkPolicy('members'); localStorage.setItem('clientorahq-link-policy', 'members'); }} /><span><strong>Only workspace members can view</strong><small>Keep new content private to this device.</small></span></label></div><div className="settings-connect-row"><b>Public link permissions</b><select aria-label="Public link permissions"><option>All users</option><option>Admins only</option></select></div><div className="settings-connect-row"><b>Public link expiration</b><select aria-label="Public link expiration"><option>Videos do not expire</option><option>30 days</option><option>90 days</option></select></div><div className="settings-connect-row"><b>Download permissions</b><select aria-label="Download permissions"><option>Allow downloads</option><option>Disable downloads</option></select></div></div><div className="settings-card"><h2>Default permissions</h2><div className="settings-connect-row"><b>New video access</b><span>Private on this device</span></div><div className="settings-connect-row"><b>Private video thumbnails</b><span>Enabled locally</span></div></div><div className="settings-card"><h2>Identity &amp; access management</h2><p>Advanced domain and single sign-on controls require a connected account.</p>{['Domain authorization', 'Single sign-on', 'Domain capture'].map((entry) => <div className="settings-connect-row" key={entry}><b>{entry}</b><button disabled>Not configured</button></div>)}</div></>}
    {tab === 'data' && <><div className="settings-card"><h2>User reports 🔒</h2><p>Organization user reports require a connected workspace account.</p><button className="sales-button" disabled>Contact sales for Enterprise</button></div><div className="settings-card"><h2>Data retention and deletion</h2><p>Local recordings remain in browser storage until you delete them.</p><div className="settings-radio-list"><label><input type="radio" name="retention" checked={retention === 'forever'} onChange={() => { setRetention('forever'); localStorage.setItem('clientorahq-retention', 'forever'); }} /><span><strong>Keep videos forever</strong><small>By default, videos are kept in this browser.</small></span></label><label><input type="radio" name="retention" checked={retention === 'auto'} onChange={() => { setRetention('auto'); localStorage.setItem('clientorahq-retention', 'auto'); }} /><span><strong>Auto-delete videos</strong><small>Choose a retention preference. Automatic deletion is not active in local mode.</small></span></label></div><div className="retention-actions"><button disabled={retention === 'forever'}>Save</button><button onClick={() => { setRetention('forever'); localStorage.setItem('clientorahq-retention', 'forever'); }}>Cancel</button></div></div><div className="settings-card"><h2>Export workspace activity log</h2><p>Download metadata for your local recordings as a CSV file.</p><div className="export-dates"><label>Start date<input type="date" /></label><label>End date<input type="date" /></label></div><button className="library-new-video" onClick={exportActivity}>Download CSV</button></div></>}
    {tab === 'integrations' && <div className="settings-card integration-settings"><div className="integration-row"><span className="integration-mark salesforce-mark">S</span><div><h3>Salesforce</h3><p>Connect engagement insights to track the effectiveness of your video outreach.</p><button className="sales-button" onClick={onConnect}>Contact sales for Enterprise</button></div></div><div className="integration-row"><span className="integration-mark zoom-mark">Z</span><div><h3>Zoom</h3><p>Import future cloud recordings to make them easy to access and share.</p><button className="sales-button" onClick={onConnect}>Contact sales for Enterprise</button></div></div><div className="integration-row"><span className="integration-mark slack-mark">✣</span><div><h3>Slack</h3><p>Share recordings with teammates from your collaboration workspace.</p><button className="library-new-video" onClick={onConnect}>Connect</button></div></div></div>}
    {tab === 'ai' && <div className="workspace-ai-settings"><h2>Manage AI</h2><p>AI tools are unavailable in this local-only build. Choose a saved preference for a future hosted workspace.</p><div className="settings-radio-list"><label><input type="radio" name="ai-enabled" checked={aiEnabled} onChange={() => { setAiEnabled(true); localStorage.setItem('clientorahq-ai-enabled', 'true'); }} /><span><strong>Keep AI on for all users in your workspace</strong><small>Use AI to generate titles, chapters, summaries, and documents from recordings.</small></span></label><label><input type="radio" name="ai-enabled" checked={!aiEnabled} onChange={() => { setAiEnabled(false); localStorage.setItem('clientorahq-ai-enabled', 'false'); }} /><span><strong>Turn AI off for all users in your workspace</strong><small>AI will not process workspace recordings.</small></span></label></div><div className="retention-actions"><button disabled>Save</button><button disabled>Cancel</button></div></div>}
    {tab === 'meetings' && <><div className="settings-card"><h2>Set up meeting recordings</h2><p>Connect workspace members' calendars to enable auto-recording and meeting notes.</p><div className="meeting-settings-connect"><button onClick={onConnect}>▣ Connect Outlook</button><button onClick={onConnect}>G Connect Google</button></div></div><div className="settings-card"><h2>Meeting recordings</h2><p>Calendar recording access applies to members in a hosted workspace.</p><div className="security-choice-grid"><label><input type="radio" name="meeting-access" checked={meetingAccess} onChange={() => { setMeetingAccess(true); localStorage.setItem('clientorahq-meeting-access', 'true'); }} /><span><strong>Allow meeting recordings access</strong><small>Users can record, share, and save meetings automatically.</small></span></label><label><input type="radio" name="meeting-access" checked={!meetingAccess} onChange={() => { setMeetingAccess(false); localStorage.setItem('clientorahq-meeting-access', 'false'); }} /><span><strong>Don't allow meeting recordings access</strong><small>Workspace members won't be able to record meetings.</small></span></label></div></div><div className="settings-card language-settings"><h2>Language settings</h2><p>Auto-detect the language in meeting recordings, or select a default.</p><label>Language settings<select value={language} onChange={(event) => { setLanguage(event.currentTarget.value); localStorage.setItem('clientorahq-meeting-language', event.currentTarget.value); }}>{['Auto-detect', 'English', 'Arabic', 'French', 'Spanish', 'Urdu'].map((value) => <option key={value}>{value}</option>)}</select></label></div></>}
  </section>;
}

function LinkEmbeddingRow({ name, description, slug, mark }: { name: string; description: string; slug: string; mark: string }) {
  const key = `clientorahq-link-embedding-${slug}`;
  const [enabled, setEnabled] = useState(() => localStorage.getItem(key) !== 'false');
  return <div className="link-embedding-row"><span className={`link-embedding-logo logo-${slug}`} aria-hidden="true">{mark === 'cloud' ? '☁' : mark}</span><div><strong>{name}</strong><p>{description}</p></div><label className="integration-switch"><input type="checkbox" checked={enabled} onChange={(event) => { setEnabled(event.currentTarget.checked); localStorage.setItem(key, String(event.currentTarget.checked)); }} aria-label={`Enable ${name} link embedding`} /><span /></label></div>;
}

function SettingRow({ label, settingKey }: { label: string; settingKey: string }) {
  const [enabled, setEnabled] = useState(() => localStorage.getItem(`clientorahq-${settingKey}`) === 'true');
  const toggle = () => setEnabled((previous) => { localStorage.setItem(`clientorahq-${settingKey}`, String(!previous)); return !previous; });
  return <label className="settings-toggle-row"><span>{label}</span><input type="checkbox" checked={enabled} onChange={toggle} aria-label={label} /></label>;
}
