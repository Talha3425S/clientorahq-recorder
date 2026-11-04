import { useRef, useState } from 'react';
import { LIMIT_SEC, type Recorder } from '../hooks/useRecorder';
import type { Corner } from '../lib/compositor';
import { fmtTime } from '../lib/format';
import * as I from './Icons';

const CORNERS: { id: Corner; label: string; glyph: string }[] = [
  { id: 'tl', label: 'top left', glyph: '↖' },
  { id: 'tr', label: 'top right', glyph: '↗' },
  { id: 'bl', label: 'bottom left', glyph: '↙' },
  { id: 'br', label: 'bottom right', glyph: '↘' },
];

export default function RecorderUI({ r, libraryCount = 0 }: { r: Recorder; libraryCount?: number }) {
  if (r.phase === 'idle') return null;
  if (r.phase === 'ready') return <Setup r={r} libraryCount={libraryCount} />;
  if (r.phase === 'countdown') {
    return (
      <div className="rec-countdown-overlay">
        <p className="rec-countdown-title">Counting down</p>
        <div className="rec-countdown-ring" aria-live="assertive">{r.count || ''}</div>
        <p className="rec-countdown-label">Recording starts in {r.count || 1}…</p>
        <button onClick={r.cancel} className="rec-countdown-cancel">Cancel <kbd>Esc</kbd></button>
      </div>
    );
  }
  return <Live r={r} />;
}

function Setup({ r, libraryCount }: { r: Recorder; libraryCount: number }) {
  const stream = r.camOn ? r.camStream : null;
  const microphoneRef = useRef<HTMLSelectElement>(null);
  const [sourceMenu, setSourceMenu] = useState(false);
  const sourceLabel = r.captureSurface === 'monitor' ? 'Full Screen' : r.captureSurface === 'window' ? 'Window' : 'Current tab';
  return (
    <div className="rec-setup-screen">
      <header className="rec-setup-header">
        <div className="rec-setup-brand"><span>C</span><strong>ClientoraHQ Recorder</strong></div>
        <nav aria-label="Recorder pages">
          <button aria-current="page" className="is-active">Record</button>
          <button onClick={r.cancel}>Library ({libraryCount})</button>
        </nav>
      </header>
      <main className="rec-setup-main">
        <section className="rec-preview" aria-label="Recording preview">
          <span className="rec-ready-pill">Ready</span>
          <p>Your screen preview appears here</p>
          {stream ? <video
            ref={(el) => { if (el && el.srcObject !== stream) el.srcObject = stream; }}
            autoPlay muted playsInline aria-label="Camera preview" className="rec-camera-preview"
          /> : <span className="rec-camera-placeholder">{r.camOn ? 'TJ' : 'Camera off'}</span>}
        </section>

        <section className="rec-setup-options loom-recorder-panel" aria-label="Recording setup">
          <div className="loom-rec-mode-row" aria-label="Capture modes">
            <span aria-hidden="true">⌂</span><span className="is-selected" aria-hidden="true">▣</span><button aria-label="Camera recording" onClick={r.toggleCamera}>▧</button><span aria-hidden="true">✧</span><button className="loom-rec-close" aria-label="Close recorder setup" onClick={r.cancel}>×</button>
          </div>
          <div className="rec-step-group">
            <h1>1 · WHAT TO RECORD</h1>
            <div className="loom-source-picker">
              <button className="loom-source-select" onClick={() => setSourceMenu((open) => !open)} aria-expanded={sourceMenu}><span>▦</span>{sourceLabel}<i>⌄</i></button>
              {sourceMenu && <div className="loom-source-menu" role="listbox" aria-label="What to record">
                {([['monitor', 'Full Screen'], ['window', 'Window'], ['browser', 'Current tab']] as const).map(([value, label]) => <button key={value} role="option" aria-selected={r.captureSurface === value} onClick={() => { r.setCaptureSurface(value); setSourceMenu(false); }}><span>{value === 'monitor' ? '▣' : value === 'window' ? '▦' : '▱'}</span>{label}{r.captureSurface === value && <b>✓</b>}</button>)}
              </div>}
            </div>
          </div>

          <div className="rec-step-group">
            <h2>2 · MICROPHONE</h2>
            <label className="sr-only" htmlFor="rec-microphone">Choose a microphone</label>
            <select ref={microphoneRef} id="rec-microphone" value={r.micDeviceId} onChange={(e) => r.selectMicrophone(e.target.value)}>
              <option value="">{r.microphones.find((device) => device.deviceId === 'default')?.label || 'Built-in Microphone'}</option>
              {r.microphones.filter((device) => device.deviceId).map((device) =>
                <option value={device.deviceId} key={device.deviceId}>{device.label || 'Microphone'}</option>)}
            </select>
            <div className="rec-mic-meter" role="meter" aria-label="Microphone level" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(r.level * 100)}>
              {Array.from({ length: 9 }, (_, i) => <span key={i} className={r.level * 9 > i ? 'is-lit' : ''} />)}
            </div>
            <p className="rec-helper">Say a few words to test your level</p>
          </div>

          <div className="rec-step-group rec-camera-group">
            <h2>3 · CAMERA BUBBLE</h2>
            <button className={`rec-camera-toggle${r.camOn ? ' is-selected' : ''}`} role="switch" aria-checked={r.camOn} onClick={r.toggleCamera}>
              Camera {r.camOn ? 'on' : 'off'}
            </button>
            <div className="rec-corner-picker" role="group" aria-label="Camera bubble corner">
              {CORNERS.map((corner) => <button key={corner.id} aria-label={`Move camera to ${corner.label}`} aria-pressed={r.corner === corner.id}
                onClick={() => r.moveBubble(corner.id)} disabled={!r.camOn}>{corner.id === 'tl' ? '\u2196' : corner.id === 'tr' ? '\u2197' : corner.id === 'bl' ? '\u2199' : '\u2198'}</button>)}
            </div>
          </div>

          <label className="rec-system-audio"><input type="checkbox" checked={r.includeSystemAudio} onChange={(e) => r.setIncludeSystemAudio(e.target.checked)} />
            <span>Also record tab / system sound</span>
          </label>

          {r.notices.map((notice) => <p key={notice} role="status" className="rec-setup-notice">{notice}</p>)}
          {r.error && <p role="alert" className="rec-setup-error">{r.error}</p>}
          {!r.hasMic && <button className="rec-choose-mic" onClick={() => microphoneRef.current?.focus()}>Choose a microphone</button>}
          <button autoFocus onClick={r.start} disabled={r.preparing || r.busy} className="rec-start-button">
            {r.preparing ? 'Getting ready…' : r.busy ? 'Choose what to share…' : r.hasMic ? 'Start recording' : 'Record without mic'}
          </button>
        </section>
      </main>
      <footer className="rec-setup-footer">
        <p>Limit 5:00 · warning at 4:30 · Shortcuts: Alt+Shift+R record, P pause, S stop</p>
        <p>Private by default: recordings stay in this browser and never leave your computer.</p>
      </footer>
    </div>
  );
}

