// Temporary test harness for the engine. The real UI comes next.
import { useEffect, useRef, useState } from 'react';
import { describeError } from './lib/capture';
import { RecorderSession, type State } from './lib/recorder';
import { IdbSink, requestPersistence, saveRecording } from './lib/db.ts';
import { checkSupport } from './lib/support';
import Library from './Library';

const fmt = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export default function App() {
  const support = checkSupport();
  const session = useRef<RecorderSession | null>(null);
  const urlRef = useRef<string | null>(null);
  const [state, setState] = useState<State | 'idle'>('idle');
  const [shared, setShared] = useState(false);
  const [time, setTime] = useState(0);
  const [count, setCount] = useState(0);
  const [level, setLevel] = useState(0);
  const [msgs, setMsgs] = useState<string[]>([]);
  const [url, setUrl] = useState<string | null>(null);
  const [libKey, setLibKey] = useState(0);

  useEffect(() => () => {
    session.current?.cancel();
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
  }, []);

  useEffect(() => {
    if (state !== 'ready') return undefined;
    let raf = 0;
    const loop = () => {
      setLevel(session.current?.level() ?? 0);
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [state]);

  if (!support.ok) return <p role="alert">{support.reason}</p>;

  const s = session.current;
  const live = state === 'recording' || state === 'paused';

  const prepare = async () => {
    void requestPersistence();
    const next = await RecorderSession.prepare({}, {
      onState: (st) => { setState(st); if (st === 'closed') setShared(false); },
      onCount: setCount,
      onTime: setTime,
      onLimitWarning: (n) => setMsgs([`Recording ends in ${n} seconds.`]),
      onDone: async (r) => {
        if (urlRef.current) URL.revokeObjectURL(urlRef.current);
        urlRef.current = URL.createObjectURL(r.blob);
        setUrl(urlRef.current);
        try {
          await saveRecording(r);
          setLibKey((k) => k + 1);
        } catch {
          setMsgs(['Could not save to the library. The browser may be out of storage.']);
        }
      },
    }, () => new IdbSink());
    session.current = next;
    setMsgs(next.notices);
    setState(next.state);
  };

  const share = async () => {
    try {
      await s?.shareScreen();
      setShared(true);
      setMsgs([]);
    } catch (e) {
      setMsgs([describeError(e, 'screen').message]);
    }
  };

  return (
    <main style={{ fontFamily: 'system-ui', padding: 24, maxWidth: 560 }}>
      <h1>Recorder core (test harness)</h1>
      <p>
        State: <b>{state}</b>{state === 'countdown' && count > 0 ? ` ${count}` : ''} · {fmt(time)}
      </p>
      <label>Mic level <progress value={level} max={1} /></label>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '12px 0' }}>
        <button onClick={prepare} disabled={state !== 'idle' && state !== 'closed'}>1. Mic + camera</button>
        <button onClick={share} disabled={state !== 'ready'}>2. Share screen</button>
        <button onClick={() => s?.begin()} disabled={state !== 'ready' || !shared}>3. Record</button>
        <button onClick={() => (state === 'paused' ? s?.resume() : s?.pause())} disabled={!live}>
          {state === 'paused' ? 'Resume' : 'Pause'}
        </button>
        <button onClick={() => s?.stop()} disabled={!live}>Stop</button>
        <button onClick={() => s?.cancel()} disabled={!live && state !== 'countdown'}>Cancel</button>
      </div>
      {msgs.map((m) => <p key={m} role="status">{m}</p>)}
      {url && (
        <>
          <video src={url} controls style={{ width: '100%' }} />
          <a href={url} download="recording">Download</a>
        </>
      )}
      <Library refreshKey={libKey} />
    </main>
  );
}