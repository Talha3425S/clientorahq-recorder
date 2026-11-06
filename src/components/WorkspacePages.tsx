import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { RecordingMeta } from '../lib/db';
import { getCloudInsights, getCloudWorkspaceSettings, setCloudAllowPublicLinks, setCloudMeetingRecordingsEnabled, type CloudInsights } from '../lib/recordingsApi';
import { fmtDate, fmtSize, fmtTime } from '../lib/format';
import { PLANS, type PlanId } from '../lib/plans';

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

export function MeetingsPage({ remote, onRecord }: { remote: boolean; onRecord: (title?: string) => void }) {
  return (
    <section className="loom-meetings-page">
      <div className="meeting-preview"><video controls playsInline preload="metadata" aria-label="Meeting recording preview"><source src="/meeting-recording.webm" type="video/webm" />Your browser does not support WebM video.</video></div>
      <h1>Stay in the loop with meeting recordings</h1>
      <p>Connect your calendar to find an upcoming meeting, then start a recording when you’re ready.</p>
      <CalendarConnections remote={remote} />
      {remote && <CalendarEvents onRecord={onRecord} />}
      <button className="home-record-button meeting-manual-record" onClick={() => onRecord()}>Record a meeting now</button>
    </section>
  );
}

type CalendarProvider = 'google' | 'outlook';
interface CalendarConnection { provider: CalendarProvider; accountEmail: string; connectedAt: string; }
const CALENDAR_PROVIDER_LABELS: Record<CalendarProvider, string> = { google: 'Google Calendar', outlook: 'Outlook Calendar' };

function CalendarConnections({ remote }: { remote: boolean }) {
  const [configured, setConfigured] = useState<{ google: boolean; outlook: boolean }>({ google: false, outlook: false });
  const [connections, setConnections] = useState<CalendarConnection[]>([]);
  const [busyProvider, setBusyProvider] = useState<CalendarProvider | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const loadConnections = useCallback(async () => {
    const response = await fetch('/api/v1/workspace/integrations/calendars', { credentials: 'same-origin' });
    const payload = await response.json() as { configured?: { google?: boolean; outlook?: boolean }; connections?: CalendarConnection[]; error?: { message?: string } };
    if (!response.ok) throw new Error(payload.error?.message || 'Could not load calendar connections.');
    setConfigured({ google: payload.configured?.google === true, outlook: payload.configured?.outlook === true });
    setConnections(payload.connections ?? []);
  }, []);
  useEffect(() => {
    if (!remote) return;
    const timer = window.setTimeout(() => {
      void loadConnections().catch((loadError: unknown) => setError(loadError instanceof Error ? loadError.message : 'Could not load calendar connections.'));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadConnections, remote]);
  useEffect(() => {
    const url = new URL(window.location.href);
    const result = url.searchParams.get('calendar');
    if (!result) return;
    const messages: Record<string, string> = {
      connected: 'Calendar connected.',
      cancelled: 'Calendar connection was cancelled.',
      'invalid-state': 'Calendar authorization expired. Please connect again.',
      'workspace-changed': 'The workspace changed during authorization. Please connect again.',
      failed: 'Calendar could not be connected. Check provider setup and try again.',
    };
    if (messages[result]) {
      url.searchParams.delete('calendar');
      window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
      window.setTimeout(() => {
        setNotice(messages[result]);
        if (result === 'connected') void loadConnections().catch((loadError: unknown) => setError(loadError instanceof Error ? loadError.message : 'Could not load calendar connections.'));
      }, 0);
    }
  }, [loadConnections]);
  const disconnect = async (provider: CalendarProvider) => {
    setBusyProvider(provider); setError(''); setNotice('');
    try {
      const response = await fetch(`/api/v1/workspace/integrations/calendar/${provider}`, { method: 'DELETE', credentials: 'same-origin' });
      const payload = await response.json() as { error?: { message?: string } };
      if (!response.ok) throw new Error(payload.error?.message || `Could not disconnect ${CALENDAR_PROVIDER_LABELS[provider]}.`);
      setConnections((current) => current.filter((connection) => connection.provider !== provider));
      setNotice(`${CALENDAR_PROVIDER_LABELS[provider]} disconnected.`);
    } catch (disconnectError) { setError(disconnectError instanceof Error ? disconnectError.message : 'Could not disconnect this calendar.'); }
    finally { setBusyProvider(null); }
  };
  if (!remote) return <p className="workspace-page-note">Sign in to connect a calendar. Calendar OAuth requires provider credentials on the API server.</p>;
  return <div className="calendar-connections" aria-label="Calendar connections">{(['google', 'outlook'] as const).map((provider) => {
    const connection = connections.find((item) => item.provider === provider);
    const configuredProvider = configured[provider];
    return <div className="meeting-calendar-row" key={provider}><b>{provider === 'google' ? 'G' : '▣'} {CALENDAR_PROVIDER_LABELS[provider]}</b>{connection ? <><span>Connected as {connection.accountEmail}</span><button type="button" onClick={() => void disconnect(provider)} disabled={busyProvider !== null}>{busyProvider === provider ? 'Disconnecting…' : 'Disconnect'}</button></> : configuredProvider ? <a className={provider === 'google' ? 'google-calendar-button' : undefined} href={`/api/v1/workspace/integrations/calendar/${provider}/start`}>Connect {CALENDAR_PROVIDER_LABELS[provider]}</a> : <span>API OAuth credentials are not configured.</span>}</div>;
  })}{notice && <p role="status" className="slack-connected-state">{notice}</p>}{error && <p role="alert" className="pdf-trim-error">{error}</p>}</div>;
}

interface CalendarEvent { id: string; provider: CalendarProvider; title: string; startAt: string; endAt: string; url: string | null; joinUrl: string | null; }

function CalendarEvents({ onRecord }: { onRecord: (title?: string) => void }) {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const connectionsResponse = await fetch('/api/v1/workspace/integrations/calendars', { credentials: 'same-origin' });
          const connectionsPayload = await connectionsResponse.json() as { connections?: CalendarConnection[]; error?: { message?: string } };
          if (!connectionsResponse.ok) throw new Error(connectionsPayload.error?.message || 'Could not load calendar connections.');
          const connectedProviders = (connectionsPayload.connections ?? []).map((connection) => connection.provider);
          const results = await Promise.all(connectedProviders.map(async (provider) => {
            const response = await fetch(`/api/v1/workspace/integrations/calendar/${provider}/events`, { credentials: 'same-origin' });
            const payload = await response.json() as { events?: Omit<CalendarEvent, 'provider'>[]; error?: { message?: string } };
            if (!response.ok) throw new Error(payload.error?.message || `Could not load ${CALENDAR_PROVIDER_LABELS[provider]} events.`);
            return (payload.events ?? []).map((event) => ({ ...event, provider }));
          }));
          if (!cancelled) setEvents(results.flat().sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt)));
        } catch (loadError) {
          if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'Could not load upcoming calendar events.');
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();
    }, 0);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, []);
  if (loading) return <p className="calendar-events-status">Loading upcoming meetings…</p>;
  if (error) return <p className="pdf-trim-error calendar-events-status" role="alert">{error}</p>;
  if (!events.length) return <p className="calendar-events-status">No upcoming meetings found in the next 14 days.</p>;
  return <section className="calendar-events" aria-labelledby="calendar-events-title"><h2 id="calendar-events-title">Upcoming meetings</h2><ul>{events.map((event) => <li key={`${event.provider}-${event.id}`}><div><strong>{event.title}</strong><time>{new Date(event.startAt).toLocaleString()} – {new Date(event.endAt).toLocaleTimeString()}</time><small>{CALENDAR_PROVIDER_LABELS[event.provider]}</small>{event.joinUrl && <a href={event.joinUrl} target="_blank" rel="noreferrer">Join meeting</a>}</div><button type="button" onClick={() => onRecord(event.title)}>Record meeting</button></li>)}</ul></section>;
}

