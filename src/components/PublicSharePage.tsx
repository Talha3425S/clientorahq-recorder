import { useEffect, useState } from 'react';
import { getPublicShare } from '../lib/recordingsApi';

function formatVttTime(milliseconds: number) {
  const total = Math.max(0, Math.floor(milliseconds));
  const hours = Math.floor(total / 3_600_000).toString().padStart(2, '0');
  const minutes = Math.floor((total % 3_600_000) / 60_000).toString().padStart(2, '0');
  const seconds = Math.floor((total % 60_000) / 1000).toString().padStart(2, '0');
  const millis = (total % 1000).toString().padStart(3, '0');
  return `${hours}:${minutes}:${seconds}.${millis}`;
}

function escapeVttText(text: string) {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('-->', '--&gt;');
}

export default function PublicSharePage({ token }: { token: string }) {
  const [share, setShare] = useState<Awaited<ReturnType<typeof getPublicShare>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const embed = new URLSearchParams(window.location.search).get('embed') === '1';
  const cues = share?.recording.transcript ?? [];
  const captions = cues.length ? `data:text/vtt;charset=utf-8,${encodeURIComponent(`WEBVTT\n\n${cues.map((cue, index) => `${index + 1}\n${formatVttTime(cue.startMs)} --> ${formatVttTime(cues[index + 1]?.startMs ?? share?.recording.durationMs ?? cue.startMs + 5000)}\n${escapeVttText(cue.text)}`).join('\n\n')}`)}` : null;

  useEffect(() => {
    let cancelled = false;
    void getPublicShare(token).then((result) => {
      if (!cancelled) setShare(result);
    }).catch((cause: unknown) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : 'This share link could not be opened.');
    });
    return () => { cancelled = true; };
  }, [token]);

  return <main className={`public-share-page${embed ? ' is-embed' : ''}`}>
    {!embed && <header className="public-share-brand"><span>✳</span><strong>ClientoraHQ</strong></header>}
    {share ? <article className="public-share-card">
      <video controls playsInline preload="metadata" src={share.url} aria-label={share.recording.title}>
        {captions && <track kind="captions" srcLang="en" label="Captions" src={captions} />}
        <p>Your browser cannot play this video.</p>
      </video>
      {!embed && <>
        <h1>{share.recording.title}</h1>
        <p>Shared recording · {Math.ceil(share.recording.durationMs / 60_000)} min</p>
        {cues.length > 0 && <details className="public-share-transcript">
          <summary>Transcript and captions ({cues.length} lines)</summary>
          <ol>{cues.map((cue) => <li key={cue.id}><time>{formatVttTime(cue.startMs).slice(3, 8)}</time><span>{cue.text}</span></li>)}</ol>
        </details>}
      </>}
    </article> : error ? <article className="public-share-error"><h1>Recording unavailable</h1><p>{error}</p></article> : <p className="public-share-loading">Loading shared recording…</p>}
  </main>;
}
