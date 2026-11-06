import { useRef, useState } from 'react';
import type { Recorder } from '../hooks/useRecorder';
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
        <section className={`rec-preview${r.captureMode === 'camera' ? ' is-camera-only' : ''}`} aria-label="Recording preview">
          <span className="rec-ready-pill">Ready</span>
          {r.captureMode === 'screen' && <p>Your screen preview appears here</p>}
          {r.captureMode === 'camera' && stream ? <video ref={(el) => { if (el && el.srcObject !== stream) el.srcObject = stream; }} autoPlay muted playsInline aria-label="Camera preview" className="rec-camera-only-preview" /> : null}
          {r.captureMode === 'camera' && !stream ? <span className="rec-camera-placeholder">Camera off</span> : null}
          {r.captureMode === 'screen' && stream ? <video
            ref={(el) => { if (el && el.srcObject !== stream) el.srcObject = stream; }}
            autoPlay muted playsInline aria-label="Camera preview" className="rec-camera-preview"
          /> : r.captureMode === 'screen' ? <span className="rec-camera-placeholder">{r.camOn ? 'TJ' : 'Camera off'}</span> : null}
        </section>

        <section className="rec-setup-options loom-recorder-panel" aria-label="Recording setup">
          <div className="loom-rec-mode-row" aria-label="Capture modes">
            <span className="loom-rec-mode-label">Record</span>
            <button type="button" className={r.captureMode === 'screen' ? 'is-selected' : ''} aria-label="Screen and camera recording" aria-pressed={r.captureMode === 'screen'} onClick={() => r.setCaptureMode('screen')}><I.Screen /></button>
            <button type="button" className={r.captureMode === 'camera' ? 'is-selected' : ''} aria-label="Camera only recording" aria-pressed={r.captureMode === 'camera'} onClick={() => r.setCaptureMode('camera')}><I.VideoCam /></button>
            <button className="loom-rec-close" aria-label="Close recorder setup" onClick={r.cancel}><I.Close /></button>
          </div>
          {r.captureMode === 'screen' && (
          <div className="rec-step-group">
            <h1>1 · WHAT TO RECORD</h1>
            <div className="loom-source-picker">
              <button className="loom-source-select" onClick={() => setSourceMenu((open) => !open)} aria-expanded={sourceMenu}><span>▦</span>{sourceLabel}<i>⌄</i></button>
              {sourceMenu && <div className="loom-source-menu" role="listbox" aria-label="What to record">
                {([['monitor', 'Full Screen'], ['window', 'Window'], ['browser', 'Current tab']] as const).map(([value, label]) => <button key={value} role="option" aria-selected={r.captureSurface === value} onClick={() => { r.setCaptureSurface(value); setSourceMenu(false); }}><span>{value === 'monitor' ? '▣' : value === 'window' ? '▦' : '▱'}</span>{label}{r.captureSurface === value && <b>✓</b>}</button>)}
              </div>}
            </div>
          </div>

          )}
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
            <h2>{r.captureMode === 'camera' ? '3 · CAMERA' : '3 · CAMERA BUBBLE'}</h2>
            <button className={`rec-camera-toggle${r.camOn ? ' is-selected' : ''}`} role="switch" aria-checked={r.camOn} onClick={r.toggleCamera}>
              Camera {r.camOn ? 'on' : 'off'}
            </button>
            {r.captureMode === 'screen' && <div className="rec-corner-picker" role="group" aria-label="Camera bubble corner">
              {CORNERS.map((corner) => <button key={corner.id} aria-label={`Move camera to ${corner.label}`} aria-pressed={r.corner === corner.id}
                onClick={() => r.moveBubble(corner.id)} disabled={!r.camOn}>{corner.id === 'tl' ? '\u2196' : corner.id === 'tr' ? '\u2197' : corner.id === 'bl' ? '\u2199' : '\u2198'}</button>)}
            </div>}
            <label className="rec-background-picker">Virtual background
              <select value={r.virtualBackground} onChange={(e) => r.setVirtualBackground(e.currentTarget.value as typeof r.virtualBackground)} disabled={!r.camOn}>
                <option value="off">Off</option>
                <option value="warm">Warm studio · green screen</option>
                <option value="blue">Blue studio · green screen</option>
              </select>
            </label>
            <label className="rec-background-picker">Camera frame
              <select value={r.cameraFrame} onChange={(e) => r.setCameraFrame(e.currentTarget.value as typeof r.cameraFrame)} disabled={!r.camOn}>
                <option value="circle">Circle</option><option value="rounded">Rounded</option><option value="square">Square</option>
              </select>
            </label>
            {r.virtualBackground !== 'off' && <p className="rec-helper">Uses a plain green backdrop to replace the area around you. Processing stays in this browser.</p>}
          </div>

          {r.captureMode === 'screen' && (<label className="rec-system-audio"><input type="checkbox" checked={r.includeSystemAudio} onChange={(e) => r.setIncludeSystemAudio(e.target.checked)} />
            <span>Also record tab / system sound</span>
          </label>)}
          <div className="rec-transcription-option">
            <label><input type="checkbox" checked={r.liveTranscription} onChange={(event) => r.setLiveTranscription(event.currentTarget.checked)} disabled={!r.speechSupported || !r.hasMic || Boolean(r.micDeviceId)} />
              <span>Generate captions while recording</span>
            </label>
            <p>{!r.speechSupported ? 'Automatic captions need a browser with speech recognition support.' : !r.hasMic ? 'Connect a microphone to generate automatic captions.' : r.micDeviceId ? 'Automatic captions use your browser default microphone. Select the default microphone to enable them.' : 'Your browser speech service may process your voice online. The video itself is not uploaded for transcription.'}</p>
            {r.transcriptionStatus && <p role="status">{r.transcriptionStatus}</p>}
          </div>
          {r.notices.map((notice) => <p key={notice} role="status" className="rec-setup-notice">{notice}</p>)}
          {r.error && <p role="alert" className="rec-setup-error">{r.error}</p>}
          {!r.hasMic && <button className="rec-choose-mic" onClick={() => microphoneRef.current?.focus()}>Choose a microphone</button>}
          <button autoFocus onClick={r.start} disabled={r.preparing || r.busy || (r.captureMode === 'camera' && !r.camOn)} className="rec-start-button">
            {r.preparing ? 'Getting ready?' : r.setupFailed ? 'Retry device setup' : r.busy ? (r.captureMode === 'camera' ? 'Preparing camera?' : 'Choose what to share?') : r.captureMode === 'camera' ? (r.hasMic ? 'Start camera recording' : 'Record camera without mic') : r.hasMic ? 'Start recording' : 'Record without mic'}
          </button>
        </section>
      </main>
      <footer className="rec-setup-footer">
        <p>{Number.isFinite(r.limitSec) ? `Limit ${fmtTime(r.limitSec * 1000)} · recording stops automatically` : 'No recording time limit'} · Shortcuts: Alt+Shift+R record, P pause, S stop</p>
          <p>{r.liveTranscription ? 'Video stays in this browser. The browser speech service may process microphone audio to create captions.' : 'Private by default: recordings stay in this browser and never leave your computer.'}</p>
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
        <span className="rec-live-limit">{Number.isFinite(r.limitSec) ? `${Math.max(0, r.limitSec - Math.floor(r.time / 1000))} seconds left · recording stops at ${fmtTime(r.limitSec * 1000)}` : 'No recording time limit'}</span>
        <span className="rec-live-shortcuts">Alt+Shift+P pause · Alt+Shift+S stop</span>
      </div>
      {r.warning && <p role="alert" className="rec-live-warning">{r.warning}</p>}
      {(r.liveTranscription || r.interimTranscript || r.transcript.length > 0) && <p className="rec-live-caption" role="status" aria-live="polite">{r.interimTranscript || r.transcript.at(-1)?.text || r.transcriptionStatus || 'Listening for speech…'}</p>}
      <div className={`rec-live-preview-row${r.captureMode === 'camera' ? ' is-camera-only' : ''}`}>
        <div className="rec-live-preview-card rec-live-screen">
          {r.screenStream ? <video ref={(el) => { if (el && el.srcObject !== r.screenStream) el.srcObject = r.screenStream; }} autoPlay muted playsInline aria-label={r.captureMode === 'camera' ? 'Camera recording preview' : 'Shared screen preview'} /> : <span>Waiting for recording preview…</span>}
        </div>
        {r.captureMode === 'screen' && (
        <div className="rec-live-preview-card rec-live-camera-card">
          {r.camStream && r.camOn ? <video ref={(el) => { if (el && el.srcObject !== r.camStream) el.srcObject = r.camStream; }} autoPlay muted playsInline /> : <span>Camera off</span>}
          <strong>{r.camOn ? 'Camera preview' : 'Camera is off'}</strong>
        </div>
        )}
      </div>
      <div className="rec-live-toolbar">
        <span className="rec-live-time">{fmtTime(r.time)} <small>/ {Number.isFinite(r.limitSec) ? fmtTime(r.limitSec * 1000) : '∞'}</small></span>
        <button disabled={saving} onClick={paused ? r.resume : r.pause}>{paused ? <I.Play /> : <I.Pause />}{paused ? 'Resume' : 'Pause'}</button>
        <button className="is-stop" disabled={saving} onClick={r.stop}><I.Stop />{saving ? 'Saving…' : 'Stop'}</button>
        <button disabled={saving} onClick={r.restart}><I.Restart />Restart</button>
        <button disabled={saving} onClick={r.cancel}><I.Close />Cancel</button>
        {r.camStream && <div className="rec-live-camera-tools" role="group" aria-label="Camera bubble">
          <button disabled={saving} onClick={r.toggleCamera}>{r.camOn ? 'Camera on' : 'Camera off'}</button>
          <label className="rec-live-background-picker">Background
            <select value={r.virtualBackground} onChange={(e) => r.setVirtualBackground(e.currentTarget.value as typeof r.virtualBackground)} disabled={saving || !r.camOn}>
              <option value="off">Off</option><option value="warm">Warm studio</option><option value="blue">Blue studio</option>
            </select>
          </label>
          <label className="rec-live-background-picker">Frame
            <select value={r.cameraFrame} onChange={(e) => r.setCameraFrame(e.currentTarget.value as typeof r.cameraFrame)} disabled={saving || !r.camOn}>
              <option value="circle">Circle</option><option value="rounded">Rounded</option><option value="square">Square</option>
            </select>
          </label>
          {CORNERS.map((corner) => <button key={corner.id} aria-label={`Move camera to ${corner.label}`} aria-pressed={r.corner === corner.id}
            disabled={!r.camOn || saving} onClick={() => r.moveBubble(corner.id)}>{corner.id === 'tl' ? '\u2196' : corner.id === 'tr' ? '\u2197' : corner.id === 'bl' ? '\u2199' : '\u2198'}</button>)}
        </div>}
      </div>
    </div>
  );
}