export function UpgradeModal({ currentPlan, onClose, onChoose }: { currentPlan: PlanId; onClose: () => void; onChoose: (plan: PlanId) => void }) {
  const [billing, setBilling] = useState<'annual' | 'monthly'>('monthly');
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);
  const plans = PLANS.map((plan) => ({
    ...plan,
    current: currentPlan === plan.id,
    price: `$${billing === 'annual' ? plan.annualMonthlyPrice : plan.monthlyPrice}`,
    subhead: plan.id === 'starter' ? 'Included features' : plan.id === 'business' ? 'Everything in Starter, and' : 'Everything in Business, and',
    action: currentPlan === plan.id ? 'Current plan' : plan.id === 'starter' ? 'Switch to Starter' : `Choose ${plan.name}`,
    onChoose: () => onChoose(plan.id),
  }));
  return <div className="upgrade-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="upgrade-dialog" role="dialog" aria-modal="true" aria-labelledby="upgrade-title"><header><h1 id="upgrade-title">Choose your plan</h1><button onClick={onClose} aria-label="Close upgrade dialog">×</button></header><div className="upgrade-scroll-content"><fieldset className="billing-selector"><legend className="sr-only">Billing frequency</legend><label><input type="radio" name="billing-frequency" checked={billing === 'annual'} onChange={() => setBilling('annual')} />Annual {billing === 'annual' && <span>17% off</span>}</label><label><input type="radio" name="billing-frequency" checked={billing === 'monthly'} onChange={() => setBilling('monthly')} />Monthly</label></fieldset><div className="upgrade-plan-grid">{plans.map((plan) => <article className={`upgrade-plan${plan.current ? ' is-current' : ''}`} key={plan.name}>{plan.current && <span className="current-trial-pill">♢ Current plan</span>}<h2>{plan.name}</h2><p className="upgrade-plan-description">{plan.description}</p><div className={`upgrade-price${plan.name === 'Enterprise' ? ' is-enterprise' : ''}`}>{plan.price}{plan.id !== 'starter' && <small>{billing === 'annual' ? 'per user / mo, billed annually' : 'per user / mo'}</small>}{plan.id === 'starter' && <small>free forever</small>}</div><strong className="upgrade-plan-subhead">{plan.subhead}</strong><ul>{plan.features.map((feature) => <li key={feature}>{feature}</li>)}</ul><button className={plan.current || plan.id !== 'starter' ? 'upgrade-plan-primary' : ''} disabled={plan.current} onClick={plan.onChoose}>{plan.action}</button></article>)}</div><p className="plan-demo-notice">Plan selection is for feature testing only. No payment is processed, and AI services are not connected yet.</p></div></section></div>;
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

export function WatchLaterPage({ items, onOpen, onRemove }: { items: RecordingMeta[]; onOpen: (id: string) => void; onRemove: (id: string) => void }) {
  return <section className="recent-page"><h1>Watch later</h1>{items.length === 0 ? <div className="settings-empty"><h2>Your Watch later list is empty</h2><p>Save videos from your Library to find them here.</p></div> : <ul className="pdf-recording-grid">{items.map((meta) => <li key={meta.id} className="pdf-recording-card"><button className="pdf-recording-preview" onClick={() => onOpen(meta.id)} aria-label={`Play ${meta.title}`}>{meta.thumb ? <img src={meta.thumb} alt="" /> : <span className="pdf-recording-placeholder" />}<span className="pdf-duration">{fmtTime(meta.durationMs)}</span></button><h3>{meta.title}</h3><p>{fmtDate(meta.createdAt)}</p><div className="pdf-recording-actions"><button onClick={() => onOpen(meta.id)}>Play</button><button onClick={() => onRemove(meta.id)}>Remove from Watch later</button></div></li>)}</ul>}</section>;
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
    {tab === 'shortcuts' && <div className="settings-card"><h2>Keyboard shortcuts</h2><p>Use shortcuts to speed up your workflow. Shortcuts are disabled while you type in a field.</p><SettingRow label="Use keyboard shortcuts" settingKey="keyboard-shortcuts-enabled" /><div className="shortcut-list"><span>Quick search</span><kbd>Ctrl</kbd> + <kbd>K</kbd><span>Start recording</span><kbd>Alt</kbd> + <kbd>Shift</kbd> + <kbd>R</kbd><span>Pause or resume recording</span><kbd>Alt</kbd> + <kbd>Shift</kbd> + <kbd>P</kbd><span>Stop recording</span><kbd>Alt</kbd> + <kbd>Shift</kbd> + <kbd>S</kbd><span>Toggle play/pause</span><kbd>K</kbd><span>Step backward / forward 5 seconds</span><kbd>J</kbd> / <kbd>L</kbd><span>Mute / captions / speed</span><kbd>M</kbd> / <kbd>A</kbd> / <kbd>S</kbd><span>Theater / picture-in-picture / fullscreen</span><kbd>T</kbd> / <kbd>P</kbd> / <kbd>F</kbd><span>Comment / reaction 1–6</span><kbd>C</kbd> / <kbd>1</kbd>–<kbd>6</kbd></div></div>}
  </section>;
}

export function AdminOverview({ items, onNavigate, onInvite, canViewEngagementInsights = true, onUpgrade }: {
  items: RecordingMeta[];
  onNavigate: (page: 'admin-insights' | 'admin-users') => void;
  onInvite: () => void;
  canViewEngagementInsights?: boolean;
  onUpgrade?: () => void;
}) {
  const active = items.filter((item) => !item.archived);
  const viewed = items.reduce((total, item) => total + (item.viewCount ?? (item.lastViewedAt ? 1 : 0)), 0);
  const meetings = items.filter((item) => item.source === 'meeting').length;
  const engagementUpgrade = <><p>Workspace-wide video engagement is included with Business. Starter includes viewer insights on individual recordings.</p><button className="library-new-video" onClick={onUpgrade}>View plans</button></>;
  return <section className="admin-page">
    <p className="settings-owner">Local workspace</p>
    <h1>Overview</h1>
    <div className="admin-stat-row">
      <article><strong>{active.length}</strong><span>Videos recorded</span></article>
      {canViewEngagementInsights ? <article><strong>{viewed}</strong><span>Total video views</span></article> : <article className="plan-feature-locked"><strong>Business</strong><span>Workspace video views</span><button className="settings-plan-link" onClick={onUpgrade}>View plans</button></article>}
      <article><strong>{meetings}</strong><span>Meeting recordings</span></article>
    </div>
    <div className="admin-overview-grid">
      <article className="admin-card license-card"><header><h2>License allocation</h2><button onClick={onInvite}>Invite</button></header><div className="license-content"><div className="license-donut"><span><strong>1</strong>total license</span></div><ul><li><i className="dot-muted" />Unclaimed: 0</li><li><i className="dot-pale" />Claimed - inactive: 0</li><li><i className="dot-blue" />Claimed - active: 1</li></ul></div></article>
      {canViewEngagementInsights ? <article className="admin-card active-users-card"><header><h2>Most active users</h2><select aria-label="Activity period"><option>90 Days</option><option>30 Days</option></select><button disabled>Download</button></header><div className="admin-no-users"><span className="mini-avatar">TJ</span><p>Your local workspace has one active member.</p><button onClick={onInvite}>Invite users</button></div><button className="admin-card-link" onClick={() => onNavigate('admin-users')}>View all users ?</button></article> : <article className="admin-card active-users-card plan-feature-locked"><header><h2>Most active users</h2></header>{engagementUpgrade}</article>}
    </div>
    {canViewEngagementInsights ? <article className="admin-card admin-chart-card"><header><div><h2>Monthly active users in your organization</h2><small>Local activity summary</small></div><div className="range-buttons"><button className="is-active">Last 30 days</button><button>Last 90 days</button></div></header><svg viewBox="0 0 900 170" role="img" aria-label="One active local workspace member"><defs><linearGradient id="chart-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#176be5" stopOpacity=".28"/><stop offset="1" stopColor="#176be5" stopOpacity="0"/></linearGradient></defs><path d="M36 32 H884 V130 H36 Z" fill="url(#chart-fill)"/><path d="M36 32 H884" fill="none" stroke="#176be5" strokeWidth="3"/><path d="M36 32 V130 H884" fill="none" stroke="#b9bdc5" strokeWidth="1"/><text x="5" y="36">1.0</text><text x="5" y="82">0.5</text><text x="5" y="134">0.0</text></svg><button className="admin-card-link" onClick={() => onNavigate('admin-insights')}>View all insights ?</button></article> : <article className="admin-card admin-chart-card plan-feature-locked"><h2>Monthly active users</h2>{engagementUpgrade}</article>}
    <div className="admin-overview-grid"><article className="admin-card"><header><h2>Security</h2><button onClick={() => onNavigate('admin-users')}>Manage</button></header><p className="security-line"><b>?</b><span><strong>Private local storage</strong><small>Videos are saved in this browser only.</small></span></p><p className="security-line"><b>?</b><span><strong>Local workspace</strong><small>No public links are enabled.</small></span></p></article><article className="admin-card"><header><h2>Team breakdown</h2></header><p className="team-empty">Team usage insights are available after connecting a workspace account.</p></article></div>
  </section>;
}

