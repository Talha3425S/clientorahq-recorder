import { useEffect, useState } from 'react';
import { getVideo, replaceRecordingVideo, type RecordingMeta } from '../lib/db';
import { fmtDate, fmtSize, fmtTime } from '../lib/format';
import { trimVideo } from '../lib/media';
import { canRecordMp4 } from '../lib/support';

interface Props {
  meta: RecordingMeta;
  onBack: () => void;
  onRename: (title: string) => void;
  onDelete: () => void;
  onTrimmed: (meta: RecordingMeta) => void;
}

export default function VideoPage({ meta, onBack, onRename, onDelete, onTrimmed }: Props) {
  const [src, setSrc] = useState<string | null>(null);
  const [durationMs, setDurationMs] = useState(meta.durationMs);
  const [trimStartMs, setTrimStartMs] = useState(0);
  const [trimEndMs, setTrimEndMs] = useState(meta.durationMs);
  const [trimming, setTrimming] = useState(false);
  const [trimError, setTrimError] = useState<string | null>(null);
  const [trimSaved, setTrimSaved] = useState(false);
  const [downloading, setDownloading] = useState<'webm' | 'mp4' | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const trimChanged = trimStartMs > 0 || trimEndMs < durationMs;

  useEffect(() => {
    let url: string | null = null;
    let cancelled = false;
    void getVideo(meta.id).then((blob) => {
      if (!cancelled && blob) {
        url = URL.createObjectURL(blob);
        setSrc(url);
      }
    });
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  }, [meta.id, meta.size]);

  useEffect(() => {
    setDurationMs(meta.durationMs);
    setTrimStartMs(0);
    setTrimEndMs(meta.durationMs);
    setTrimError(null);
    setTrimSaved(false);
  }, [meta.id]);

  const applyTrim = async () => {
    if (!trimChanged || trimming) return;
    setTrimming(true); setTrimError(null); setTrimSaved(false);
    try {
      const original = await getVideo(meta.id);
      if (!original) throw new Error('The original video is missing from this browser.');
      const clipped = await trimVideo(original, trimStartMs, trimEndMs);
      const updated = await replaceRecordingVideo(meta.id, clipped, trimEndMs - trimStartMs, clipped.type || meta.mimeType);
      onTrimmed(updated);
      setDurationMs(updated.durationMs); setTrimStartMs(0); setTrimEndMs(updated.durationMs); setTrimSaved(true);
    } catch (error) {
      setTrimError(error instanceof Error ? error.message : 'Could not trim this video.');
    } finally { setTrimming(false); }
  };

  const downloadAs = async (format: 'webm' | 'mp4') => {
    if (downloading) return;
    setDownloading(format); setDownloadError(null);
    try {
      const original = await getVideo(meta.id);
      if (!original) throw new Error('This recording is no longer available in this browser.');
      const alreadyFormat = original.type.toLowerCase().includes(format);
      const file = alreadyFormat ? original : await trimVideo(original, 0, durationMs, format);
      const url = URL.createObjectURL(file);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${meta.title.replace(/[\\/:*?"<>|]+/g, '-')}.${format}`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (error) {
      setDownloadError(error instanceof Error ? error.message : `Could not create ${format.toUpperCase()} file.`);
    } finally { setDownloading(null); }
  };

  const commitTitle = (input: HTMLInputElement) => {
    const title = input.value.trim();
    if (!title) input.value = meta.title;
    else if (title !== meta.title) onRename(title);
  };
  const seek = (value: number) => {
    const video = document.querySelector<HTMLVideoElement>('.pdf-video-preview video');
    if (video) video.currentTime = value / 1000;
  };

  return (
    <section className="pdf-video-page" aria-label="Review recording">
      <button onClick={onBack} className="pdf-back-button">← Back to library</button>
      <div className="pdf-video-layout">
        <div className="pdf-video-main">
          <div className="pdf-video-preview">
            {src ? <video src={src} controls onLoadedMetadata={(event) => {
              const measured = Number.isFinite(event.currentTarget.duration) ? Math.round(event.currentTarget.duration * 1000) : 0;
              if (!durationMs && measured) { setDurationMs(measured); setTrimEndMs(measured); }
            }} /> : <p>Loading recording…</p>}
          </div>
          <section className="pdf-trim-section" aria-labelledby="trim-title">
            <h2 id="trim-title">Trim your recording</h2>
            <div className="pdf-trim-track" aria-hidden="true"><span /></div>
            <div className="pdf-trim-controls">
              <label><span><span>Start</span><strong>{fmtTime(trimStartMs)}</strong></span>
                <input type="range" min={0} max={Math.max(0, Math.min(durationMs - 500, trimEndMs - 500))} step={250} value={trimStartMs}
                  onChange={(event) => { const value = Math.min(Number(event.target.value), trimEndMs - 500); setTrimStartMs(value); seek(value); }} aria-label="Trim start" />
              </label>
              <label><span><span>End</span><strong>{fmtTime(trimEndMs)}</strong></span>
                <input type="range" min={Math.min(durationMs, trimStartMs + 500)} max={durationMs} step={250} value={trimEndMs}
                  onChange={(event) => { const value = Math.max(Number(event.target.value), trimStartMs + 500); setTrimEndMs(value); seek(value); }} aria-label="Trim end" />
              </label>
            </div>
            <div className="pdf-trim-actions">
              <span>Selected length: {fmtTime(Math.max(0, trimEndMs - trimStartMs))}</span>
              <button onClick={() => void applyTrim()} disabled={!trimChanged || trimming || durationMs < 500}>
                {trimming ? 'Trimming…' : 'Apply trim'}
              </button>
            </div>
            {trimSaved && <p role="status" className="pdf-success">Trimmed recording saved to your library.</p>}
            {trimError && <p role="alert" className="pdf-trim-error">{trimError}</p>}
          </section>
        </div>

        <aside className="pdf-video-side">
          <h1>Review recording</h1>
          <label className="pdf-title-label">Title
            <input key={meta.id} className="pdf-video-title" defaultValue={meta.title} maxLength={120}
              onBlur={(event) => commitTitle(event.currentTarget)}
              onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }} />
          </label>
          <p className="pdf-video-details">{fmtTime(durationMs)} · {fmtDate(meta.createdAt)} · {fmtSize(meta.size)}</p>
          <button className="pdf-save-button" onClick={onBack}>Save to library</button>
          <button onClick={() => void downloadAs('webm')} disabled={downloading !== null}>
            {downloading === 'webm' ? 'Preparing WebM…' : 'Download WebM'}
          </button>
          <button onClick={() => void downloadAs('mp4')} disabled={downloading !== null || !canRecordMp4()} title={!canRecordMp4() ? 'MP4 encoding is not supported by this browser.' : undefined}>
            {downloading === 'mp4' ? 'Preparing MP4…' : 'Download MP4'}
          </button>
          {downloadError && <p role="alert" className="pdf-trim-error">{downloadError}</p>}
          <button className="pdf-discard-button" onClick={onDelete}>Discard recording</button>
        </aside>
      </div>
    </section>
  );
}
