import { useEffect, useState } from 'react';
import { getVideo, type RecordingMeta } from '../lib/db';
import { downloadRecording } from '../lib/download';
import { fmtDate, fmtSize, fmtTime } from '../lib/format';

interface Props {
  meta: RecordingMeta;
  onBack: () => void;
  onRename: (title: string) => void;
  onDelete: () => void;
}

export default function VideoPage({ meta, onBack, onRename, onDelete }: Props) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let url: string | null = null;
    let cancelled = false;
    void getVideo(meta.id).then((blob) => {
      if (cancelled || !blob) return;
      url = URL.createObjectURL(blob);
      setSrc(url);
    });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [meta.id]);

  const commit = (el: HTMLInputElement) => {
    const v = el.value.trim();
    if (!v) el.value = meta.title;
    else if (v !== meta.title) onRename(v);
  };

  return (
    <div className="mx-auto max-w-4xl">
      <button onClick={onBack} className="text-sm font-semibold text-brand hover:underline">← Back to library</button>
      <div className="mt-4 aspect-video overflow-hidden rounded-xl bg-black">
        {src && <video src={src} controls className="size-full" />}
      </div>
      <label className="mt-5 block">
        <span className="sr-only">Title</span>
        <input
          key={meta.id} defaultValue={meta.title} maxLength={120}
          onBlur={(e) => commit(e.currentTarget)}
          onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
          className="w-full rounded-lg border border-transparent px-2 py-1 text-2xl font-bold hover:border-line focus:border-brand"
        />
      </label>
      <p className="px-2 text-muted">{fmtTime(meta.durationMs)} · {fmtDate(meta.createdAt)} · {fmtSize(meta.size)}</p>
      <div className="mt-4 flex gap-3 px-2">
        <button onClick={() => void downloadRecording(meta)} className="rounded-lg bg-brand px-4 py-2.5 font-semibold text-white hover:bg-brand-dark">Download</button>
        <button onClick={onDelete} className="rounded-lg border border-line px-4 py-2.5 font-semibold text-rec hover:bg-red-50">Delete</button>
      </div>
    </div>
  );
}