interface LocalMember { id: string; name: string; email: string; role: 'Admin' | 'Member'; status: 'Invited' | 'Active'; createdAt: number }
function readLocalMembers(): LocalMember[] {
  try {
    const stored = JSON.parse(localStorage.getItem('clientorahq-local-members') ?? '[]') as unknown;
    const members = Array.isArray(stored) ? stored.filter((member): member is LocalMember => Boolean(member && typeof member.id === 'string' && typeof member.email === 'string')) : [];
    return [{ id: 'local-owner', name: 'You', email: 'Browser profile', role: 'Admin', status: 'Active', createdAt: 0 }, ...members];
  } catch { return [{ id: 'local-owner', name: 'You', email: 'Browser profile', role: 'Admin', status: 'Active', createdAt: 0 }]; }
}

export function AdminUsers({ maxUsers = 10, remote = false, onNotice }: { maxUsers?: number; remote?: boolean; onNotice?: (message: string) => void }) {
  const [members, setMembers] = useState<LocalMember[]>(readLocalMembers);
  const [seatLimit, setSeatLimit] = useState(maxUsers);
  const [ownerId, setOwnerId] = useState('');
  const [loading, setLoading] = useState(remote);
  const [showInvite, setShowInvite] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'Admin' | 'Member'>('Member');
  const [error, setError] = useState('');
  const refreshRemote = useCallback(async () => {
    const response = await fetch('/api/v1/workspace/members', { credentials: 'same-origin' });
    const payload = await response.json() as { error?: { message?: string }; members?: Array<{ id: string; email: string; name: string; role: string; status: string; createdAt: string }>; maxUsers?: number; ownerUserId?: string };
    if (!response.ok) throw new Error(payload.error?.message || 'Could not load workspace members.');
    setOwnerId(payload.ownerUserId ?? '');
    if (typeof payload.maxUsers === 'number') setSeatLimit(payload.maxUsers);
    setMembers((payload.members ?? []).map((member) => ({
      id: member.id,
      name: member.name,
      email: member.email,
      role: member.role === 'Admin' ? 'Admin' : 'Member',
      status: member.status === 'Invited' ? 'Invited' : 'Active',
      createdAt: new Date(member.createdAt).getTime(),
    })));
  }, []);
  useEffect(() => {
    if (!remote) return;
    let cancelled = false;
    void fetch('/api/v1/workspace/members', { credentials: 'same-origin' }).then(async (response) => {
      const payload = await response.json() as { error?: { message?: string }; members?: Array<{ id: string; email: string; name: string; role: string; status: string; createdAt: string }>; maxUsers?: number; ownerUserId?: string };
      if (!response.ok) throw new Error(payload.error?.message || 'Could not load workspace members.');
      return payload;
    }).then((payload) => {
      if (cancelled) return;
      setOwnerId(payload.ownerUserId ?? '');
      if (typeof payload.maxUsers === 'number') setSeatLimit(payload.maxUsers);
      setMembers((payload.members ?? []).map((member) => ({
        id: member.id,
        name: member.name,
        email: member.email,
        role: member.role === 'Admin' ? 'Admin' : 'Member',
        status: member.status === 'Invited' ? 'Invited' : 'Active',
        createdAt: new Date(member.createdAt).getTime(),
      })));
    }).catch((loadError: unknown) => {
      if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'Could not load workspace members.');
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [remote]);

  const saveMembers = (next: LocalMember[]) => {
    try { localStorage.setItem('clientorahq-local-members', JSON.stringify(next.filter((member) => member.id !== 'local-owner'))); setMembers(next); return true; }
    catch { setError('Could not save workspace members in this browser.'); return false; }
  };
  const invite = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const cleanEmail = email.trim().toLocaleLowerCase();
    if (members.length >= seatLimit) { setError(`This plan allows up to ${seatLimit} workspace users.`); return; }
    if (members.some((member) => member.email.toLocaleLowerCase() === cleanEmail)) { setError('This email address is already in the workspace.'); return; }
    if (remote) {
      try {
        const response = await fetch('/api/v1/workspace/members', {
          method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: cleanEmail, role }),
        });
        const payload = await response.json() as { error?: { message?: string }; status?: string; emailSent?: boolean };
        if (!response.ok) throw new Error(payload.error?.message || 'Could not add this workspace user.');
        await refreshRemote();
        onNotice?.(payload.status === 'Invited' && !payload.emailSent ? 'Invite saved. Email could not be sent; notify the person to sign in with this address.' : payload.status === 'Invited' ? 'Invitation email sent.' : 'Workspace member added.');
        setShowInvite(false); setName(''); setEmail(''); setError('');
      } catch (inviteError) {
        setError(inviteError instanceof Error ? inviteError.message : 'Could not add this workspace user.');
      }
      return;
    }
    if (saveMembers([{ id: crypto.randomUUID(), name: name.trim() || cleanEmail.split('@')[0], email: cleanEmail, role, status: 'Invited', createdAt: Date.now() }, ...members.filter((member) => member.id !== 'local-owner'), members[0]])) { setShowInvite(false); setName(''); setEmail(''); setError(''); }
  };
  const updateRole = async (member: LocalMember, nextRole: 'Admin' | 'Member') => {
    if (!remote) { saveMembers(members.map((entry) => entry.id === member.id ? { ...entry, role: nextRole } : entry)); return; }
    try {
      const response = await fetch(`/api/v1/workspace/members/${member.id}`, { method: 'PATCH', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: nextRole }) });
      const payload = await response.json().catch(() => ({})) as { error?: { message?: string } };
      if (!response.ok) throw new Error(payload.error?.message || 'Could not update this role.');
      await refreshRemote();
    } catch (updateError) { setError(updateError instanceof Error ? updateError.message : 'Could not update this role.'); }
  };
  const removeMember = async (member: LocalMember) => {
    if (!remote) { saveMembers(members.filter((entry) => entry.id !== member.id)); return; }
    try {
      const response = await fetch(`/api/v1/workspace/members/${member.id}`, { method: 'DELETE', credentials: 'same-origin' });
      const payload = await response.json().catch(() => ({})) as { error?: { message?: string } };
      if (!response.ok) throw new Error(payload.error?.message || 'Could not remove this workspace user.');
      await refreshRemote();
    } catch (removeError) { setError(removeError instanceof Error ? removeError.message : 'Could not remove this workspace user.'); }
  };
  return <section className="admin-page"><p className="settings-owner">{remote ? 'Workspace members' : 'Local workspace'}</p><h1>Users &amp; groups</h1><article className="admin-card admin-table-card"><header><div><h2>Users <small>({members.length})</small></h2><p>{remote ? 'Manage workspace members, roles, and invitations.' : 'Manage local workspace roles and invite records. These records stay on this device and do not provision accounts.'}</p></div><button className="library-new-video" onClick={() => { setError(''); setShowInvite(true); }} disabled={loading || members.length >= seatLimit}>Add user</button></header><p className="workspace-page-note">{members.length} of {Number.isFinite(seatLimit) ? seatLimit : 'unlimited'} workspace seats used. Pending invitations reserve a seat.</p>{loading ? <p className="workspace-page-note">Loading members…</p> : <div className="admin-table-scroll"><table><thead><tr><th>Name</th><th>Role</th><th>Date added</th><th>Email address</th><th>Status</th><th /></tr></thead><tbody>{members.map((member) => <tr key={member.id}><td><span className="mini-avatar">{member.name.slice(0, 1).toUpperCase()}</span> {member.name}</td><td>{(!remote && member.id === 'local-owner') || (remote && member.id === ownerId) ? member.role : <select value={member.role} onChange={(event) => void updateRole(member, event.currentTarget.value as 'Admin' | 'Member')} aria-label={`Role for ${member.email}`}><option>Admin</option><option>Member</option></select>}</td><td>{member.createdAt ? fmtDate(member.createdAt) : 'Today'}</td><td>{member.email}</td><td>{member.status}</td><td>{((!remote && member.id !== 'local-owner') || (remote && member.id !== ownerId)) && <button onClick={() => void removeMember(member)} aria-label={`Remove ${member.email}`}>Remove</button>}</td></tr>)}</tbody></table></div>}</article><article className="admin-card admin-table-card"><header><div><h2>Groups <small>(1)</small></h2><p>Groups organize workspace access.</p></div></header><div className="admin-table-scroll"><table><thead><tr><th>Name</th><th>Description</th><th>Members</th><th>Created</th></tr></thead><tbody><tr><td>Workspace members</td><td>Workspace users</td><td>{members.length}</td><td>Today</td></tr></tbody></table></div></article>{error && <p className="playlist-error" role="alert">{error}</p>}{showInvite && <div className="playlist-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowInvite(false); }}><form className="playlist-modal" role="dialog" aria-modal="true" aria-labelledby="invite-member-title" onSubmit={(submitEvent) => void invite(submitEvent)}><button type="button" className="playlist-modal-close" aria-label="Close" onClick={() => setShowInvite(false)}>×</button><h2 id="invite-member-title">Add workspace user</h2><p className="workspace-page-note">{remote ? 'The invitee needs to create and verify an account using this email address. Pending invitations expire after 7 days.' : 'This creates a local invite record only; it does not send email or create a sign-in account.'}</p>{!remote && <label><span>Name</span><input value={name} onChange={(event) => setName(event.currentTarget.value)} maxLength={100} /></label>}<label><span>Email address</span><input type="email" value={email} onChange={(event) => setEmail(event.currentTarget.value)} required /></label><label><span>Role</span><select value={role} onChange={(event) => setRole(event.currentTarget.value as 'Admin' | 'Member')}><option>Member</option><option>Admin</option></select></label><footer><button type="button" onClick={() => setShowInvite(false)}>Cancel</button><button type="submit">Add user</button></footer></form></div>}</section>;
}

