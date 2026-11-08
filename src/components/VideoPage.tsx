import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { addRecordingComment, addTranscriptCue, deleteTranscriptCue, getVideo, replaceRecordingVideo, setRecordingEmojiReaction, type RecordingComment, type RecordingMeta } from '../lib/db';
import { fmtDate, fmtSize, fmtTime } from '../lib/format';
import { stitchVideoSegments, trimVideo } from '../lib/media';
import { canRecordMp4 } from '../lib/support';
import { generateCloudAiAssistance, generateCloudMeetingRecap, replaceCloudRecordingVideo, transcribeCloudRecordingChunk } from '../lib/recordingsApi';
import { transcribeMediaAudio } from '../lib/transcription';

interface Props {
  meta: RecordingMeta;
  onBack: () => void;
  onRename: (title: string) => void;
  onDelete: () => void;
  onTrimmed: (meta: RecordingMeta) => void | Promise<void>;
  canTrim: boolean;
  canDownload: boolean;
  canEmbed: boolean;
  onUpgrade: () => void;
  isWatchLater: boolean;
  onToggleWatchLater: () => void;
  onInteractionUpdated: (meta: RecordingMeta) => void;
  onCloudComment?: (text: string) => Promise<RecordingComment | null>;
  onCloudReaction?: (emoji: string, active: boolean) => Promise<Pick<RecordingMeta, 'reactions' | 'myReactions' | 'reactionCount' | 'reacted'> | null>;
  onCloudAddTranscript?: (startMs: number, text: string) => Promise<NonNullable<RecordingMeta['transcript']>[number] | null>;
  onCloudDeleteTranscript?: (cueId: string) => Promise<void>;
  canGenerateAi: boolean;
  onCaptureScreenshot: (blob: Blob, preview: string) => void;
  videoSrc?: string;
  onDownload?: () => void;
  canShare?: boolean;
  cloudBackupBusy?: boolean;
  onRetryCloudBackup?: () => void;
  onShare?: () => Promise<string>;
  onShareSlack?: (shareUrl: string) => Promise<void>;
  onRevokeShare?: () => Promise<void>;
  onTransferOwnership?: (memberId: string) => Promise<void>;
}

interface TransferMember { id: string; name?: string; email: string; role: string; status: string }

function transcriptAsVtt(transcript: NonNullable<RecordingMeta['transcript']>) {
  const stamp = (milliseconds: number) => {
    const total = Math.max(0, Math.round(milliseconds));
    const hours = String(Math.floor(total / 3_600_000)).padStart(2, '0');
    const minutes = String(Math.floor((total % 3_600_000) / 60_000)).padStart(2, '0');
    const seconds = String(Math.floor((total % 60_000) / 1000)).padStart(2, '0');
    const millis = String(total % 1000).padStart(3, '0');
    return `${hours}:${minutes}:${seconds}.${millis}`;
  };
  const cues = [...transcript].sort((a, b) => a.startMs - b.startMs);
  return ['WEBVTT', '', ...cues.flatMap((cue, index) => {
    const endMs = Math.max(cue.startMs + 1500, cues[index + 1]?.startMs ?? cue.startMs + 5000);
    return [`${index + 1}`, `${stamp(cue.startMs)} --> ${stamp(endMs)}`, cue.text.replace(/[\r\n]+/g, ' '), ''];
  })].join('\n');
}

function remapTranscriptForClips(transcript: NonNullable<RecordingMeta['transcript']>, clips: { startMs: number; endMs: number }[]) {
  let offset = 0;
  const remapped = [];
  for (const clip of [...clips].sort((a, b) => a.startMs - b.startMs)) {
    for (const cue of transcript) {
      if (cue.startMs >= clip.startMs && cue.startMs < clip.endMs) remapped.push({ ...cue, startMs: offset + cue.startMs - clip.startMs });
    }
    offset += clip.endMs - clip.startMs;
  }
  return remapped.sort((a, b) => a.startMs - b.startMs);
}

