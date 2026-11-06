import { useCallback, useEffect, useRef, useState } from 'react';
import { describeError, type CaptureSurface } from '../lib/capture';
import type { CameraFrame, Corner, VirtualBackground } from '../lib/compositor';
import { IdbSink, RecordingLimitError, requestPersistence, saveRecording, type RecordingMeta, type TranscriptCue } from '../lib/db';
import { fmtTime } from '../lib/format';
import { RecorderSession, type Result, type State } from '../lib/recorder';

export const LIMIT_SEC = 300;
const APP_TITLE = 'ClientoraHQ Recorder';

/** Connects the recording engine to React: state, actions and keyboard shortcuts. */
export function useRecorder(onSaved: (m: RecordingMeta) => void, limitSec = LIMIT_SEC, maxVideoWidth = 1280, maxVideoHeight = 720, maxVideos = Infinity, onSaveError?: (message: string) => void, noiseSuppression = true) {
  const session = useRef<RecorderSession | null>(null);
  const saving = useRef(false);
  const token = useRef(0);
  const [phase, setPhase] = useState<'idle' | State>('idle');
  const [preparing, setPreparing] = useState(false);
  const [setupFailed, setSetupFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [time, setTime] = useState(0);
  const [count, setCount] = useState(0);
  const [level, setLevel] = useState(0);
  const [hasMic, setHasMic] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);
  const [notices, setNotices] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [camStream, setCamStream] = useState<MediaStream | null>(null);
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [camOn, setCamOn] = useState(false);
  const [corner, setCorner] = useState<Corner>('br');
  const [virtualBackground, setVirtualBackgroundState] = useState<VirtualBackground>('off');
  const [cameraFrame, setCameraFrameState] = useState<CameraFrame>('circle');
  const [captureMode, setCaptureModeState] = useState<'screen' | 'camera'>('screen');
  const [liveTranscription, setLiveTranscriptionState] = useState(false);
  const [transcript, setTranscript] = useState<TranscriptCue[]>([]);
  const [interimTranscript, setInterimTranscript] = useState('');
  const [transcriptionStatus, setTranscriptionStatus] = useState('');
  const [microphones, setMicrophones] = useState<MediaDeviceInfo[]>([]);
  const [micDeviceId, setMicDeviceId] = useState('');
  const [captureSurface, setCaptureSurface] = useState<CaptureSurface>('window');
  const [includeSystemAudio, setIncludeSystemAudio] = useState(true);
  const [activeLimitSec, setActiveLimitSec] = useState(limitSec);
  const [activeSource, setActiveSource] = useState<'recorded' | 'meeting'>('recorded');

  const reset = useCallback(() => {
    saving.current = false;
    setPhase('idle');
    setCamStream(null);
    setScreenStream(null);
    setVirtualBackgroundState('off');
    setCameraFrameState('circle');
    setCaptureModeState('screen');
    setLiveTranscriptionState(false);
    setTranscript([]);
    setInterimTranscript('');
    setTranscriptionStatus('');
    setWarning(null);
    setTime(0);
    setBusy(false);
    setPreparing(false);
    setSetupFailed(false);
    setHasMic(false);
    setActiveLimitSec(limitSec);
    setActiveSource('recorded');
  }, [limitSec]);

  const finish = useCallback(async (r: Result) => {
    try {
      onSaved(await saveRecording(r, undefined, maxVideos));
    } catch (error) {
      const message = error instanceof RecordingLimitError
        ? error.message
        : 'Could not save the recording. The browser may be out of storage.';
      setError(message);
      onSaveError?.(message);
    }
    reset();
  }, [maxVideos, onSaveError, onSaved, reset]);

  const open = useCallback(async (camera: boolean, deviceId = micDeviceId, source: 'recorded' | 'meeting' = 'recorded', mode: 'screen' | 'camera' = 'screen') => {
    const id = ++token.current;
    const old = session.current;
    session.current = null;
    old?.cancel();
    saving.current = false;
    setError(null);
    setWarning(null);
    setTime(0);
    setCorner('br');
    setVirtualBackgroundState('off');
    setCameraFrameState('circle');
    setCaptureModeState(mode);
    setLiveTranscriptionState(false);
    setTranscript([]);
    setInterimTranscript('');
    setTranscriptionStatus('');
    setPreparing(true);
    setSetupFailed(false);
    setPhase('ready');
    const sessionLimit = source === 'meeting' ? Infinity : limitSec;
    setActiveSource(source);
    setActiveLimitSec(sessionLimit);
    void requestPersistence().catch(() => undefined);
    let me: RecorderSession;
    const live = () => session.current === me;
    try {
      me = await RecorderSession.prepare({ camera, micDeviceId: deviceId || undefined, limitSec: sessionLimit, maxVideoWidth, maxVideoHeight, source, noiseSuppression }, {
        onState: (s) => {
          if (!live()) return;
          if (s === 'saving') saving.current = true;
          if (s === 'closed') {
            if (!saving.current) reset();
            return;
          }
          setPhase(s);
        },
        onCount: (n) => { if (live()) setCount(n); },
        onTime: (ms) => { if (live()) setTime(ms); },
        onLimitWarning: (n) => { if (live()) setWarning(`Recording ends in ${n} seconds.`); },
        onError: (text) => { if (live()) { saving.current = false; setError(text); } },
        onTranscript: (cues, interim) => { if (live()) { setTranscript(cues); setInterimTranscript(interim); } },
        onTranscriptionStatus: (message) => { if (live()) setTranscriptionStatus(message); },
        onDone: (r) => { if (live()) void finish(r); },
      }, () => new IdbSink());
    } catch {
      if (id === token.current) {
        setError('Could not prepare recording devices. Check browser support and device permissions.');
        setSetupFailed(true);
        setPhase('ready');
        setPreparing(false);
      }
      return;
    }
    if (id !== token.current) {
      me.cancel(); // closed or reopened while the permission prompt was showing
      return;
    }
    session.current = me;
    setNotices(me.notices);
    setCamStream(me.cam);
    setHasMic(me.hasMic);
    setPreparing(false);
    void navigator.mediaDevices.enumerateDevices().then((devices) => {
      if (id === token.current) setMicrophones(devices.filter((device) => device.kind === 'audioinput'));
    }).catch(() => setMicrophones([]));
  }, [finish, limitSec, maxVideoHeight, maxVideoWidth, micDeviceId, noiseSuppression, reset]);

  const openPanel = useCallback((source: 'recorded' | 'meeting' = 'recorded') => {
    setCamOn(false);
    return open(false, micDeviceId, source, 'screen');
  }, [micDeviceId, open]);

  const start = useCallback(async () => {
    const s = session.current;
    if (!s) {
      if (setupFailed && !preparing) void open(camOn, micDeviceId, activeSource, captureMode);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (captureMode === 'camera') await s.shareCameraOnly();
      else await s.shareScreen(captureSurface, includeSystemAudio, corner);
    } catch (e) {
      setError(captureMode === 'camera' ? (e instanceof Error ? e.message : 'Could not start camera recording.') : describeError(e, 'screen').message);
      setBusy(false);
      return;
    }
    setScreenStream(s.recordingStream);
    setBusy(false);
    setWarning(null);
    await s.begin();
  }, [activeSource, camOn, captureMode, captureSurface, corner, includeSystemAudio, micDeviceId, open, preparing, setupFailed]);

  const pause = useCallback(() => session.current?.pause(), []);
  const resume = useCallback(() => session.current?.resume(), []);
  const stop = useCallback(() => { void session.current?.stop(); }, []);
  const restart = useCallback(() => { void session.current?.restart(); }, []);
  const cancel = useCallback(() => {
    token.current++;
    const s = session.current;
    session.current = null;
    s?.cancel();
    reset();
  }, [reset]);

  const toggleCamera = useCallback(() => {
    const next = !camOn;
    setCamOn(next);
    if (phase === 'ready') void open(next, micDeviceId, activeSource, captureMode);
    else session.current?.setCamera(next);
  }, [activeSource, camOn, captureMode, micDeviceId, phase, open]);

  const selectMicrophone = useCallback((deviceId: string) => {
    setMicDeviceId(deviceId);
    if (phase === 'ready') void open(camOn, deviceId, activeSource, captureMode);
  }, [activeSource, camOn, captureMode, open, phase]);

  const setCaptureMode = useCallback((mode: 'screen' | 'camera') => {
    setCaptureModeState(mode);
    if (mode === 'camera' && !camOn) {
      setCamOn(true);
      void open(true, micDeviceId, activeSource, mode);
    }
  }, [activeSource, camOn, micDeviceId, open]);

  const setLiveTranscription = useCallback((enabled: boolean) => {
    setLiveTranscriptionState(enabled);
    setTranscriptionStatus(enabled ? 'Automatic captions are on.' : '');
    session.current?.setSpeechTranscription(enabled);
  }, []);

  const moveBubble = useCallback((c: Corner) => {
    setCorner(c);
    session.current?.setCorner(c);
  }, []);
  const setVirtualBackground = useCallback((background: VirtualBackground) => {
    setVirtualBackgroundState(background);
    session.current?.setVirtualBackground(background);
  }, []);
  const setCameraFrame = useCallback((frame: CameraFrame) => {
    setCameraFrameState(frame);
    session.current?.setCameraFrame(frame);
  }, []);

  useEffect(() => {
    if (phase !== 'ready') return undefined;
    let raf = 0;
    const loop = () => {
      setLevel(session.current?.level() ?? 0);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [phase]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (localStorage.getItem('clientorahq-keyboard-shortcuts-enabled') === 'false') return;
      const target = e.target;
      if (target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return;
      const s = session.current;
      if (e.key === 'Escape' && s && s.state !== 'saving' && s.state !== 'closed') {
        e.preventDefault();
        cancel();
        return;
      }
      if (!s || !e.altKey || !e.shiftKey) return;
      if (e.code === 'KeyP') {
        e.preventDefault();
        if (s.state === 'paused') s.resume();
        else s.pause();
      } else if (e.code === 'KeyS') {
        e.preventDefault();
        void s.stop();
      } else if (e.code === 'KeyR') {
        e.preventDefault();
        void s.restart();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cancel]);

  useEffect(() => {
    document.title =
      phase === 'recording' ? `● ${fmtTime(time)} Recording`
      : phase === 'paused' ? `Paused ${fmtTime(time)}`
      : APP_TITLE;
  }, [phase, time]);

  useEffect(() => () => { session.current?.cancel(); }, []);

  const speechSupported = typeof window !== 'undefined' && Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);

  return {
    phase, preparing, setupFailed, busy, time, count, level, hasMic, warning, notices, error, camStream, screenStream, camOn, corner, virtualBackground, setVirtualBackground, cameraFrame, setCameraFrame, captureMode, setCaptureMode,
    liveTranscription, setLiveTranscription, transcript, interimTranscript, transcriptionStatus, speechSupported,
    microphones, micDeviceId, selectMicrophone, captureSurface, setCaptureSurface,
    includeSystemAudio, setIncludeSystemAudio, limitSec: activeLimitSec,
    openPanel, start, pause, resume, stop, restart, cancel, toggleCamera, moveBubble,
  };
}

export type Recorder = ReturnType<typeof useRecorder>;
