import { useRef, useState } from 'react';
import type { Recorder } from '../hooks/useRecorder';
import type { Corner } from '../lib/compositor';
import { fmtTime } from '../lib/format';
import * as I from './Icons';

const CORNERS: { id: Corner; label: string }[] = [
  { id: 'tl', label: 'top left' },
  { id: 'tr', label: 'top right' },
  { id: 'bl', label: 'bottom left' },
  { id: 'br', label: 'bottom right' },
];
const SOURCES = [['monitor', 'Full screen', 'screen'], ['window', 'Window', 'window'], ['browser', 'Current tab', 'tab']] as const;
const BACKGROUNDS = [['off', 'None'], ['warm', 'Warm studio'], ['blue', 'Blue studio']] as const;
const FRAMES = [['circle', 'Circle'], ['rounded', 'Rounded'], ['square', 'Square']] as const;
const bindStream = (stream: MediaStream | null) => (el: HTMLVideoElement | null) => { if (el && el.srcObject !== stream) el.srcObject = stream; };

export default function RecorderUI({ r, libraryCount = 0 }: { r: Recorder; libraryCount?: number }) {
  if (r.phase === 'idle') return null;
  if (r.phase === 'ready') return <Setup r={r} libraryCount={libraryCount} />;
  if (r.phase === 'countdown') {
    return (
      <div className="rec-countdown-overlay">
        <p className="rec-countdown-title">Get ready</p>
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
  const [view, setView] = useState<'main' | 'effects'>('main');
  const [sourceMenu, setSourceMenu] = useState(false);
  const [moreMenu, setMoreMenu] = useState(false);
  const cameraOnly = r.captureMode === 'camera';
  const source = SOURCES.find(([value]) => value === r.captureSurface) ?? SOURCES[2];
  const micLabel = r.micDeviceId
    ? r.microphones.find((device) => device.deviceId === r.micDeviceId)?.label || 'Microphone'
    : r.microphones.find((device) => device.deviceId === 'default')?.label || 'Default microphone';
  const cameraLabel = r.camStream?.getVideoTracks()[0]?.label || 'Camera';
  const captionsDisabled = !r.speechSupported || !r.hasMic || Boolean(r.micDeviceId);
  const captionsHint = !r.speechSupported ? 'Automatic captions need a browser with speech recognition support.'
    : !r.hasMic ? 'Connect a microphone to generate automatic captions.'
    : r.micDeviceId ? 'Automatic captions use your browser’s default microphone. Select the default microphone to enable them.'
    : 'Your browser’s speech service may process your voice online to create captions. The video itself isn’t uploaded for transcription.';
  const startLabel = r.preparing ? 'Getting ready…' : r.setupFailed ? 'Retry device setup'
    : r.busy ? (cameraOnly ? 'Preparing camera…' : 'Choose what to share…')
    : cameraOnly ? (r.hasMic ? 'Start camera recording' : 'Record camera without mic')
    : r.hasMic ? 'Start recording' : 'Record without mic';

  return (
    <div className="lr-screen">
      {(stream || cameraOnly) && (
        <div className={`lr-bubble is-${r.cameraFrame}${cameraOnly ? ' is-camera-only' : ` corner-${r.corner}`}`}>
          {stream ? <video ref={bindStream(stream)} autoPlay muted playsInline aria-label="Camera preview" /> : <span>Camera off</span>}
        </div>
      )}
      <section className="lr-panel" aria-label="Recording setup">
        {view === 'effects' ? (
          <>
            <div className="lr-sub-head">
              <button className="lr-icon" aria-label="Back to recorder" onClick={() => setView('main')}><I.Ico n="chevL" size={20} /></button>
              <h2>Effects</h2>
            </div>
            {!r.camOn && <p className="lr-hint">Turn the camera on to use effects.</p>}
            <div className="lr-section">
              <h3>Background</h3>
              <div className="lr-swatches" role="group" aria-label="Background">
                {BACKGROUNDS.map(([value, label]) => (
                  <button key={value} className={`lr-swatch is-${value}`} aria-pressed={r.virtualBackground === value} disabled={!r.camOn} onClick={() => r.setVirtualBackground(value as typeof r.virtualBackground)}><i />{label}</button>
                ))}
              </div>
              {r.virtualBackground !== 'off' && <p className="lr-hint">Uses a plain green backdrop to replace the area around you. Processing stays in this browser.</p>}
            </div>
            <div className="lr-section">
              <h3>Camera frame</h3>
              <div className="lr-chips" role="group" aria-label="Camera frame">
                {FRAMES.map(([value, label]) => <button key={value} className="lr-chip" aria-pressed={r.cameraFrame === value} disabled={!r.camOn} onClick={() => r.setCameraFrame(value as typeof r.cameraFrame)}>{label}</button>)}
              </div>
            </div>
            {!cameraOnly && (
              <div className="lr-section">
                <h3>Camera position</h3>
                <div className="lr-chips" role="group" aria-label="Camera bubble corner">
                  {CORNERS.map((corner) => (
                    <button key={corner.id} className="lr-chip lr-corner" aria-label={`Move camera to ${corner.label}`} aria-pressed={r.corner === corner.id} disabled={!r.camOn} onClick={() => r.moveBubble(corner.id)}><I.Ico n={`corner-${corner.id}`} size={16} />{corner.label}</button>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          <>
            <div className="lr-top">
              <button className="lr-icon" aria-label={`Go to library (${libraryCount} videos)`} title={`Library (${libraryCount})`} onClick={r.cancel}><I.Ico n="home" size={20} /></button>
              <div className="lr-tabs" role="group" aria-label="Capture mode">
                <button type="button" aria-pressed={!cameraOnly} aria-label="Screen and camera recording" title="Screen and camera" onClick={() => r.setCaptureMode('screen')}><I.Ico n="screen" size={19} /></button>
                <button type="button" aria-pressed={cameraOnly} aria-label="Camera only recording" title="Camera only" onClick={() => r.setCaptureMode('camera')}><I.Ico n="video" size={19} /></button>
              </div>
              <button className="lr-icon lr-close" aria-label="Close recorder" onClick={r.cancel}><I.Ico n="close" size={20} /></button>
            </div>

            {!cameraOnly && (
              <div className="lr-source">
                <button className="lr-row" onClick={() => setSourceMenu((open) => !open)} aria-expanded={sourceMenu} aria-haspopup="listbox">
                  <I.Ico n={source[2]} size={20} /><span className="lr-row-label">{source[1]}</span><I.Ico n="chevron" size={16} />
                </button>
                {sourceMenu && (
                  <div className="lr-menu lr-source-menu" role="listbox" aria-label="What to record">
                    {SOURCES.map(([value, label, icon]) => (
                      <button key={value} role="option" aria-selected={r.captureSurface === value} onClick={() => { r.setCaptureSurface(value); setSourceMenu(false); }}>
                        <I.Ico n={icon} size={18} />{label}{r.captureSurface === value && <b className="lr-check"><I.Ico n="check" size={15} /></b>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            <button className="lr-row" role="switch" aria-checked={r.camOn} onClick={r.toggleCamera}>
              <I.Ico n="video" size={20} /><span className="lr-row-label">{r.camOn ? cameraLabel : 'Camera'}</span>
              <span className={`lr-badge ${r.camOn ? 'is-on' : 'is-off'}`}>{r.camOn ? 'On' : 'Off'}</span>
            </button>

            <label className="lr-row lr-mic" htmlFor="rec-microphone">
              <I.Ico n="mic" size={20} /><span className="lr-row-label">{r.hasMic ? micLabel : 'No microphone found'}</span>
              <span className={`lr-badge ${r.hasMic ? 'is-on' : 'is-off'}`}>{r.hasMic ? 'On' : 'Off'}</span>
              <select ref={microphoneRef} id="rec-microphone" aria-label="Choose a microphone" value={r.micDeviceId} onChange={(e) => r.selectMicrophone(e.target.value)}>
                <option value="">{r.microphones.find((device) => device.deviceId === 'default')?.label || 'Default microphone'}</option>
                {r.microphones.filter((device) => device.deviceId).map((device) => <option value={device.deviceId} key={device.deviceId}>{device.label || 'Microphone'}</option>)}
              </select>
            </label>
            {r.hasMic ? (
              <>
                <div className="lr-meter" role="meter" aria-label="Microphone level" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(r.level * 100)}>
                  {Array.from({ length: 12 }, (_, i) => <span key={i} className={r.level * 12 > i ? 'is-lit' : ''} />)}
                </div>
                <p className="lr-hint">Say a few words to test your level.</p>
              </>
            ) : <button className="lr-link" onClick={() => microphoneRef.current?.focus()}>Choose a microphone</button>}

            {r.notices.map((notice) => <p key={notice} role="status" className="lr-note">{notice}</p>)}
            {r.error && <p role="alert" className="lr-note is-error">{r.error}</p>}

            <button autoFocus onClick={r.start} disabled={r.preparing || r.busy || (cameraOnly && !r.camOn)} className="lr-start">{startLabel}</button>
            {Number.isFinite(r.limitSec) && <p className="lr-hint lr-center">Recordings stop automatically at {fmtTime(r.limitSec * 1000)}.</p>}

            <nav className="lr-dock" aria-label="Recording options">
              <button type="button" onClick={() => { setView('effects'); setMoreMenu(false); }}><I.Ico n="palette" size={21} />Effects</button>
              <button type="button" aria-pressed={r.liveTranscription} disabled={captionsDisabled} title={captionsDisabled ? captionsHint : 'Generate captions while recording'} onClick={() => r.setLiveTranscription(!r.liveTranscription)}><I.Ico n="cc" size={21} />Captions</button>
              {!cameraOnly && <button type="button" aria-pressed={r.includeSystemAudio} title="Also record tab or system audio" onClick={() => r.setIncludeSystemAudio(!r.includeSystemAudio)}><I.Ico n="volume" size={21} />Audio</button>}
              <div className="lr-more-wrap">
                <button type="button" aria-haspopup="menu" aria-expanded={moreMenu} onClick={() => setMoreMenu((open) => !open)}><I.Ico n="more" size={21} />More</button>
                {moreMenu && (
                  <div className="lr-menu lr-more-menu" role="menu">
                    <p className="lr-menu-title">Keyboard shortcuts</p>
                    <dl className="lr-keys">
                      <div><dt>Start recording</dt><dd><kbd>Alt+Shift+R</kbd></dd></div>
                      <div><dt>Pause or resume</dt><dd><kbd>Alt+Shift+P</kbd></dd></div>
                      <div><dt>Stop</dt><dd><kbd>Alt+Shift+S</kbd></dd></div>
                    </dl>
                    <hr />
                    <button role="menuitem" onClick={r.cancel}><I.Ico n="close" size={18} />Close recorder</button>
                  </div>
                )}
              </div>
            </nav>
            {(captionsDisabled || r.liveTranscription) && <p className="lr-hint">{captionsHint}</p>}
            {r.liveTranscription && r.transcriptionStatus && <p className="lr-hint" role="status">{r.transcriptionStatus}</p>}
          </>
        )}
      </section>
    </div>
  );
}

function Live({ r }: { r: Recorder }) {
  const paused = r.phase === 'paused';
  const saving = r.phase === 'saving';
  const label = saving ? 'Saving…' : paused ? 'Paused' : 'Recording';
  return (
    <div className="rec-live-overlay lr-live">
      <div className="rec-live-status-row">
        <span role="status" className={`rec-live-status${paused || saving ? ' is-paused' : ''}`}><i />{label}</span>
        <span className="rec-live-limit">{Number.isFinite(r.limitSec) ? `${Math.max(0, r.limitSec - Math.floor(r.time / 1000))} seconds left · recording stops at ${fmtTime(r.limitSec * 1000)}` : 'No recording time limit'}</span>
        <span className="rec-live-shortcuts">Alt+Shift+P pause · Alt+Shift+S stop</span>
      </div>
      {r.warning && <p role="alert" className="rec-live-warning">{r.warning}</p>}
      {(r.liveTranscription || r.interimTranscript || r.transcript.length > 0) && <p className="rec-live-caption" role="status" aria-live="polite">{r.interimTranscript || r.transcript.at(-1)?.text || r.transcriptionStatus || 'Listening for speech…'}</p>}
      <div className={`rec-live-preview-row${r.captureMode === 'camera' ? ' is-camera-only' : ''}`}>
        <div className="rec-live-preview-card rec-live-screen">
          {r.screenStream ? <video ref={bindStream(r.screenStream)} autoPlay muted playsInline aria-label={r.captureMode === 'camera' ? 'Camera recording preview' : 'Shared screen preview'} /> : <span>Waiting for recording preview…</span>}
        </div>
        {r.captureMode === 'screen' && (
          <div className="rec-live-preview-card rec-live-camera-card">
            {r.camStream && r.camOn ? <video ref={bindStream(r.camStream)} autoPlay muted playsInline /> : <span>Camera off</span>}
            <strong>{r.camOn ? 'Camera preview' : 'Camera is off'}</strong>
          </div>
        )}
      </div>
      <div className="lr-rail" role="toolbar" aria-label="Recording controls" aria-orientation="vertical">
        <button className="lr-rail-stop" disabled={saving} onClick={r.stop} aria-label={saving ? 'Saving…' : 'Stop and save'} title={saving ? 'Saving…' : 'Stop and save'}><I.Stop /></button>
        <span className="lr-rail-time">{fmtTime(r.time)}</span>
        <button disabled={saving} onClick={paused ? r.resume : r.pause} aria-label={paused ? 'Resume' : 'Pause'} title={paused ? 'Resume' : 'Pause'}>{paused ? <I.Play /> : <I.Pause />}</button>
        <button disabled={saving} onClick={r.restart} aria-label="Restart recording" title="Restart"><I.Restart /></button>
        <button disabled={saving} onClick={r.cancel} aria-label="Cancel recording" title="Cancel"><I.Close /></button>
      </div>
      {r.camStream && (
        <div className="lr-cam-tools" role="group" aria-label="Camera bubble">
          <button disabled={saving} onClick={r.toggleCamera}>{r.camOn ? 'Camera on' : 'Camera off'}</button>
          <label>Background
            <select value={r.virtualBackground} onChange={(e) => r.setVirtualBackground(e.currentTarget.value as typeof r.virtualBackground)} disabled={saving || !r.camOn}>
              <option value="off">Off</option><option value="warm">Warm studio</option><option value="blue">Blue studio</option>
            </select>
          </label>
          <label>Frame
            <select value={r.cameraFrame} onChange={(e) => r.setCameraFrame(e.currentTarget.value as typeof r.cameraFrame)} disabled={saving || !r.camOn}>
              <option value="circle">Circle</option><option value="rounded">Rounded</option><option value="square">Square</option>
            </select>
          </label>
          {CORNERS.map((corner) => <button key={corner.id} aria-label={`Move camera to ${corner.label}`} title={`Move camera to ${corner.label}`} aria-pressed={r.corner === corner.id} disabled={!r.camOn || saving} onClick={() => r.moveBubble(corner.id)}><I.Ico n={`corner-${corner.id}`} size={15} /></button>)}
        </div>
      )}
    </div>
  );
}