export default function VideoPage({ meta, onBack, onRename, onDelete, onTrimmed, canTrim, canDownload, canEmbed, onUpgrade, isWatchLater, onToggleWatchLater, onInteractionUpdated, onCloudComment, onCloudReaction, onCloudAddTranscript, onCloudDeleteTranscript, canGenerateAi, onCaptureScreenshot, videoSrc, onDownload, canShare, cloudBackupBusy, onRetryCloudBackup, onShare, onRevokeShare, onTransferOwnership, onShareSlack }: Props) {
  const [src, setSrc] = useState<string | null>(null);
  const [videoLoadError, setVideoLoadError] = useState<string | null>(null);
  const [durationMs, setDurationMs] = useState(meta.durationMs);
  const [trimStartMs, setTrimStartMs] = useState(0);
  const [trimEndMs, setTrimEndMs] = useState(meta.durationMs);
  const [trimming, setTrimming] = useState(false);
  const [trimError, setTrimError] = useState<string | null>(null);
  const [trimSaved, setTrimSaved] = useState(false);
  const [editClips, setEditClips] = useState<{ startMs: number; endMs: number }[]>([]);
  const [editStartMs, setEditStartMs] = useState<number | null>(null);
  const [advancedEditing, setAdvancedEditing] = useState(false);
  const [advancedPreview, setAdvancedPreview] = useState<Blob | null>(null);
  const [advancedPreviewUrl, setAdvancedPreviewUrl] = useState<string | null>(null);
  const advancedPreviewUrlRef = useRef<string | null>(null);
  const [savingAdvancedEdit, setSavingAdvancedEdit] = useState(false);
  const [advancedEditError, setAdvancedEditError] = useState<string | null>(null);
  const [advancedEditSaved, setAdvancedEditSaved] = useState(false);
  const [downloading, setDownloading] = useState<'webm' | 'mp4' | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [commentDraft, setCommentDraft] = useState('');
  const [interactionError, setInteractionError] = useState<string | null>(null);
  const [screenshotError, setScreenshotError] = useState<string | null>(null);
  const [shareLink, setShareLink] = useState('');
  const [embedCode, setEmbedCode] = useState('');
  const [shareBusy, setShareBusy] = useState(false);
  const [slackBusy, setSlackBusy] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  const [transferMembers, setTransferMembers] = useState<TransferMember[]>([]);
  const [transferMemberId, setTransferMemberId] = useState('');
  const [transferBusy, setTransferBusy] = useState(false);
  const [transferError, setTransferError] = useState<string | null>(null);
  const [transcriptDraft, setTranscriptDraft] = useState('');
  const [transcriptError, setTranscriptError] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [recapBusy, setRecapBusy] = useState(false);
  const [recapError, setRecapError] = useState<string | null>(null);
  const [transcriptionBusy, setTranscriptionBusy] = useState(false);
  const [transcriptionStatus, setTranscriptionStatus] = useState('');
  const [transcriptionError, setTranscriptionError] = useState<string | null>(null);
  const transcriptionAbortRef = useRef<AbortController | null>(null);
  const transcriptRef = useRef(meta.transcript ?? []);
  const [theaterMode, setTheaterMode] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const captionsUrl = meta.transcript?.length ? `data:text/vtt;charset=utf-8,${encodeURIComponent(transcriptAsVtt(meta.transcript))}` : null;
  const trimChanged = trimStartMs > 0 || trimEndMs < durationMs;

  useEffect(() => {
    transcriptRef.current = meta.transcript ?? [];
  }, [meta.id, meta.transcript]);
  useEffect(() => () => transcriptionAbortRef.current?.abort(), []);
  useEffect(() => () => {
    if (advancedPreviewUrlRef.current) URL.revokeObjectURL(advancedPreviewUrlRef.current);
  }, []);

  const clearAdvancedPreview = () => {
    if (advancedPreviewUrlRef.current) URL.revokeObjectURL(advancedPreviewUrlRef.current);
    advancedPreviewUrlRef.current = null;
    setAdvancedPreview(null);
    setAdvancedPreviewUrl(null);
  };

  useEffect(() => {
    if (videoSrc) return undefined;
    let url: string | null = null;
    let cancelled = false;
    void getVideo(meta.id).then((blob) => {
      if (!cancelled && blob) {
        url = URL.createObjectURL(blob);
        setSrc(url);
        setVideoLoadError(null);
      } else if (!cancelled) {
        setVideoLoadError('The recording file is not available in this browser’s storage. If it was backed up, return to the Library and open its cloud copy.');
      }
    }).catch(() => { if (!cancelled) setVideoLoadError('Could not load this recording from browser storage. Try returning to the Library and opening it again.'); });
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  }, [meta.id, meta.size, videoSrc]);

  useEffect(() => {
    if (!onTransferOwnership) return undefined;
    let cancelled = false;
    void Promise.all([
      fetch('/api/v1/workspace/members', { credentials: 'same-origin' }),
      fetch('/api/v1/auth/me', { credentials: 'same-origin' }),
    ]).then(async ([membersResponse, userResponse]) => {
      const membersPayload = await membersResponse.json() as { members?: TransferMember[]; error?: { message?: string } };
      const userPayload = await userResponse.json() as { user?: { id?: string } };
      if (!membersResponse.ok) throw new Error(membersPayload.error?.message || 'Could not load workspace members.');
      return { members: membersPayload.members ?? [], currentUserId: userPayload.user?.id };
    }).then(({ members, currentUserId }) => {
      if (!cancelled) setTransferMembers(members.filter((member) => member.status === 'Active' && member.id !== currentUserId));
    }).catch((error: unknown) => { if (!cancelled) setTransferError(error instanceof Error ? error.message : 'Could not load workspace members.'); });
    return () => { cancelled = true; };
  }, [meta.id, canShare, onTransferOwnership]);

  const applyTrim = async () => {
    if (!trimChanged || trimming) return;
    setTrimming(true); setTrimError(null); setTrimSaved(false);
    try {
      const original = meta.isCloud
        ? videoSrc ? await fetch(videoSrc).then(async (response) => {
          if (!response.ok) throw new Error('Could not download the cloud recording for trimming.');
          return response.blob();
        }) : null
        : await getVideo(meta.id);
      if (!original) throw new Error('The original video is missing from this browser.');
      const clipped = await trimVideo(original, trimStartMs, trimEndMs);
      const transcript = remapTranscriptForClips(meta.transcript ?? [], [{ startMs: trimStartMs, endMs: trimEndMs }]);
      const updated = meta.isCloud
        ? await replaceCloudRecordingVideo(meta.id, clipped, trimEndMs - trimStartMs, clipped.type || meta.mimeType, transcript)
        : await replaceRecordingVideo(meta.id, clipped, trimEndMs - trimStartMs, clipped.type || meta.mimeType, transcript);
      await onTrimmed(updated);
      setDurationMs(updated.durationMs); setTrimStartMs(0); setTrimEndMs(updated.durationMs); setTrimSaved(true);
    } catch (error) {
      setTrimError(error instanceof Error ? error.message : 'Could not trim this video.');
    } finally { setTrimming(false); }
  };

  const markEditPoint = () => {
    if (advancedPreview) return;
    const playheadMs = Math.round((videoRef.current?.currentTime ?? 0) * 1000);
    if (editStartMs === null) {
      if (playheadMs >= durationMs) { setAdvancedEditError('Move the playhead before the end of the video to mark a clip start.'); return; }
      setEditStartMs(playheadMs);
      setAdvancedEditError(null);
      return;
    }
    if (playheadMs - editStartMs < 500) { setAdvancedEditError('Move at least half a second forward to mark the clip end.'); return; }
    if (editClips.length >= 20) { setAdvancedEditError('An edit can contain up to 20 clips.'); return; }
    if (editClips.some((clip) => editStartMs < clip.endMs && playheadMs > clip.startMs)) { setAdvancedEditError('Kept clips cannot overlap. Remove or adjust the existing clip first.'); return; }
    setEditClips((clips) => [...clips, { startMs: editStartMs, endMs: playheadMs }].sort((a, b) => a.startMs - b.startMs));
    setEditStartMs(null);
    setAdvancedEditError(null);
    setAdvancedEditSaved(false);
  };

  const createAdvancedPreview = async () => {
    if (!canGenerateAi || !editClips.length || advancedEditing) return;
    setAdvancedEditing(true);
    setAdvancedEditError(null);
    setAdvancedEditSaved(false);
    try {
      const original = meta.isCloud
        ? videoSrc ? await fetch(videoSrc).then(async (response) => {
          if (!response.ok) throw new Error('Could not load the cloud recording for editing.');
          return response.blob();
        }) : null
        : await getVideo(meta.id);
      if (!original) throw new Error('The original recording is not available in this browser.');
      const edited = await stitchVideoSegments(original, editClips);
      if (advancedPreviewUrlRef.current) URL.revokeObjectURL(advancedPreviewUrlRef.current);
      const previewUrl = URL.createObjectURL(edited);
      advancedPreviewUrlRef.current = previewUrl;
      setAdvancedPreviewUrl(previewUrl);
      setAdvancedPreview(edited);
    } catch (error) {
      setAdvancedEditError(error instanceof Error ? error.message : 'Could not create an edit preview.');
    } finally { setAdvancedEditing(false); }
  };

  const saveAdvancedEdit = async () => {
    if (!canGenerateAi || !advancedPreview || savingAdvancedEdit) return;
    if (!window.confirm('Save this preview as the new recording? This replaces the current video.')) return;
    setSavingAdvancedEdit(true);
    setAdvancedEditError(null);
    setAdvancedEditSaved(false);
    try {
      const editedDuration = editClips.reduce((total, clip) => total + clip.endMs - clip.startMs, 0);
      const transcript = remapTranscriptForClips(meta.transcript ?? [], editClips);
      const updated = meta.isCloud
        ? await replaceCloudRecordingVideo(meta.id, advancedPreview, editedDuration, advancedPreview.type || meta.mimeType, transcript, true)
        : await replaceRecordingVideo(meta.id, advancedPreview, editedDuration, advancedPreview.type || meta.mimeType, transcript);
      await onTrimmed(updated);
      setDurationMs(updated.durationMs);
      setTrimStartMs(0);
      setTrimEndMs(updated.durationMs);
      setEditClips([]);
      setEditStartMs(null);
      clearAdvancedPreview();
      setAdvancedEditSaved(true);
    } catch (error) {
      setAdvancedEditError(error instanceof Error ? error.message : 'Could not save the edited recording.');
    } finally { setSavingAdvancedEdit(false); }
  };

  const downloadAs = async (format: 'webm' | 'mp4') => {
    if (!canDownload) {
      onUpgrade();
      return;
    }
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
  const toggleReaction = useCallback(async (emoji: string) => {
    try {
      const active = !(meta.myReactions ?? (meta.reacted ? ['👍'] : [])).includes(emoji);
      if (meta.isCloud || meta.cloudId) {
        const updated = await onCloudReaction?.(emoji, active);
        if (!updated) throw new Error('Could not save your reaction.');
        onInteractionUpdated({ ...meta, ...updated });
      } else {
        onInteractionUpdated(await setRecordingEmojiReaction(meta.id, emoji, active));
      }
      setInteractionError(null);
    } catch (error) { setInteractionError(error instanceof Error ? error.message : 'Could not save your reaction.'); }
  }, [meta, onCloudReaction, onInteractionUpdated]);
  const addComment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = commentDraft.trim();
    if (!text) return;
    try {
      if (meta.isCloud || meta.cloudId) {
        const comment = await onCloudComment?.(text);
        if (!comment) throw new Error('Could not save your comment.');
        onInteractionUpdated({ ...meta, comments: [...(meta.comments ?? []), comment] });
      } else {
        onInteractionUpdated(await addRecordingComment(meta.id, text));
      }
      setCommentDraft('');
      setInteractionError(null);
    } catch (error) { setInteractionError(error instanceof Error ? error.message : 'Could not save your comment.'); }
  };
  const addTranscript = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = transcriptDraft.trim();
    if (!text) return;
    const video = document.querySelector<HTMLVideoElement>('.pdf-video-preview video');
    try {
      const startMs = (video?.currentTime ?? 0) * 1000;
      if (meta.isCloud || meta.cloudId) {
        const cue = await onCloudAddTranscript?.(startMs, text);
        if (!cue) throw new Error('Could not save this transcript cue.');
        onInteractionUpdated({ ...meta, transcript: [...(meta.transcript ?? []), cue].sort((a, b) => a.startMs - b.startMs) });
      } else {
        onInteractionUpdated(await addTranscriptCue(meta.id, startMs, text));
      }
      setTranscriptDraft('');
      setTranscriptError(null);
    } catch (error) { setTranscriptError(error instanceof Error ? error.message : 'Could not save this transcript cue.'); }
  };
  const generateAiAssistance = async () => {
    if (!canGenerateAi || !(meta.isCloud || meta.cloudId) || aiBusy) return;
    setAiBusy(true);
    setAiError(null);
    try {
      const generated = await generateCloudAiAssistance(meta.isCloud ? meta.id : meta.cloudId!);
      onInteractionUpdated({ ...meta, ...generated });
    } catch (error) {
      setAiError(error instanceof Error ? error.message : 'Could not generate AI notes.');
    } finally { setAiBusy(false); }
  };
  const generateMeetingRecap = async () => {
    const cloudId = meta.isCloud ? meta.id : meta.cloudId;
    if (!canGenerateAi || !cloudId || meta.source !== 'meeting' || recapBusy) return;
    setRecapBusy(true);
    setRecapError(null);
    try {
      const meetingRecap = await generateCloudMeetingRecap(cloudId);
      onInteractionUpdated({ ...meta, meetingRecap });
    } catch (error) {
      setRecapError(error instanceof Error ? error.message : 'Could not generate the meeting recap.');
    } finally { setRecapBusy(false); }
  };
  const generateTranscript = async () => {
    const cloudId = meta.isCloud ? meta.id : meta.cloudId;
    if (!canGenerateAi || !cloudId || transcriptionBusy || transcriptRef.current.length) return;
    const controller = new AbortController();
    transcriptionAbortRef.current = controller;
    setTranscriptionBusy(true);
    setTranscriptionStatus('Preparing audio…');
    setTranscriptionError(null);
    try {
      const sourceUrl = videoRef.current?.currentSrc || videoSrc || src;
      if (!sourceUrl) throw new Error('The recording is not ready for transcription yet.');
      let latestTranscript = transcriptRef.current;
      await transcribeMediaAudio(sourceUrl, controller.signal, async (audio, startMs, segmentDurationMs) => {
        const cues = await transcribeCloudRecordingChunk(cloudId, audio, startMs, segmentDurationMs, controller.signal);
        latestTranscript = [...latestTranscript, ...cues].sort((a, b) => a.startMs - b.startMs);
        transcriptRef.current = latestTranscript;
        onInteractionUpdated({ ...meta, transcript: latestTranscript });
      }, ({ segment }) => setTranscriptionStatus(`Transcribing audio segment ${segment}…`));
      setTranscriptionStatus(transcriptRef.current.length ? 'Transcript saved to this recording.' : 'No speech was detected in this recording.');
    } catch (error) {
      if (controller.signal.aborted) setTranscriptionStatus('Transcription cancelled.');
      else setTranscriptionError(error instanceof Error ? error.message : 'Could not transcribe this recording.');
    } finally {
      if (transcriptionAbortRef.current === controller) transcriptionAbortRef.current = null;
      setTranscriptionBusy(false);
    }
  };
  const removeTranscript = async (cueId: string) => {
    try {
      if (meta.isCloud || meta.cloudId) {
        await onCloudDeleteTranscript?.(cueId);
        onInteractionUpdated({ ...meta, transcript: (meta.transcript ?? []).filter((cue) => cue.id !== cueId) });
      } else onInteractionUpdated(await deleteTranscriptCue(meta.id, cueId));
    }
    catch (error) { setTranscriptError(error instanceof Error ? error.message : 'Could not remove this transcript cue.'); }
  };

  const transferOwnership = async () => {
    if (!onTransferOwnership || !transferMemberId || transferBusy) return;
    const member = transferMembers.find((entry) => entry.id === transferMemberId);
    if (!member || !window.confirm(`Transfer “${meta.title}” to ${member.name || member.email}? They will become its owner and control its settings.`)) return;
    setTransferBusy(true); setTransferError(null);
    try { await onTransferOwnership(member.id); }
    catch (error) { setTransferError(error instanceof Error ? error.message : 'Could not transfer recording ownership.'); }
    finally { setTransferBusy(false); }
  };
  const sendToSlack = async () => {
    if (!onShare || !onShareSlack || slackBusy) return;
    setSlackBusy(true); setShareError(null);
    try {
      const url = shareLink || await onShare();
      setShareLink(url);
      await onShareSlack(url);
      setShareError('Recording shared to Slack.');
    } catch (error) {
      setShareError(error instanceof Error ? error.message : 'Could not share this recording to Slack.');
    } finally { setSlackBusy(false); }
  };
  const copyEmbedCode = async () => {
    if (!canEmbed) {
      onUpgrade();
      return;
    }
    if (!onShare || shareBusy) return;
    setShareBusy(true); setShareError(null);
    try {
      const url = shareLink || await onShare();
      setShareLink(url);
      const embedUrl = new URL(url);
      embedUrl.searchParams.set('embed', '1');
      const title = meta.title.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
      const code = `<iframe src="${embedUrl.toString()}" title="${title}" width="640" height="360" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen loading="lazy"></iframe>`;
      setEmbedCode(code);
      try { await navigator.clipboard.writeText(code); setShareError('Embed code copied.'); }
      catch { setShareError('Copy the embed code from the field below.'); }
    } catch (error) { setShareError(error instanceof Error ? error.message : 'Could not create embed code.'); }
    finally { setShareBusy(false); }
  };
  const seekToCue = (timeMs: number) => {
    const video = document.querySelector<HTMLVideoElement>('.pdf-video-preview video');
    if (video) { video.currentTime = timeMs / 1000; void video.play(); }
  };
  const captureScreenshot = () => {
    const video = document.querySelector<HTMLVideoElement>('.pdf-video-preview video');
    if (!video || !video.videoWidth || !video.videoHeight) {
      setScreenshotError('Play or pause the video on a frame first, then try again.');
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext('2d');
    if (!context) { setScreenshotError('Could not capture this frame.'); return; }
    try {
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const preview = canvas.toDataURL('image/jpeg', 0.82);
      canvas.toBlob((blob) => {
        if (!blob) { setScreenshotError('Could not save this frame.'); return; }
        onCaptureScreenshot(blob, preview);
        setScreenshotError(null);
      }, 'image/jpeg', 0.88);
    } catch {
      setScreenshotError('This frame could not be captured by the browser.');
    }
  };
  const seek = (value: number) => {
    const video = document.querySelector<HTMLVideoElement>('.pdf-video-preview video');
    if (video) video.currentTime = value / 1000;
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (localStorage.getItem('clientorahq-keyboard-shortcuts-enabled') === 'false') return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(target.tagName))) return;
      const video = videoRef.current;
      if (!video) return;
      const key = event.key.toLocaleLowerCase();
      if (key === 'c') {
        event.preventDefault();
        document.getElementById('recording-comment')?.focus();
      } else if (/^[1-6]$/.test(key)) {
        event.preventDefault();
        const emojis = ['👍', '❤️', '😄', '🎉', '👀', '👏'];
        void toggleReaction(emojis[Number(key) - 1]);
      } else if (key === 'k') {
        event.preventDefault();
        if (video.paused) void video.play().catch(() => undefined);
        else video.pause();
      } else if (key === 'j' || key === 'l') {
        event.preventDefault();
        video.currentTime = Math.max(0, Math.min(video.duration || durationMs / 1000, video.currentTime + (key === 'j' ? -5 : 5)));
      } else if (key === 'm') {
        event.preventDefault();
        video.muted = !video.muted;
      } else if (key === 'a') {
        event.preventDefault();
        const captions = Array.from(video.textTracks).find((track) => track.kind === 'captions' || track.kind === 'subtitles');
        if (captions) captions.mode = captions.mode === 'showing' ? 'hidden' : 'showing';
      } else if (key === 's') {
        event.preventDefault();
        const speeds = [1, 1.2, 1.5, 1.7, 2];
        video.playbackRate = speeds[(speeds.indexOf(video.playbackRate) + 1) % speeds.length];
      } else if (key === 't') {
        event.preventDefault();
        setTheaterMode((current) => !current);
      } else if (key === 'p' && document.pictureInPictureEnabled && !document.pictureInPictureElement) {
        event.preventDefault();
        void video.requestPictureInPicture().catch(() => undefined);
      } else if (key === 'f') {
        event.preventDefault();
        if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
        else void video.requestFullscreen().catch(() => undefined);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [durationMs, toggleReaction]);

  return (
    <section className={`pdf-video-page${theaterMode ? ' is-theater' : ''}`} aria-label="Review recording">
      <button onClick={onBack} className="pdf-back-button"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>Back to library</button>
      <div className="pdf-video-layout">
        <div className="pdf-video-main">
          <div className="pdf-video-preview">
            {videoLoadError ? <p role="alert" className="pdf-trim-error">{videoLoadError}</p> : (advancedPreviewUrl ?? videoSrc ?? src) ? <video ref={videoRef} src={advancedPreviewUrl ?? videoSrc ?? src ?? undefined} crossOrigin={videoSrc && !advancedPreviewUrl ? 'anonymous' : undefined} controls onLoadedMetadata={(event) => {
              const measured = Number.isFinite(event.currentTarget.duration) ? Math.round(event.currentTarget.duration * 1000) : 0;
              if (!durationMs && measured) { setDurationMs(measured); setTrimEndMs(measured); }
            }} onError={() => setVideoLoadError('We couldn’t play this video. Make sure it’s still available, then reopen it from your Library.')}>{captionsUrl && <track kind="captions" srcLang="en" label="English captions" src={captionsUrl} default />}</video> : <p role="status">Loading recording…</p>}
          </div>
          {!canTrim ? <section className="pdf-trim-section"><h2>Trim your recording</h2><p>Cut the start and end of any video. Trimming is available on Business and Business + AI.</p><button onClick={onUpgrade}>See plans</button></section> : meta.isCloud && !meta.canManage ? <section className="pdf-trim-section"><h2>Trimming is owner-only</h2><p>Only the owner of this workspace recording can trim it.</p></section> : <section className="pdf-trim-section" aria-labelledby="trim-title">
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
          </section>}
          {canGenerateAi && <section className="pdf-trim-section advanced-edit-section" aria-labelledby="advanced-edit-title">
            <div className="advanced-edit-heading"><div><h2 id="advanced-edit-title">Advanced editing</h2><p>Business + AI</p></div><span>Multi-clip</span></div>
            <p>Move the playhead, mark where each clip starts and ends, then combine the clips you want to keep into a single cut.</p>
            <div className="advanced-edit-actions">
              <button onClick={markEditPoint} disabled={Boolean(advancedPreviewUrl) || advancedEditing || savingAdvancedEdit}>{editStartMs === null ? 'Mark clip start' : 'Mark clip end'}</button>
              <button onClick={() => { setEditClips([]); setEditStartMs(null); clearAdvancedPreview(); setAdvancedEditError(null); setAdvancedEditSaved(false); }} disabled={(!editClips.length && editStartMs === null && !advancedPreview) || savingAdvancedEdit}>Clear clips</button>
            </div>
            {editStartMs !== null && <p role="status">Clip starts at {fmtTime(editStartMs)}. Move the playhead forward, then mark where it ends.</p>}
            {editClips.length > 0 && <><ol className="advanced-edit-clips">{editClips.map((clip, index) => <li key={`${clip.startMs}-${clip.endMs}`}><button onClick={() => seek(clip.startMs)}>{fmtTime(clip.startMs)} – {fmtTime(clip.endMs)}</button><span>{fmtTime(clip.endMs - clip.startMs)}</span><button aria-label={`Remove clip ${index + 1}`} onClick={() => setEditClips((clips) => clips.filter((_, clipIndex) => clipIndex !== index))}>Remove</button></li>)}</ol><p>Kept footage: {fmtTime(editClips.reduce((total, clip) => total + clip.endMs - clip.startMs, 0))}</p></>}
            <div className="advanced-edit-actions"><button onClick={() => void createAdvancedPreview()} disabled={!editClips.length || advancedEditing || Boolean(advancedPreview)}>{advancedEditing ? 'Creating preview…' : 'Create edit preview'}</button>{advancedPreview && <button onClick={clearAdvancedPreview} disabled={savingAdvancedEdit}>Discard preview</button>}</div>
            {advancedPreview && <><p role="status">Preview the combined clips in the player above. Saving replaces the original recording.</p><button onClick={() => void saveAdvancedEdit()} disabled={savingAdvancedEdit}>{savingAdvancedEdit ? 'Saving edited recording…' : 'Save edited recording'}</button></>}
            {advancedEditSaved && <p role="status" className="pdf-success">Edited recording saved to your library.</p>}
            {advancedEditError && <p role="alert" className="pdf-trim-error">{advancedEditError}</p>}
          </section>}
        </div>

        <aside className="pdf-video-side recording-details-panel">
          <h1>Recording details</h1>
          <label className="pdf-title-label">Title
            <input key={meta.id} className="pdf-video-title" defaultValue={meta.title} maxLength={120}
              onBlur={(event) => commitTitle(event.currentTarget)}
              onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }} />
          </label>
          <p className="pdf-video-details">{fmtTime(durationMs)} · {fmtDate(meta.createdAt)} · {fmtSize(meta.size)}</p>
          {canGenerateAi && <section className="recording-share-tools ai-recording-tools"><span className="ai-plan-pill">Business + AI</span><h2>AI title, summary & transcript</h2><p>Generate a transcript, then create a title and summary in the recording’s main language.</p>{!meta.transcript?.length && <button className="ai-primary-action" onClick={() => void generateTranscript()} disabled={transcriptionBusy}>{transcriptionBusy ? transcriptionStatus || 'Transcribing…' : 'Generate transcript'}</button>}{transcriptionBusy && <button onClick={() => transcriptionAbortRef.current?.abort()}>Cancel</button>}{transcriptionStatus && <p role="status">{transcriptionStatus}</p>}{transcriptionError && <p role="alert" className="pdf-trim-error">{transcriptionError}</p>}{meta.transcript?.length ? <button className="ai-primary-action" onClick={() => void generateAiAssistance()} disabled={aiBusy || transcriptionBusy}>{aiBusy ? 'Generating…' : 'Generate AI title and summary'}</button> : <p className="ai-action-hint">Add a transcript to generate notes.</p>}{meta.summary && <p className="ai-recording-summary"><strong>Summary</strong><br />{meta.summary}</p>}{aiError && <p role="alert" className="pdf-trim-error">{aiError}</p>}{meta.source === 'meeting' && <div className="meeting-recap"><h3>AI meeting recap</h3><p>Get key points, decisions, and action items in the transcript’s main language.</p><button className="ai-primary-action" onClick={() => void generateMeetingRecap()} disabled={recapBusy || !meta.transcript?.length}>{recapBusy ? 'Creating recap…' : meta.meetingRecap ? 'Regenerate meeting recap' : meta.transcript?.length ? 'Generate meeting recap' : 'Add a transcript first'}</button>{recapError && <p role="alert" className="pdf-trim-error">{recapError}</p>}{meta.meetingRecap && <div className="meeting-recap-content"><h4>Summary</h4><p>{meta.meetingRecap.summary}</p><h4>Key points</h4>{meta.meetingRecap.keyPoints.length ? <ul>{meta.meetingRecap.keyPoints.map((point, index) => <li key={index}>{point}</li>)}</ul> : <p>No key points identified.</p>}<h4>Decisions</h4>{meta.meetingRecap.decisions.length ? <ul>{meta.meetingRecap.decisions.map((decision, index) => <li key={index}>{decision}</li>)}</ul> : <p>No decisions identified.</p>}<h4>Action items</h4>{meta.meetingRecap.actionItems.length ? <ul>{meta.meetingRecap.actionItems.map((action, index) => <li key={index}><strong>{action.task}</strong>{action.owner && <span> · {action.owner}</span>}{action.dueDate && <small> · Due {action.dueDate}</small>}</li>)}</ul> : <p>No action items identified.</p>}</div>}</div>}</section>}
          <button onClick={onToggleWatchLater}>{isWatchLater ? '✓ Saved to Watch later' : '+ Watch later'}</button>
          <button onClick={captureScreenshot}>Capture screenshot</button>
          {screenshotError && <p role="alert" className="pdf-trim-error">{screenshotError}</p>}
          {canShare && onShare && onRevokeShare && <section className="recording-share-tools"><h2>Share this recording</h2><button disabled={shareBusy} onClick={() => {
            setShareBusy(true); setShareError(null);
            void onShare().then(async (url) => {
              setShareLink(url);
              try { await navigator.clipboard.writeText(url); }
              catch { setShareError('Copy the link from the field below.'); }
            }).catch((error: unknown) => setShareError(error instanceof Error ? error.message : 'Could not create a share link.')).finally(() => setShareBusy(false));
          }}>{shareBusy ? 'Creating link…' : 'Copy share link'}</button><button disabled={shareBusy} onClick={() => {
            setShareBusy(true); setShareError(null);
            void onRevokeShare().then(() => { setShareLink(''); setEmbedCode(''); setShareError('Share link disabled.'); }).catch((error: unknown) => setShareError(error instanceof Error ? error.message : 'Could not revoke the share link.')).finally(() => setShareBusy(false));
          }}>Disable share link</button><button disabled={shareBusy} onClick={() => void copyEmbedCode()}>{!canEmbed ? 'Unlock embed code' : shareBusy ? 'Preparing…' : 'Copy embed code'}</button>{onShareSlack && <button disabled={slackBusy} onClick={() => void sendToSlack()}>{slackBusy ? 'Sending to Slack…' : 'Share to Slack'}</button>}{shareLink && <label><span className="sr-only">Share link</span><input readOnly value={shareLink} onFocus={(event) => event.currentTarget.select()} /></label>}{embedCode && <label><span>Embed code</span><textarea readOnly value={embedCode} onFocus={(event) => event.currentTarget.select()} /></label>}{shareError && <p role="status">{shareError}</p>}</section>}
          {!canShare && !meta.isCloud && !meta.cloudId && <section className="recording-share-tools"><h2>Share this recording</h2><p>This recording is saved on this device. Back it up to workspace storage to create a share link or embed.</p>{onRetryCloudBackup ? <button disabled={cloudBackupBusy} onClick={onRetryCloudBackup}>{cloudBackupBusy ? 'Saving to workspace…' : 'Back up to workspace and enable sharing'}</button> : <p>Workspace sharing is available after hosted storage is configured and this recording is backed up.</p>}</section>}
          {onTransferOwnership && <section className="recording-share-tools"><h2>Transfer ownership</h2><p>Give another active workspace member control of this cloud recording.</p><label><span className="sr-only">Choose a new owner</span><select value={transferMemberId} onChange={(event) => setTransferMemberId(event.currentTarget.value)} disabled={transferBusy || transferMembers.length === 0}><option value="">{transferMembers.length ? 'Choose a workspace member' : 'No other active members'}</option>{transferMembers.map((member) => <option key={member.id} value={member.id}>{member.name || member.email.split('@')[0]} · {member.email}</option>)}</select></label><button onClick={() => void transferOwnership()} disabled={!transferMemberId || transferBusy}>{transferBusy ? 'Transferring…' : 'Transfer recording'}</button>{transferError && <p role="alert" className="pdf-trim-error">{transferError}</p>}</section>}
          <section className="starter-engagement" aria-labelledby="engagement-title">
            <h2 id="engagement-title">Reactions and comments</h2>
            <div className="starter-reaction-picker" role="group" aria-label="Add a reaction">{['👍', '❤️', '😄', '🎉', '👀', '👏'].map((emoji) => { const reacted = (meta.myReactions ?? (meta.reacted ? ['👍'] : [])).includes(emoji); return <button key={emoji} className={reacted ? 'is-reacted' : ''} onClick={() => void toggleReaction(emoji)} aria-pressed={reacted} aria-label={`React with ${emoji}`}>{emoji} <span>{meta.reactions?.[emoji] ?? (emoji === '👍' ? meta.reactionCount ?? 0 : 0)}</span></button>; })}</div>
            <form onSubmit={(event) => void addComment(event)}><label className="sr-only" htmlFor="recording-comment">Add a comment</label><textarea id="recording-comment" maxLength={1000} placeholder="Write a comment…" value={commentDraft} onChange={(event) => setCommentDraft(event.currentTarget.value)} /><button type="submit" disabled={!commentDraft.trim()}>Post comment</button></form>
            {interactionError && <p role="alert" className="pdf-trim-error">{interactionError}</p>}
            <ul>{(meta.comments ?? []).map((comment) => <li key={comment.id}><strong>{comment.author}</strong><small>{new Date(comment.createdAt).toLocaleString()}</small><p>{comment.text}</p></li>)}</ul>
          </section>
          <section className="starter-transcript" aria-labelledby="transcript-title">
            <h2 id="transcript-title">Transcript and captions</h2>
            <p>Add timestamped lines to caption this recording. Captions are saved with the video and can be turned on from the player’s captions menu.</p>
            <form onSubmit={(event) => void addTranscript(event)}><label className="sr-only" htmlFor="transcript-line">Transcript line</label><textarea id="transcript-line" maxLength={1000} placeholder="Type what is said at this moment…" value={transcriptDraft} onChange={(event) => setTranscriptDraft(event.currentTarget.value)} /><button type="submit" disabled={!transcriptDraft.trim()}>Add at current time</button></form>
            {transcriptError && <p role="alert" className="pdf-trim-error">{transcriptError}</p>}
            {meta.transcript?.length ? <ol>{[...meta.transcript].sort((a, b) => a.startMs - b.startMs).map((cue) => <li key={cue.id}><button onClick={() => seekToCue(cue.startMs)}>{fmtTime(cue.startMs)}</button><span>{cue.text}</span><button aria-label="Delete transcript line" onClick={() => void removeTranscript(cue.id)}>×</button></li>)}</ol> : <p className="transcript-empty">No transcript yet. Add your first line above.</p>}
            {captionsUrl && <a className="transcript-download" href={captionsUrl} download={`${meta.title.replace(/[\\/:*?"<>|]+/g, '-')}.vtt`}>Download captions (.vtt)</a>}
          </section>
          <button className="pdf-save-button" onClick={onBack}>Save to library</button>
          {meta.isCloud ? <button onClick={onDownload}>Download recording</button> : canDownload ? <>
            <button onClick={() => void downloadAs('webm')} disabled={downloading !== null}>
              {downloading === 'webm' ? 'Preparing WebM…' : 'Download WebM'}
            </button>
            <button onClick={() => void downloadAs('mp4')} disabled={downloading !== null || !canRecordMp4()} title={!canRecordMp4() ? 'MP4 encoding is not supported by this browser.' : undefined}>
              {downloading === 'mp4' ? 'Preparing MP4…' : 'Download MP4'}
            </button>
          </> : <button onClick={onUpgrade}>Download recording · Business</button>}
          {downloadError && <p role="alert" className="pdf-trim-error">{downloadError}</p>}
          <button className="pdf-discard-button" onClick={onDelete}>Delete recording</button>
        </aside>
      </div>
    </section>
  );
}
