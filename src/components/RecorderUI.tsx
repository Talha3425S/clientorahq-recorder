import type { ReactNode } from 'react';
import { LIMIT_SEC, type Recorder } from '../hooks/useRecorder';
import type { Corner } from '../lib/compositor';
import { fmtTime } from '../lib/format';
import * as I from './Icons';

const btn = 'inline-flex items-center gap-2 rounded-lg px-4 py-2.5 font-semibold disabled:opacity-50';
const ghost = `${btn} bg-white/10 hover:bg-white/20`;
const kbd = 'rounded bg-white/15 px-1.5 py-0.5 font-mono text-sm';
const CORNERS: { id: Corner; label: string; glyph: string }[] = [
  { id: 'tl', label: 'top left', glyph: '↖' },
  { id: 'tr', label: 'top right', glyph: '↗' },
  { id: 'bl', label: 'bottom left', glyph: '↙' },
  { id: 'br', label: 'bottom right', glyph: '↘' },
];

const Overlay = ({ children }: { children: ReactNode }) => (
  <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-ink p-6 text-center text-white">{children}</div>
);

export default function RecorderUI({ r }: { r: Recorder }) {
  if (r.phase === 'idle') return null;
  if (r.phase === 'ready') return <Setup r={r} />;
  if (r.phase === 'countdown') {
    return (
      <Overlay>
        <p className="text-white/70">Recording starts in</p>
        <p aria-live="assertive" className="text-[10rem] leading-none font-bold">{r.count || ''}</p>
      </Overlay>
    );
  }
  return <Live r={r} />;
}

function Setup({ r }: { r: Recorder }) {
  const stream = r.camOn ? r.camStream : null;
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-ink/60 p-4"
      onKeyDown={(e) => { if (e.key === 'Escape') r.cancel(); }}
    >
      <div role="dialog" aria-modal="true" aria-labelledby="new-video" className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <div className="flex items-center justify-between">
          <h2 id="new-video" className="text-xl font-bold">New video</h2>
          <button onClick={r.cancel} aria-label="Close" className="rounded-lg p-2 text-muted hover:bg-wash"><I.Close /></button>
        </div>

        <div className="mt-5 grid place-items-center">
          {stream ? (
            <video
              ref={(el) => { if (el && el.srcObject !== stream) el.srcObject = stream; }}
              autoPlay muted playsInline aria-label="Camera preview"
              className="size-28 -scale-x-100 rounded-full object-cover ring-4 ring-tint"
            />
          ) : (
            <div className="grid size-28 place-items-center rounded-full bg-wash text-sm text-muted">
              {r.camOn ? 'No camera' : 'Camera off'}
            </div>
          )}
        </div>

        <div className="mt-5 flex items-center justify-between">
          <span id="cam-label" className="font-medium">Camera bubble</span>
          <button
            role="switch" aria-checked={r.camOn} aria-labelledby="cam-label" onClick={r.toggleCamera}
            className={`relative h-6 w-11 rounded-full transition-colors ${r.camOn ? 'bg-brand' : 'bg-muted/50'}`}
          >
            <span className={`absolute top-0.5 left-0.5 size-5 rounded-full bg-white transition-transform ${r.camOn ? 'translate-x-5' : ''}`} />
          </button>
        </div>

        <div className="mt-4">
          <p id="mic-label" className="text-sm font-medium">Microphone level</p>
          <div
            role="meter" aria-labelledby="mic-label" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(r.level * 100)}
            className="mt-2 h-2.5 overflow-hidden rounded-full bg-wash"
          >
            <div className="h-full rounded-full bg-brand" style={{ width: `${Math.round(r.level * 100)}%` }} />
          </div>
        </div>

        {r.notices.map((n) => <p key={n} role="status" className="mt-3 rounded-lg bg-tint px-3 py-2 text-sm">{n}</p>)}
        {r.error && <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-rec">{r.error}</p>}

        <button
          autoFocus onClick={r.start} disabled={r.preparing || r.busy}
          className={`${btn} mt-6 w-full justify-center bg-brand text-white hover:bg-brand-dark`}
        >
          <I.Dot /> {r.preparing ? 'Getting ready…' : r.busy ? 'Choose what to share…' : 'Start recording'}
        </button>
        <p className="mt-3 text-center text-sm text-muted">
          Next, choose a screen, window or tab. Your video stays on this computer.
        </p>
      </div>
    </div>
  );
}

function Live({ r }: { r: Recorder }) {
  const paused = r.phase === 'paused';
  const saving = r.phase === 'saving';
  const label = saving ? 'Saving…' : paused ? 'Paused' : 'Recording';
  return (
    <Overlay>
      <span role="status" className="inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-1.5 text-sm font-semibold">
        <span className={`size-2.5 rounded-full ${paused || saving ? 'bg-white/60' : 'bg-rec motion-safe:animate-pulse'}`} />
        {label}
      </span>
      <p className="mt-6 text-7xl font-bold tabular-nums">{fmtTime(r.time)}</p>
      <p className="mt-1 text-white/70">of {fmtTime(LIMIT_SEC * 1000)} limit</p>
      {r.warning && <p role="alert" className="mt-4 rounded-lg bg-amber-300 px-4 py-2 font-semibold text-ink">{r.warning}</p>}

      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <button className={ghost} disabled={saving} onClick={paused ? r.resume : r.pause}>
          {paused ? <I.Play /> : <I.Pause />} {paused ? 'Resume' : 'Pause'}
        </button>
        <button className={`${btn} bg-rec text-white`} disabled={saving} onClick={r.stop}><I.Stop /> Stop</button>
        <button className={ghost} disabled={saving} onClick={r.restart}><I.Restart /> Restart</button>
        <button className={ghost} disabled={saving} onClick={r.cancel}><I.Close /> Cancel</button>
      </div>

      {r.camStream && (
        <div role="group" aria-label="Camera bubble" className="mt-6 flex flex-wrap items-center justify-center gap-2">
          <button className={ghost} disabled={saving} onClick={r.toggleCamera}>{r.camOn ? 'Camera on' : 'Camera off'}</button>
          {CORNERS.map((c) => (
            <button
              key={c.id} disabled={!r.camOn || saving} onClick={() => r.moveBubble(c.id)}
              aria-label={`Move camera to ${c.label}`} aria-pressed={r.corner === c.id}
              className={`${ghost} ${r.corner === c.id ? 'ring-2 ring-white' : ''}`}
            >
              {c.glyph}
            </button>
          ))}
        </div>
      )}

      <p className="mt-8 max-w-lg text-sm text-white/70">
        Shortcuts while this tab is focused: <kbd className={kbd}>Alt+Shift+P</kbd> pause or resume,{' '}
        <kbd className={kbd}>Alt+Shift+S</kbd> stop, <kbd className={kbd}>Alt+Shift+R</kbd> restart.
        You can also end the recording with the browser’s Stop sharing button.
      </p>
    </Overlay>
  );
}