function Live({ r }: { r: Recorder }) {
  const paused = r.phase === 'paused';
  const saving = r.phase === 'saving';
  const label = saving ? 'Saving…' : paused ? 'Paused' : 'Recording';
  return (
    <div className="rec-live-overlay">
      <div className="rec-live-status-row">
        <span role="status" className={`rec-live-status${paused || saving ? ' is-paused' : ''}`}><i />{label}</span>
        <span className="rec-live-limit">{Math.max(0, LIMIT_SEC - Math.floor(r.time / 1000))} seconds left · recording stops at 5:00</span>
        <span className="rec-live-shortcuts">Alt+Shift+P pause · Alt+Shift+S stop</span>
      </div>
      {r.warning && <p role="alert" className="rec-live-warning">{r.warning}</p>}
      <div className="rec-live-preview-row">
        <div className="rec-live-preview-card rec-live-screen">
          {r.screenStream ? <video ref={(el) => { if (el && el.srcObject !== r.screenStream) el.srcObject = r.screenStream; }} autoPlay muted playsInline aria-label="Shared screen preview" /> : <span>Waiting for screen preview…</span>}
        </div>
        <div className="rec-live-preview-card rec-live-camera-card">
          {r.camStream && r.camOn ? <video ref={(el) => { if (el && el.srcObject !== r.camStream) el.srcObject = r.camStream; }} autoPlay muted playsInline /> : <span>Camera off</span>}
          <strong>{r.camOn ? 'Camera preview' : 'Camera is off'}</strong>
        </div>
      </div>
      <div className="rec-live-toolbar">
        <span className="rec-live-time">{fmtTime(r.time)} <small>/ {fmtTime(LIMIT_SEC * 1000)}</small></span>
        <button disabled={saving} onClick={paused ? r.resume : r.pause}>{paused ? <I.Play /> : <I.Pause />}{paused ? 'Resume' : 'Pause'}</button>
        <button className="is-stop" disabled={saving} onClick={r.stop}><I.Stop />{saving ? 'Saving…' : 'Stop'}</button>
        <button disabled={saving} onClick={r.restart}><I.Restart />Restart</button>
        <button disabled={saving} onClick={r.cancel}><I.Close />Cancel</button>
        {r.camStream && <div className="rec-live-camera-tools" role="group" aria-label="Camera bubble">
          <button disabled={saving} onClick={r.toggleCamera}>{r.camOn ? 'Camera on' : 'Camera off'}</button>
          {CORNERS.map((corner) => <button key={corner.id} aria-label={`Move camera to ${corner.label}`} aria-pressed={r.corner === corner.id}
            disabled={!r.camOn || saving} onClick={() => r.moveBubble(corner.id)}>{corner.id === 'tl' ? '\u2196' : corner.id === 'tr' ? '\u2197' : corner.id === 'bl' ? '\u2199' : '\u2198'}</button>)}
        </div>}
      </div>
    </div>
  );
}