export function AdminSpaces({ items, spaces = [], remote = false }: { items: RecordingMeta[]; spaces?: WorkspaceSpace[]; remote?: boolean }) {
  return <section className="admin-page"><p className="settings-owner">{remote ? 'Workspace' : 'Local workspace'}</p><h1>Spaces</h1><div className="admin-table-tools"><input placeholder="Search spaces by name" aria-label="Search spaces"/><select aria-label="Filter spaces"><option>All</option><option>Open</option><option>Private</option></select></div><article className="admin-card admin-table-card"><div className="admin-table-scroll"><table><thead><tr><th>Name</th><th>Privacy</th><th>Members</th><th>Videos</th><th>Date created</th></tr></thead><tbody>{spaces.map((space) => <tr key={space.id}><td>{space.name}</td><td>{space.privacy === 'open' ? 'Open' : 'Closed'}</td><td>{space.members ? `${space.members.split(',').filter(Boolean).length || 1} members` : '1 member'}</td><td>{items.filter((item) => item.spaceIds?.includes(space.id)).length} videos</td><td>{space.createdAt ? fmtDate(typeof space.createdAt === 'string' ? Date.parse(space.createdAt) : space.createdAt) : 'Today'}</td></tr>)}<tr><td>All ClientoraHQ workspace</td><td>{remote ? 'Workspace' : 'Local'}</td><td>{remote ? 'Workspace members' : '1 member'}</td><td>{items.length} videos</td><td>Today</td></tr></tbody></table></div><p className="settings-owner">{remote ? 'Open Spaces are visible to workspace members; closed Spaces are limited to their members.' : 'Space assignments and video data are saved in this browser.'}</p></article></section>;
}

export interface WorkspaceSpace {
  id: string;
  name: string;
  privacy: 'open' | 'closed';
  members?: string;
  createdAt?: string | number;
}

export function SpacePage({ space, items, onOpen, onUnshare, remote = false }: { space: WorkspaceSpace; items: RecordingMeta[]; onOpen: (id: string) => void; onUnshare: (meta: RecordingMeta) => void; remote?: boolean }) {
  const recordings = items.filter((item) => item.spaceIds?.includes(space.id));
  return <section className="recent-page"><p className="settings-owner">{space.privacy === 'open' ? 'Open Space' : 'Closed Space'} · {remote ? 'Workspace' : 'Local workspace'}</p><h1>{space.name}</h1><p className="space-page-members">{space.members?.trim() ? `Members: ${space.members}` : remote ? 'Workspace members can join this open Space.' : 'Only you have access to this local Space.'}</p>{recordings.length === 0 ? <div className="settings-empty"><h2>No videos in this Space yet</h2><p>Add videos to this Space from their Library cards.</p></div> : <ul className="pdf-recording-grid">{recordings.map((meta) => <li key={meta.id} className="pdf-recording-card"><button className="pdf-recording-preview" onClick={() => onOpen(meta.id)} aria-label={`Play ${meta.title}`}>{meta.thumb ? <img src={meta.thumb} alt="" /> : <span className="pdf-recording-placeholder" />}<span className="pdf-duration">{fmtTime(meta.durationMs)}</span></button><h2>{meta.title}</h2><p>{fmtDate(meta.createdAt)} · {fmtSize(meta.size)}</p><div className="pdf-recording-actions"><button onClick={() => onOpen(meta.id)}>Play</button><button onClick={() => onUnshare(meta)}>Remove from Space</button></div></li>)}</ul>}{!remote && <p className="workspace-page-note">Space membership and sharing are currently stored in this browser. Other users cannot access these videos until workspace sharing is connected.</p>}</section>;
}

export function CreateSpaceModal({ onClose, onCreate, remote = false }: { onClose: () => void; onCreate: (space: WorkspaceSpace) => void; remote?: boolean }) {
  const [name, setName] = useState('');
  const [members, setMembers] = useState('');
  const [privacy, setPrivacy] = useState<'open' | 'closed'>('open');
  return <div className="playlist-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><form className="playlist-modal create-space-modal" role="dialog" aria-modal="true" aria-labelledby="create-space-heading" onSubmit={(event) => { event.preventDefault(); const cleanName = name.trim(); if (cleanName) onCreate({ id: crypto.randomUUID(), name: cleanName, privacy, members: members.trim() }); }}><button type="button" className="playlist-modal-close" aria-label="Close" onClick={onClose}>×</button><h2 id="create-space-heading">Create a new Space</h2><p className="workspace-page-note">{remote ? 'Open Spaces are available to workspace members. Closed Spaces are limited to the members you enter.' : 'This Space is saved on this device. Other people cannot join until you sign in to a workspace.'}</p><label><span>Name*</span><input autoFocus maxLength={20} placeholder="Up to 20 characters" value={name} onChange={(event) => setName(event.currentTarget.value)} required /></label><label><span>Members</span><small>Enter workspace member names or email addresses, separated by commas.</small><input placeholder="Enter names" value={members} onChange={(event) => setMembers(event.currentTarget.value)} /></label><fieldset className="space-privacy"><legend>Privacy</legend><label><input type="radio" name="space-privacy" checked={privacy === 'open'} onChange={() => setPrivacy('open')} /><span><strong>Open</strong> - Anyone in this workspace can join</span></label><label><input type="radio" name="space-privacy" checked={privacy === 'closed'} onChange={() => setPrivacy('closed')} /><span><strong>Closed</strong> - Only invited people can join</span></label></fieldset><footer><button type="button" onClick={onClose}>Cancel</button><button type="submit" disabled={!name.trim()}>Create Space</button></footer></form></div>;
}

