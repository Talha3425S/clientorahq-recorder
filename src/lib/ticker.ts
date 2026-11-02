// A timer that runs in a Web Worker. Timers on the main thread are throttled
// when the recorder tab is in the background (which is the normal case while
// recording another window); worker timers are not.
export function createTicker(fps: number, onTick: () => void): () => void {
  const code = `let t;onmessage=(e)=>{if(e.data==='go'){t=setInterval(()=>postMessage(0),${Math.round(1000 / fps)})}}`;
  const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
  const worker = new Worker(url);
  worker.onmessage = onTick;
  worker.postMessage('go');
  return () => {
    worker.terminate();
    URL.revokeObjectURL(url);
  };
}