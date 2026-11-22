import { create } from 'zustand';
import { detectCapabilities } from '../lib/capabilities';
import { analyzeFile } from '../lib/jobs/pipeline';
import { renderQueue, type RenderedClip } from '../lib/jobs/renderQueue';
import { makeProject, saveProject } from '../lib/storage/db';
import { createTrackWorker } from '../lib/workers/client';
import { acquireWakeLock, type WakeLockHandle } from '../lib/wakeLock';
import { isCancelled, toFriendlyError, type FriendlyError } from '../lib/errors';
import type { Capabilities, Clip, FileMeta, Progress, Transcript, Window } from '../types';
import type { TrackWorkerResult } from '../workers/messages';

type State = {
  caps: Capabilities | null;
  file: File | null;
  meta: FileMeta | null;
  objectUrl: string | null;
  transcript: Transcript | null;
  windows: Window[];
  clips: Clip[];
  selectedClipId: string | null;
  selectedClipIds: string[];
  progress: Record<string, Progress>;
  rendered: RenderedClip[];
  isAnalyzing: boolean;
  isRendering: boolean;
  error: FriendlyError | null;
  notice: string | null;
  theme: 'dark' | 'light';
  cachedResult: boolean;
  audioCodec: string | null;

  initialize: () => void;
  setTheme: (theme: 'dark' | 'light') => void;
  setFile: (file: File) => Promise<void>;
  cancelAnalysis: () => void;
  selectClip: (id: string) => void;
  toggleSelected: (id: string) => void;
  updateClip: (id: string, patch: Partial<Clip>) => void;
  updateWord: (clipId: string, wordIndex: number, text: string) => void;
  trackClip: (id: string) => Promise<void>;
  renderSelected: () => Promise<void>;
  cancelRender: () => void;
  /** Write pending debounced project edits immediately (pagehide/beforeunload). */
  flushSaves: () => void;
  /** Warn about hidden active jobs and re-acquire the wake lock on return. */
  handleVisibilityChange: () => void;
  dismissError: () => void;
  dismissNotice: () => void;
};

let analysisController: AbortController | null = null;
let renderController: AbortController | null = null;
let wakeLock: WakeLockHandle | null = null;
const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** Human-readable codec label shared by notices and the file summary. */
export function audioCodecLabel(codec: string | null): string | null {
  if (!codec) return null;
  if (codec === 'opus' || codec.includes('opus')) return 'Opus (Ogg)';
  if (codec === 'aac' || codec.includes('mp4a')) return 'AAC (MP4)';
  return codec;
}

function scheduleSave(get: () => State): void {
  const { meta, clips } = get();
  if (!meta || clips.length === 0) return;
  const key = meta.fileId;
  const existing = saveTimers.get(key);
  if (existing) clearTimeout(existing);
  saveTimers.set(key, setTimeout(() => {
    saveTimers.delete(key);
    void saveProject(makeProject(meta.fileId, meta.name, meta.durationSec, clips)).catch(() => undefined);
  }, 400));
}