export function InsightsPage({ items, remote = false }: { items: RecordingMeta[]; remote?: boolean }) {
  const [range, setRange] = useState<30 | 90>(30);
  const [now] = useState(() => Date.now());
  const [remoteData, setRemoteData] = useState<CloudInsights | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!remote) return undefined;
    let cancelled = false;
    void getCloudInsights(range).then((data) => { if (!cancelled) { setRemoteData(data); setError(null); } }).catch((loadError) => {
      if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'Could not load workspace insights.');
    });
    return () => { cancelled = true; };
  }, [range, remote]);
  const viewedCount = items.reduce((total, item) => {
    const events = item.viewEvents ?? (item.lastViewedAt ? [item.lastViewedAt] : []);
    return total + events.filter((viewedAt) => now - viewedAt <= range * 86_400_000).length;
  }, 0);
  const createdCount = items.filter((item) => now - item.createdAt <= range * 86_400_000).length;
  const localViewsByDay = Array.from({ length: range }, (_, index) => {
    const dayStart = new Date(now - (range - index - 1) * 86_400_000).setHours(0, 0, 0, 0);
    const dayEnd = dayStart + 86_400_000;
    return items.reduce((total, item) => total + (item.viewEvents ?? (item.lastViewedAt ? [item.lastViewedAt] : [])).filter((viewedAt) => viewedAt >= dayStart && viewedAt < dayEnd).length, 0);
  });
  const localVideosByDay = Array.from({ length: range }, (_, index) => {
    const day = new Date(now - (range - index - 1) * 86_400_000).toDateString();
    return items.filter((item) => new Date(item.createdAt).toDateString() === day).length;
  });
  const views = remoteData?.totalViews ?? viewedCount;
  const videos = remoteData?.totalVideos ?? createdCount;
  const viewsSeries = remoteData?.series.map((point) => point.views) ?? localViewsByDay;
  const videosSeries = remoteData?.series.map((point) => point.videos) ?? localVideosByDay;
  return <section className="admin-page"><p className="settings-owner">{remote ? 'Workspace' : 'Local workspace'}</p><h1>Insights</h1>{remote ? error ? <div className="settings-info"><span>ⓘ</span><p>{error}</p></div> : <div className="settings-info"><span>▥</span><p>Workspace recording views and creation activity for the selected period.</p></div> : <div className="settings-info"><span>▥</span><p>Insights include activity saved in this browser.</p></div>}<h2 className="insights-subheading">How your videos are getting views</h2><select className="insights-range" value={range} onChange={(event) => setRange(Number(event.currentTarget.value) as 30 | 90)}><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option></select><article className="admin-card insight-charts"><section><h3>Total views received <b>{views}</b></h3><ActivityChart color="#176be5" label={`${views} video views`} values={viewsSeries} /></section><section><h3>Total videos created <b>{videos}</b></h3><ActivityChart color="#f15a3b" label={`${videos} videos created`} values={videosSeries} /></section></article></section>;
}

function ActivityChart({ color, label, values }: { color: string; label: string; values: number[] }) {
  const max = Math.max(1, ...values);
  const points = values.map((value, index) => `${(35 + 385 * index / Math.max(1, values.length - 1)).toFixed(1)},${(135 - 100 * value / max).toFixed(1)}`);
  const linePath = points.map((point, index) => `${index ? 'L' : 'M'}${point}`).join(' ');
  const areaPath = points.length ? `M35 135 ${points.map((point) => `L${point}`).join(' ')} L420 135 Z` : '';
  return <svg viewBox="0 0 430 170" role="img" aria-label={label}><defs><linearGradient id={`fill-${color.slice(1)}`} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor={color} stopOpacity=".22"/><stop offset="1" stopColor={color} stopOpacity="0"/></linearGradient></defs><path d={areaPath} fill={`url(#fill-${color.slice(1)})`} /><path d={linePath} fill="none" stroke={color} strokeWidth="2.5"/><path d="M35 35 V135 H420" fill="none" stroke="#bfc3ca"/><text x="3" y="39">{max}</text><text x="3" y="88">{Math.round(max / 2)}</text><text x="3" y="139">0</text></svg>;
}

type WorkspaceTab = 'general' | 'security' | 'data' | 'integrations' | 'ai' | 'meetings';
const WORKSPACE_TABS: [WorkspaceTab, string][] = [['general', 'General'], ['security', 'Security'], ['data', 'Data'], ['integrations', 'Integrations'], ['ai', 'Manage AI'], ['meetings', 'Meeting recordings']];

