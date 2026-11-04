import { useCallback, useEffect, useRef, useState } from 'react';
import { describeError, type CaptureSurface } from '../lib/capture';
import type { Corner } from '../lib/compositor';
import { IdbSink, requestPersistence, saveRecording, type RecordingMeta } from '../lib/db';
import { fmtTime } from '../lib/format';
import { RecorderSession, type Result, type State } from '../lib/recorder';

export const LIMIT_SEC = 300;
const APP_TITLE = 'ClientoraHQ Recorder';

/** Connects the recording engine to React: state, actions and keyboard shortcuts. */
export function useRecorder(onSaved: (m: RecordingMeta) => void) {
  const session = useRef<RecorderSession | null>(null);
  const saving = useRef(false);
  const token = useRef(0);
  const [phase, setPhase] = useState<'idle' | State>('idle');
  const [preparing, setPreparing] = useState(false);
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
  const [microphones, setMicrophones] = useState<MediaDeviceInfo[]>([]);
  const [micDeviceId, setMicDeviceId] = useState('');
  const [captureSurface, setCaptureSurface] = useState<CaptureSurface>('window');
  const [includeSystemAudio, setIncludeSystemAudio] = useState(true);

  const reset = useCallback(() => {
    saving.current = false;
    setPhase('idle');
    setCamStream(null);
    setScreenStream(null);
    setWarning(null);
    setTime(0);
    setBusy(false);
    setPreparing(false);
    setHasMic(false);
  }, []);

  const finish = useCallback(async (r: Result) => {
    try {
      onSaved(await saveRecording(r));
    } catch {
      setError('Could not save the recording. The browser may be out of storage.');
    }
    reset();
  }, [onSaved, reset]);

  const open = useCallback(async (camera: boolean, deviceId = micDeviceId) => {
    const id = ++token.current;
    const old = session.current;
    session.current = null;
    old?.cancel();
    saving.current = false;
    setError(null);
    setWarning(null);
    setTime(0);
    setCorner('br');
    setPreparing(true);
    setPhase('ready');
    void requestPersistence().catch(() => undefined);
    let me: RecorderSession;
    const live = () => session.current === me;
    try {
      me = await RecorderSession.prepare({ camera, micDeviceId: deviceId || undefined, limitSec: LIMIT_SEC }, {
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
        onDone: (r) => { if (live()) void finish(r); },
      }, () => new IdbSink());
    } catch {
      if (id === token.current) {
        setError('Could not prepare recording devices. Check browser support and device permissions.');
        setPhase('idle');
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
  }, [finish, micDeviceId, reset]);

  const openPanel = useCallback(() => {
    setCamOn(false);
    return open(false);
  }, [open]);

  const start = useCallback(async () => {
    const s = session.current;
    if (!s) return;
    setBusy(true);
    setError(null);
    try {
      await s.shareScreen(captureSurface, includeSystemAudio, corner);
    } catch (e) {
      setError(describeError(e, 'screen').message);
      setBusy(false);
      return;
    }
    setScreenStream(s.screenStream);
    setBusy(false);
    setWarning(null);
    await s.begin();
  }, [captureSurface, corner, includeSystemAudio]);

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
    if (phase === 'ready') void open(next, micDeviceId);
    else session.current?.setCamera(next);
  }, [camOn, micDeviceId, phase, open]);

  const selectMicrophone = useCallback((deviceId: string) => {
    setMicDeviceId(deviceId);
    if (phase === 'ready') void open(camOn, deviceId);
  }, [camOn, open, phase]);

  const moveBubble = useCallback((c: Corner) => {
    setCorner(c);
    session.current?.setCorner(c);
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

  return {
    phase, preparing, busy, time, count, level, hasMic, warning, notices, error, camStream, screenStream, camOn, corner,
    microphones, micDeviceId, selectMicrophone, captureSurface, setCaptureSurface,
    includeSystemAudio, setIncludeSystemAudio,
    openPanel, start, pause, resume, stop, restart, cancel, toggleCamera, moveBubble,
  };
}

export type Recorder = ReturnType<typeof useRecorder>;