export const useAppStore = create<State>((set, get) => ({
  caps: null,
  file: null,
  meta: null,
  objectUrl: null,
  transcript: null,
  windows: [],
  clips: [],
  selectedClipId: null,
  selectedClipIds: [],
  progress: {},
  rendered: [],
  isAnalyzing: false,
  isRendering: false,
  error: null,
  notice: null,
  theme: (() => {
    const saved = typeof localStorage === 'undefined' ? null : localStorage.getItem('snapcut-theme');
    return saved === 'light' ? 'light' : 'dark';
  })(),
  cachedResult: false,
  audioCodec: null,

  initialize: () => {
    const caps = detectCapabilities();
    set({ caps, notice: caps.missing.length > 0 ? `Limited browser support: ${caps.missing.join(', ')}.` : null });
    document.documentElement.classList.toggle('light', get().theme === 'light');
  },

  setTheme: (theme) => {
    localStorage.setItem('snapcut-theme', theme);
    document.documentElement.classList.toggle('light', theme === 'light');
    set({ theme });
  },

  setFile: async (file) => {
    const previousUrl = get().objectUrl;
    if (previousUrl) URL.revokeObjectURL(previousUrl);
    analysisController?.abort();
    const controller = new AbortController();
    analysisController = controller;
    const objectUrl = URL.createObjectURL(file);
    set({
      file,
      objectUrl,
      meta: null,
      transcript: null,
      windows: [],
      clips: [],
      selectedClipId: null,
      selectedClipIds: [],
      progress: {},
      rendered: [],
      isAnalyzing: true,
      error: null,
      notice: null,
      cachedResult: false,
      audioCodec: null,
    });
    wakeLock = await acquireWakeLock();

    try {
      // The pipeline restores a saved project by FileId and skips audio/highlights
      // when cached clips exist; segment results resume a partially finished transcription.
      const result = await analyzeFile(file, {
        isMobile: get().caps?.isMobile ?? false,
        signal: controller.signal,
        onProgress: (progress) => set({ progress: { ...get().progress, analysis: progress } }),
      });
      const clips = result.clips;
      const codecLabel = audioCodecLabel(result.audioCodec);
      set({
        meta: result.meta,
        transcript: result.transcript,
        windows: result.windows,
        clips,
        selectedClipId: clips[0]?.id ?? null,
        selectedClipIds: clips.map((clip) => clip.id),
        audioCodec: result.audioCodec,
        cachedResult: result.cached,
        isAnalyzing: false,
        notice: result.restored
          ? 'Restored your saved project and cached transcript; no new analysis was needed.'
          : result.cached && codecLabel
            ? `Using cached transcript; audio was encoded as ${codecLabel}.`
            : codecLabel
              ? `Audio encoded as ${codecLabel} for transcription.`
              : null,
      });
      if (!result.restored) {
        await saveProject(makeProject(result.meta.fileId, result.meta.name, result.meta.durationSec, clips));
      }
    } catch (error) {
      if (isCancelled(error)) {
        set({ isAnalyzing: false, notice: 'Analysis cancelled.' });
        return;
      }
      const friendly = toFriendlyError(error);
      set({ error: friendly, isAnalyzing: false });
    } finally {
      await wakeLock?.release();
      wakeLock = null;
      if (analysisController === controller) analysisController = null;
    }
  },

  cancelAnalysis: () => {
    analysisController?.abort();
    set({ isAnalyzing: false, notice: 'Cancelling…' });
  },

  selectClip: (id) => set({ selectedClipId: id }),

  toggleSelected: (id) => {
    const current = get().selectedClipIds;
    set({ selectedClipIds: current.includes(id) ? current.filter((item) => item !== id) : [...current, id] });
  },

  updateClip: (id, patch) => {
    set({ clips: get().clips.map((clip) => (clip.id === id ? { ...clip, ...patch } : clip)) });
    scheduleSave(get);
  },

  updateWord: (clipId, wordIndex, text) => {
    const clip = get().clips.find((item) => item.id === clipId);
    if (!clip) return;
    const words = clip.words.map((word, index) => (index === wordIndex ? { ...word, text } : word));
    get().updateClip(clipId, { words });
  },

  trackClip: async (id) => {
    const { file, clips } = get();
    const clip = clips.find((item) => item.id === id);
    if (!file || !clip) return;
    set({ progress: { ...get().progress, [`track:${id}`]: { phase: 'Tracking face', done: 0, total: 100, percent: 0 } } });
    const worker = createTrackWorker();
    try {
      const result = await worker.run<TrackWorkerResult>(
        { file, start: clip.start, end: clip.end },
        {
          onProgress: (percent) => set({
            progress: {
              ...get().progress,
              [`track:${id}`]: { phase: 'Tracking face', done: Math.round(percent), total: 100, percent: Math.round(percent) },
            },
          }),
        },
      );
      get().updateClip(id, { crop: result.crop });
      set({
        notice:
          result.crop.mode === 'static'
            ? 'No reliable face found; using a centred crop.'
            : `Following ${result.facesFound} face samples.`,
      });
    } catch (error) {
      set({ error: toFriendlyError(error) });
    } finally {
      const progress = { ...get().progress };
      delete progress[`track:${id}`];
      set({ progress });
      worker.dispose();
    }
  },

  renderSelected: async () => {
    const { file, meta, clips, selectedClipIds, caps } = get();
    if (!file || !meta) return;
    const chosen = clips.filter((clip) => selectedClipIds.includes(clip.id));
    if (chosen.length === 0) {
      set({ notice: 'Select at least one clip to export.' });
      return;
    }
    renderController?.abort();
    const controller = new AbortController();
    renderController = controller;
    set({ isRendering: true, error: null, rendered: [] });
    wakeLock = await acquireWakeLock();
    try {
      const results = await renderQueue(file, meta, chosen, caps, {
        signal: controller.signal,
        preferShare: caps?.shareFiles ?? false,
        onProgress: (clipId, percent, phase) => set({
          progress: {
            ...get().progress,
            [`render:${clipId}`]: { phase, done: percent, total: 100, percent: Math.round(percent) },
          },
        }),
        onExported: (result) => set({ rendered: [...get().rendered, result] }),
      });
      if (results.some((result) => result.captionsSkipped)) {
        set({ notice: 'ffmpeg fallback cannot burn captions; those clips were exported without them.' });
      }
    } catch (error) {
      if (isCancelled(error)) {
        const count = get().rendered.length;
        set({ notice: count > 0 ? `Export cancelled after ${count} clip(s).` : 'Export cancelled.' });
      } else set({ error: toFriendlyError(error) });
    } finally {
      await wakeLock?.release();
      wakeLock = null;
      set({ isRendering: false });
      if (renderController === controller) renderController = null;
    }
  },

  cancelRender: () => {
    renderController?.abort();
    set({ isRendering: false, notice: 'Cancelling export…' });
  },

  flushSaves: () => {
    for (const timer of saveTimers.values()) clearTimeout(timer);
    saveTimers.clear();
    const { meta, clips } = get();
    if (meta && clips.length > 0) {
      void saveProject(makeProject(meta.fileId, meta.name, meta.durationSec, clips)).catch(() => undefined);
    }
  },

  handleVisibilityChange: () => {
    const active = get().isAnalyzing || get().isRendering;
    if (document.visibilityState === 'hidden') {
      if (active) set({ notice: 'A job is still running in this tab. Keep it open until it finishes.' });
      return;
    }
    // wakeLock.ts re-acquires on visibility when a handle exists; if acquisition
    // originally happened while hidden, there was no handle, so acquire one now.
    if (active && !wakeLock) {
      void acquireWakeLock().then((handle) => {
        if (!get().isAnalyzing && !get().isRendering) {
          void handle?.release();
          return;
        }
        wakeLock = handle;
      });
    }
  },

  dismissError: () => set({ error: null }),
  dismissNotice: () => set({ notice: null }),
}));