export function WorkspaceSettings({ onConnect, onUpgrade, items = [], remote = false, plan = 'starter' }: { onConnect: () => void; onUpgrade?: () => void; items?: RecordingMeta[]; remote?: boolean; plan?: PlanId }) {
  const [tab, setTab] = useState<WorkspaceTab>('general');
  const [workspaceName, setWorkspaceName] = useState(() => localStorage.getItem('clientorahq-workspace-name') ?? 'My workspace');
  const [aiEnabled, setAiEnabled] = useState(() => localStorage.getItem('clientorahq-ai-enabled') !== 'false');
  const [meetingAccess, setMeetingAccess] = useState(() => localStorage.getItem('clientorahq-meeting-access') !== 'false');
  const [meetingSettingsBusy, setMeetingSettingsBusy] = useState(false);
  const [meetingSettingsError, setMeetingSettingsError] = useState('');
  const [linkPolicy, setLinkPolicy] = useState(() => localStorage.getItem('clientorahq-link-policy') === 'members' ? 'members' : 'public');
  const [policyError, setPolicyError] = useState('');
  const [workspaceCanManage, setWorkspaceCanManage] = useState(false);
  const canManagePolicy = !remote || workspaceCanManage;
  const [workspaceCanChangeDefaults, setWorkspaceCanChangeDefaults] = useState(false);
  const canEditPrivacyDefaults = remote ? workspaceCanChangeDefaults : plan !== 'starter';
  const [language, setLanguage] = useState(() => localStorage.getItem('clientorahq-meeting-language') ?? 'Auto-detect');
  const [retention, setRetention] = useState(() => localStorage.getItem('clientorahq-retention') ?? 'forever');
  const [domains, setDomains] = useState<Array<{ id: string; domain: string; verifiedAt: string | null; verificationRecord: { name: string; type: string; value: string } | null }>>([]);
  const [domainDraft, setDomainDraft] = useState('');
  const [domainError, setDomainError] = useState('');
  const [domainBusy, setDomainBusy] = useState(false);
  const [canManageDomains, setCanManageDomains] = useState(false);
  useEffect(() => {
    if (!remote) return;
    let cancelled = false;
    void getCloudWorkspaceSettings().then((settings) => {
      if (cancelled) return;
      setLinkPolicy(settings.allowPublicLinks ? 'public' : 'members');
      setMeetingAccess(settings.allowMeetingRecordings);
      setWorkspaceCanManage(settings.canManage);
      setWorkspaceCanChangeDefaults(settings.canChangeDefaults);
    }).catch((error: unknown) => {
      if (!cancelled) {
        const message = error instanceof Error ? error.message : 'Could not load workspace settings.';
        setPolicyError(message);
        setMeetingSettingsError(message);
      }
    });
    return () => { cancelled = true; };
  }, [remote]);
  const updateMeetingAccess = async (enabled: boolean) => {
    setMeetingSettingsBusy(true);
    setMeetingSettingsError('');
    try {
      if (remote) await setCloudMeetingRecordingsEnabled(enabled);
      else localStorage.setItem('clientorahq-meeting-access', String(enabled));
      setMeetingAccess(enabled);
    } catch (error) {
      setMeetingSettingsError(error instanceof Error ? error.message : 'Could not update meeting recording access.');
    } finally {
      setMeetingSettingsBusy(false);
    }
  };
  useEffect(() => {
    if (!remote) return;
    let cancelled = false;
    void fetch('/api/v1/workspace/domains', { credentials: 'same-origin' }).then(async (response) => {
      const payload = await response.json() as { domains?: typeof domains; canManage?: boolean; error?: { message?: string } };
      if (!response.ok) throw new Error(payload.error?.message || 'Could not load verified domains.');
      return payload;
    }).then((payload) => {
      if (cancelled) return;
      setDomains(payload.domains ?? []);
      setCanManageDomains(payload.canManage ?? false);
    }).catch((error: unknown) => { if (!cancelled) setDomainError(error instanceof Error ? error.message : 'Could not load verified domains.'); });
    return () => { cancelled = true; };
  }, [remote]);
  const addDomain = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!remote) { setDomainError('Sign in to verify a workspace domain.'); return; }
    setDomainBusy(true); setDomainError('');
    try {
      const response = await fetch('/api/v1/workspace/domains', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ domain: domainDraft }) });
      const payload = await response.json() as { domain?: (typeof domains)[number]; error?: { message?: string } };
      if (!response.ok || !payload.domain) throw new Error(payload.error?.message || 'Could not add this domain.');
      setDomains((previous) => [payload.domain!, ...previous.filter((entry) => entry.domain !== payload.domain!.domain)]);
      setDomainDraft('');
    } catch (error) { setDomainError(error instanceof Error ? error.message : 'Could not add this domain.'); }
    finally { setDomainBusy(false); }
  };
  const verifyDomain = async (id: string) => {
    setDomainBusy(true); setDomainError('');
    try {
      const response = await fetch(`/api/v1/workspace/domains/${id}/verify`, { method: 'POST', credentials: 'same-origin' });
      const payload = await response.json() as { domain?: (typeof domains)[number]; error?: { message?: string } };
      if (!response.ok || !payload.domain) throw new Error(payload.error?.message || 'Could not verify this domain.');
      setDomains((previous) => previous.map((entry) => entry.id === id ? payload.domain! : entry));
    } catch (error) { setDomainError(error instanceof Error ? error.message : 'Could not verify this domain.'); }
    finally { setDomainBusy(false); }
  };
  const removeDomain = async (id: string) => {
    setDomainBusy(true); setDomainError('');
    try {
      const response = await fetch(`/api/v1/workspace/domains/${id}`, { method: 'DELETE', credentials: 'same-origin' });
      const payload = await response.json().catch(() => ({})) as { error?: { message?: string } };
      if (!response.ok) throw new Error(payload.error?.message || 'Could not remove this domain.');
      setDomains((previous) => previous.filter((entry) => entry.id !== id));
    } catch (error) { setDomainError(error instanceof Error ? error.message : 'Could not remove this domain.'); }
    finally { setDomainBusy(false); }
  };
  const updateLinkPolicy = async (allowPublic: boolean) => {
    const previous = linkPolicy;
    const next = allowPublic ? 'public' : 'members';
    setLinkPolicy(next);
    setPolicyError('');
    if (remote) {
      try { await setCloudAllowPublicLinks(allowPublic); }
      catch (error) { setLinkPolicy(previous); setPolicyError(error instanceof Error ? error.message : 'Could not save workspace sharing settings.'); return; }
    }
    try { localStorage.setItem('clientorahq-link-policy', next); } catch { /* The server remains the source of truth for a connected workspace. */ }
  };
  const saveName = (value: string) => { setWorkspaceName(value); localStorage.setItem('clientorahq-workspace-name', value); };
  const exportActivity = () => {
    const rows = [['Title', 'Created', 'Duration (ms)', 'Size (bytes)', 'Status'], ...items.map((item) => [item.title, new Date(item.createdAt).toISOString(), String(item.durationMs), String(item.size), item.archived ? 'Archived' : 'Active'])];
    const csv = rows.map((row) => row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = 'workspace-activity.csv'; link.click(); URL.revokeObjectURL(url);
  };
  return <section className="personal-settings-page"><p className="settings-owner">{remote ? "Connected workspace" : "Local workspace"}</p><h1>Workspace Settings</h1><div className="settings-info"><span>ⓘ</span><p>{remote ? "Manage sharing settings for members of this workspace." : "This local workspace is not connected to an account service. Settings apply only in this browser."}</p></div><nav className="settings-tabs" aria-label="Workspace settings">{WORKSPACE_TABS.map(([id, label]) => <button key={id} className={tab === id ? 'is-active' : ''} onClick={() => setTab(id)}>{label}</button>)}</nav>
    {tab === 'general' && <>
      <div className="settings-card">
        <h2>General</h2>
        <p>Settings applied automatically to new recordings in this workspace.</p>
        <div className="workspace-name-row"><div><strong>Workspace name</strong><small>The name that appears for your workspace.</small></div><input aria-label="Workspace name" value={workspaceName} onChange={(event) => saveName(event.currentTarget.value)} /></div>
        <div className="workspace-name-row"><div><strong>Workspace logo</strong><small>Choose a logo for this workspace.</small></div>{plan === 'starter' ? <button type="button" className="settings-upload-button" onClick={onUpgrade}>Upgrade to upload a logo</button> : <label className="settings-upload-button">Upload logo<input type="file" accept="image/*" onChange={() => localStorage.setItem('clientorahq-workspace-logo-selected', 'true')} /></label>}</div>
      </div>
      <div className="settings-card">
        <h2>Appearance</h2>
        <p>Custom video branding is included with Business. Starter recordings keep the ClientoraHQ player style.</p>
        <SettingRow label="Logo on video player" settingKey="workspace-player-logo" disabled={plan === 'starter'} onUpgrade={onUpgrade} />
        <SettingRow label="Use custom video player color" settingKey="workspace-player-color" disabled={plan === 'starter'} onUpgrade={onUpgrade} />
        <SettingRow label="Hide recorder branding" settingKey="workspace-hide-branding" disabled={plan === 'starter'} onUpgrade={onUpgrade} />
      </div>
    </>}
    {tab === 'security' && <><div className="settings-card"><h2>Access &amp; viewing</h2>{remote ? <p>Sharing settings apply across this connected workspace.</p> : <p>This local workspace is not connected to an account service. Settings apply only in this browser.</p>}<div className="security-choice-grid"><label><input type="radio" name="workspace-links" checked={linkPolicy === 'public'} onChange={() => void updateLinkPolicy(true)} disabled={!canEditPrivacyDefaults || (remote && !canManagePolicy)} /><span><strong>Allow public links</strong><small>Workspace owners and admins can create links for recordings they own.</small></span></label><label><input type="radio" name="workspace-links" checked={linkPolicy === 'members'} onChange={() => void updateLinkPolicy(false)} disabled={!canEditPrivacyDefaults || (remote && !canManagePolicy)} /><span><strong>Only workspace members can view</strong><small>People need workspace or Space access to view recordings.</small></span></label></div><p>Share links stay active until revoked by a workspace admin.</p>{!canEditPrivacyDefaults && <p className="workspace-page-note">Workspace-wide privacy defaults are included with Business. Starter still includes privacy controls for each recording. <button type="button" onClick={onUpgrade}>View plans</button></p>}{policyError && <p role="alert" className="pdf-trim-error">{policyError}</p>}</div><div className="settings-card"><h2>Default permissions</h2><div className="settings-connect-row"><b>New video access</b><span>Private on this device</span></div><div className="settings-connect-row"><b>Private video thumbnails</b><span>Enabled locally</span></div></div><div className="settings-card"><h2>Identity &amp; access management</h2><p>Verified email domains can be automatically added to this workspace when they sign up.</p>{!remote && <p className="workspace-page-note">Domain verification is available after signing in to a workspace.</p>}<form className="domain-add-form" onSubmit={(event) => void addDomain(event)}><label><span>Add a domain</span><input value={domainDraft} onChange={(event) => setDomainDraft(event.currentTarget.value)} placeholder="example.com" aria-label="Workspace email domain" disabled={!remote || !canManageDomains} /></label><button className="library-new-video" type="submit" disabled={!remote || !canManageDomains || domainBusy || !domainDraft.trim()}>Add domain</button></form>{domains.map((entry) => <article className="verified-domain-row" key={entry.id}><div><strong>{entry.domain}</strong><small>{entry.verifiedAt ? 'Verified · new sign-ups on this domain join the workspace' : 'Not verified'}</small>{entry.verificationRecord && <code>{entry.verificationRecord.type} {entry.verificationRecord.name} = {entry.verificationRecord.value}</code>}</div><div>{!entry.verifiedAt && <button onClick={() => void verifyDomain(entry.id)} disabled={domainBusy || !canManageDomains}>Verify DNS</button>}<button onClick={() => void removeDomain(entry.id)} disabled={domainBusy || !canManageDomains}>Remove</button></div></article>)}{domainError && <p role="alert" className="pdf-trim-error">{domainError}</p>}{['Single sign-on'].map((entry) => <div className="settings-connect-row" key={entry}><b>{entry}</b><button disabled>Not configured</button></div>)}</div></>}
    {tab === 'data' && <><div className="settings-card"><h2>User reports 🔒</h2><p>Organization user reports require a connected workspace account.</p><button className="sales-button" disabled>Contact sales for Enterprise</button></div><div className="settings-card"><h2>Data retention and deletion</h2><p>Local recordings remain in browser storage until you delete them.</p><div className="settings-radio-list"><label><input type="radio" name="retention" checked={retention === 'forever'} onChange={() => { setRetention('forever'); localStorage.setItem('clientorahq-retention', 'forever'); }} /><span><strong>Keep videos forever</strong><small>By default, videos are kept in this browser.</small></span></label><label><input type="radio" name="retention" checked={retention === 'auto'} onChange={() => { setRetention('auto'); localStorage.setItem('clientorahq-retention', 'auto'); }} /><span><strong>Auto-delete videos</strong><small>Choose a retention preference. Automatic deletion is not active in local mode.</small></span></label></div><div className="retention-actions"><button disabled={retention === 'forever'}>Save</button><button onClick={() => { setRetention('forever'); localStorage.setItem('clientorahq-retention', 'forever'); }}>Cancel</button></div></div><div className="settings-card"><h2>Export workspace activity log</h2><p>Download metadata for your local recordings as a CSV file.</p><div className="export-dates"><label>Start date<input type="date" /></label><label>End date<input type="date" /></label></div><button className="library-new-video" onClick={exportActivity}>Download CSV</button></div></>}
    {tab === 'integrations' && <div className="settings-card integration-settings"><div className="integration-row"><span className="integration-mark salesforce-mark">S</span><div><h3>Salesforce</h3><p>Connect engagement insights to track the effectiveness of your video outreach.</p><button className="sales-button" onClick={onConnect}>Contact sales for Enterprise</button></div></div><div className="integration-row"><span className="integration-mark zoom-mark">Z</span><div><h3>Zoom</h3><p>Import future cloud recordings to make them easy to access and share.</p><button className="sales-button" onClick={onConnect}>Contact sales for Enterprise</button></div></div></div>}
    {tab === 'integrations' && <SlackIntegration remote={remote} />}
    {tab === 'ai' && <div className="workspace-ai-settings"><h2>Manage AI</h2><p>AI tools are unavailable in this local-only build. Choose a saved preference for a future hosted workspace.</p><div className="settings-radio-list"><label><input type="radio" name="ai-enabled" checked={aiEnabled} onChange={() => { setAiEnabled(true); localStorage.setItem('clientorahq-ai-enabled', 'true'); }} /><span><strong>Keep AI on for all users in your workspace</strong><small>Use AI to generate titles, chapters, summaries, and documents from recordings.</small></span></label><label><input type="radio" name="ai-enabled" checked={!aiEnabled} onChange={() => { setAiEnabled(false); localStorage.setItem('clientorahq-ai-enabled', 'false'); }} /><span><strong>Turn AI off for all users in your workspace</strong><small>AI will not process workspace recordings.</small></span></label></div><div className="retention-actions"><button disabled>Save</button><button disabled>Cancel</button></div></div>}
    {tab === 'meetings' && <><div className="settings-card"><h2>Set up meeting recordings</h2><p>Connect a calendar to import upcoming meetings and start a browser recording when you choose.</p><CalendarConnections remote={remote} /></div><div className="settings-card"><h2>Meeting recordings</h2><p>Calendar recording access applies to members in a hosted workspace.</p><div className="security-choice-grid"><label><input type="radio" name="meeting-access" checked={meetingAccess} onChange={() => void updateMeetingAccess(true)} disabled={meetingSettingsBusy || (remote && !canManagePolicy)} /><span><strong>Allow meeting recordings access</strong><small>Users can start meeting recordings in the browser and save them to the workspace.</small></span></label><label><input type="radio" name="meeting-access" checked={!meetingAccess} onChange={() => void updateMeetingAccess(false)} disabled={meetingSettingsBusy || (remote && !canManagePolicy)} /><span><strong>Don't allow meeting recordings access</strong><small>Workspace members won't be able to record meetings.</small></span></label></div>{meetingSettingsError && <p role="alert" className="pdf-trim-error">{meetingSettingsError}</p>}</div><div className="settings-card language-settings"><h2>Language settings</h2><p>Auto-detect the language in meeting recordings, or select a default.</p><label>Language settings<select value={language} onChange={(event) => { setLanguage(event.currentTarget.value); localStorage.setItem('clientorahq-meeting-language', event.currentTarget.value); }}>{['Auto-detect', 'English', 'Arabic', 'French', 'Spanish', 'Urdu'].map((value) => <option key={value}>{value}</option>)}</select></label></div></>}
  </section>;
}


const SLACK_OAUTH_RESULT_MESSAGES: Record<string, string> = {
  connected: 'Slack connected. Sync contacts to import names and email addresses.',
  cancelled: 'Slack connection was cancelled.',
  'sign-in-required': 'Sign in again to finish connecting Slack.',
  'invalid-state': 'Slack authorization expired or could not be verified. Try connecting again.',
  'workspace-changed': 'Your workspace permissions changed. Ask an admin to connect Slack.',
  failed: 'Slack could not be connected. Check your Slack app configuration and try again.',
};

function SlackIntegration({ remote }: { remote: boolean }) {
  const [webhookConnected, setWebhookConnected] = useState(false);
  const [contactsConnected, setContactsConnected] = useState(false);
  const [oauthConfigured, setOauthConfigured] = useState(false);
  const [teamName, setTeamName] = useState('');
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  const [contacts, setContacts] = useState<{ slackUserId: string; email: string; displayName: string }[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState(() => {
    const result = new URLSearchParams(window.location.search).get('slack');
    return result ? SLACK_OAUTH_RESULT_MESSAGES[result] ?? '' : '';
  });
  useEffect(() => {
    if (!remote) return;
    let cancelled = false;
    void fetch('/api/v1/workspace/integrations/slack', { credentials: 'same-origin' }).then(async (response) => {
      const payload = await response.json() as { connected?: boolean; contactsConnected?: boolean; oauthConfigured?: boolean; teamName?: string | null; syncedAt?: string | null; canManage?: boolean; error?: { message?: string } };
      if (!response.ok) throw new Error(payload.error?.message || 'Could not load Slack connection status.');
      return payload;
    }).then((payload) => {
      if (cancelled) return;
      setWebhookConnected(payload.connected ?? false);
      setContactsConnected(payload.contactsConnected ?? false);
      setOauthConfigured(payload.oauthConfigured ?? false);
      setTeamName(payload.teamName ?? '');
      setSyncedAt(payload.syncedAt ?? null);
      setCanManage(payload.canManage ?? false);
      if (payload.contactsConnected) {
        void fetch('/api/v1/workspace/integrations/slack/contacts', { credentials: 'same-origin' }).then(async (response) => {
          const body = await response.json() as { contacts?: { slackUserId: string; email: string; displayName: string }[]; error?: { message?: string } };
          if (!response.ok) throw new Error(body.error?.message || 'Could not load Slack contacts.');
          if (!cancelled) setContacts(body.contacts ?? []);
        }).catch((contactsError: unknown) => { if (!cancelled) setError(contactsError instanceof Error ? contactsError.message : 'Could not load Slack contacts.'); });
      }
    }).catch((statusError: unknown) => { if (!cancelled) setError(statusError instanceof Error ? statusError.message : 'Could not load Slack connection status.'); });
    return () => { cancelled = true; };
  }, [remote]);
  useEffect(() => {
    const result = new URLSearchParams(window.location.search).get('slack');
    if (result && SLACK_OAUTH_RESULT_MESSAGES[result]) {
      const url = new URL(window.location.href);
      url.searchParams.delete('slack');
      window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
    }
  }, []);
  const syncContacts = async () => {
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch('/api/v1/workspace/integrations/slack/contacts/sync', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const payload = await response.json() as { contacts?: { slackUserId: string; email: string; displayName: string }[]; syncedAt?: string; error?: { message?: string } };
      if (!response.ok) throw new Error(payload.error?.message || 'Could not sync Slack contacts.');
      setContacts(payload.contacts ?? []); setSyncedAt(payload.syncedAt ?? new Date().toISOString());
      setNotice(`Synced ${payload.contacts?.length ?? 0} Slack contacts.`);
    } catch (syncError) { setError(syncError instanceof Error ? syncError.message : 'Could not sync Slack contacts.'); }
    finally { setBusy(false); }
  };
  const disconnectContacts = async () => {
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch('/api/v1/workspace/integrations/slack/oauth', { method: 'DELETE', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' } });
      const payload = await response.json() as { error?: { message?: string } };
      if (!response.ok) throw new Error(payload.error?.message || 'Could not disconnect Slack contacts.');
      setContactsConnected(false); setContacts([]); setTeamName(''); setSyncedAt(null); setNotice('Slack contact sync disconnected and imported contacts removed.');
    } catch (disconnectError) { setError(disconnectError instanceof Error ? disconnectError.message : 'Could not disconnect Slack contacts.'); }
    finally { setBusy(false); }
  };
  const connect = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const response = await fetch('/api/v1/workspace/integrations/slack', { method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ webhookUrl }) });
      const payload = await response.json() as { error?: { message?: string } };
      if (!response.ok) throw new Error(payload.error?.message || 'Could not connect Slack.');
      setWebhookConnected(true); setWebhookUrl('');
    } catch (connectError) { setError(connectError instanceof Error ? connectError.message : 'Could not connect Slack.'); }
    finally { setBusy(false); }
  };
  const disconnect = async () => {
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/v1/workspace/integrations/slack', { method: 'DELETE', credentials: 'same-origin' });
      const payload = await response.json() as { error?: { message?: string } };
      if (!response.ok) throw new Error(payload.error?.message || 'Could not disconnect Slack.');
      setWebhookConnected(false);
    } catch (disconnectError) { setError(disconnectError instanceof Error ? disconnectError.message : 'Could not disconnect Slack.'); }
    finally { setBusy(false); }
  };
  return <div className="settings-card slack-connection-card">
    <h2>Slack contacts</h2>
    <p>Connect your Slack workspace to sync member names and email addresses for sharing and invitations. Imported contacts stay in this workspace and are removed when you disconnect.</p>
    {!remote ? <p className="workspace-page-note">Sign in to connect Slack contacts.</p> : contactsConnected ? <>
      <p role="status" className="slack-connected-state">Connected to {teamName || 'Slack workspace'} · {contacts.length} contacts</p>
      <div className="slack-contact-actions"><button className="library-new-video" type="button" disabled={busy || !canManage} onClick={() => void syncContacts()}>{busy ? 'Syncing…' : 'Sync contacts'}</button>{canManage && <button className="sales-button" type="button" disabled={busy} onClick={() => void disconnectContacts()}>Disconnect contact sync</button>}</div>
      {syncedAt && <p className="workspace-page-note">Last synced {new Date(syncedAt).toLocaleString()}</p>}
      {contacts.length > 0 && <ul className="slack-contact-list" aria-label="Synced Slack contacts">{contacts.map((contact) => <li key={contact.slackUserId}><span aria-hidden="true">{contact.displayName.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase()}</span><div><strong>{contact.displayName}</strong><small>{contact.email}</small></div></li>)}</ul>}
      {contacts.length === 0 && <p className="workspace-page-note">No contacts have been synced yet. Use Sync contacts to import the Slack workspace directory.</p>}
    </> : canManage ? oauthConfigured ? <a className="library-new-video slack-oauth-link" href="/api/v1/workspace/integrations/slack/oauth/start">Connect Slack contacts</a> : <p className="workspace-page-note">Configure SLACK_CLIENT_ID, SLACK_CLIENT_SECRET, and SLACK_REDIRECT_URI on the API server to enable OAuth contact sync.</p> : <p className="workspace-page-note">Ask a workspace admin to connect Slack contacts.</p>}
    <hr />
    <h2>Slack channel sharing</h2>
    <p>Connect an incoming webhook to share recording links to a channel. The webhook URL is encrypted on the server and never returned after saving.</p>
    {!remote ? <p className="workspace-page-note">Sign in to connect a Slack channel.</p> : webhookConnected ? <><p role="status" className="slack-connected-state">Channel webhook connected</p>{canManage && <button className="sales-button" type="button" disabled={busy} onClick={() => void disconnect()}>{busy ? 'Disconnecting...' : 'Disconnect channel webhook'}</button>}</> : canManage ? <form className="slack-connect-form" onSubmit={(event) => void connect(event)}><label><span>Slack incoming webhook URL</span><input type="password" autoComplete="off" required value={webhookUrl} onChange={(event) => setWebhookUrl(event.currentTarget.value)} placeholder="https://hooks.slack.com/services/..." /></label><button className="library-new-video" type="submit" disabled={busy || !webhookUrl.trim()}>{busy ? 'Connecting...' : 'Connect channel webhook'}</button></form> : <p className="workspace-page-note">Ask a workspace admin to connect a Slack channel.</p>}
    {notice && <p role="status" className="slack-connected-state">{notice}</p>}{error && <p role="alert" className="pdf-trim-error">{error}</p>}
  </div>;
}

function LinkEmbeddingRow({ name, description, slug, mark }: { name: string; description: string; slug: string; mark: string }) {
  const key = `clientorahq-link-embedding-${slug}`;
  const [enabled, setEnabled] = useState(() => localStorage.getItem(key) !== 'false');
  return <div className="link-embedding-row"><span className={`link-embedding-logo logo-${slug}`} aria-hidden="true">{mark === 'cloud' ? '☁' : mark}</span><div><strong>{name}</strong><p>{description}</p></div><label className="integration-switch"><input type="checkbox" checked={enabled} onChange={(event) => { setEnabled(event.currentTarget.checked); localStorage.setItem(key, String(event.currentTarget.checked)); }} aria-label={`Enable ${name} link embedding`} /><span /></label></div>;
}

function SettingRow({ label, settingKey, disabled = false, onUpgrade }: { label: string; settingKey: string; disabled?: boolean; onUpgrade?: () => void }) {
  const [enabled, setEnabled] = useState(() => localStorage.getItem(`clientorahq-${settingKey}`) === 'true');
  const toggle = () => {
    if (disabled) return;
    setEnabled((previous) => { localStorage.setItem(`clientorahq-${settingKey}`, String(!previous)); return !previous; });
  };
  return <div className="settings-toggle-row"><label><span>{label}</span><input type="checkbox" checked={disabled ? false : enabled} onChange={toggle} disabled={disabled} aria-label={label} /></label>{disabled && <button type="button" className="settings-plan-link" onClick={onUpgrade}>View plans</button>}</div>;
}
