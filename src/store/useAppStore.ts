import { create } from 'zustand';
import { detectCapabilities } from '../lib/capabilities';
import { analyzeFile } from '../lib/jobs/pipeline';
import { renderQueue, type RenderedClip } from '../lib/jobs/renderQueue';
import { makeProject, saveProject } from '../lib/storage/db';
import { createFilmstripWorker, createTrackWorker } from '../lib/workers/client';
import { acquireWakeLock, type WakeLockHandle } from '../lib/wakeLock';
import { isCancelled, toFriendlyError, type FriendlyError } from '../lib/errors';
import type { Capabilities, Clip, FilmstripFrame, FileMeta, Progress, Transcript, Window } from '../types';
import type { FilmstripWorkerResult, TrackWorkerResult } from '../workers/messages';

type State = {
  caps: Capabilities | null;
  file: File | null;
  meta: FileMeta | null;
  objectUrl: string | null;
  transcript: Transcript | null;
  windows: Window[];
  clips: Clip[];
  past: Clip[][];
  future: Clip[][];
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
  filmstrip: FilmstripFrame[];

  initialize: () => void;
  setTheme: (theme: 'dark' | 'light') => void;
  setFile: (file: File) => Promise<void>;
  cancelAnalysis: () => void;
  loadFilmstrip: () => Promise<void>;
  selectClip: (id: string) => void;
  toggleSelected: (id: string) => void;
  selectAllClips: () => void;
  clearClipSelection: () => void;
  updateClip: (id: string, patch: Partial<Clip>) => void;
  updateWord: (clipId: string, wordIndex: number, text: string) => void;
  undo: () => void;
  redo: () => void;
  splitClip: (id: string, atSec: number) => void;
  duplicateClip: (id: string) => void;
  deleteClip: (id: string) => void;
  removeSilences: (id: string) => void;
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
let filmstripController: AbortController | null = null;
let renderController: AbortController | null = null;
let wakeLock: WakeLockHandle | null = null;
const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();

const HISTORY_LIMIT = 30;
let lastEdit = { at: 0, key: '' };

const revokeFilmstrip = (frames: FilmstripFrame[]): void => {
  for (const frame of frames) URL.revokeObjectURL(frame.url);
};

/** Snapshot before a mutation; rapid edits to the same field collapse into one step. */
function pushHistory(state: State, key?: string): Pick<State, 'past' | 'future'> {
  const now = Date.now();
  if (key !== undefined && now - lastEdit.at < 500 && lastEdit.key === key) {
    // Keep refreshing the timestamp: a pointer drag can last longer than 500 ms
    // but must still collapse into the single history entry it started with.
    lastEdit.at = now;
    return { past: state.past, future: state.future };
  }
  lastEdit = { at: now, key: key ?? '' };
  return { past: [...state.past, state.clips].slice(-HISTORY_LIMIT), future: [] };
}

function resetHistoryCoalescing(): void {
  lastEdit = { at: 0, key: '' };
}

function newClipId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `clip-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Keep selection pointing at a clip that still exists after a history/structure change. */
function reconcileSelection(clips: Clip[], selectedClipId: string | null, selectedClipIds: string[]) {
  return {
    selectedClipId: clips.some((clip) => clip.id === selectedClipId)
      ? selectedClipId
      : (clips[0]?.id ?? null),
    selectedClipIds: selectedClipIds.filter((id) => clips.some((clip) => clip.id === id)),
  };
}

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
  past: [],
  future: [],
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
  filmstrip: [],

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
    revokeFilmstrip(get().filmstrip);
    analysisController?.abort();
    filmstripController?.abort();
    resetHistoryCoalescing();
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
      past: [],
      future: [],
      selectedClipId: null,
      selectedClipIds: [],
      progress: {},
      rendered: [],
      isAnalyzing: true,
      error: null,
      notice: null,
      cachedResult: false,
      audioCodec: null,
      filmstrip: [],
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
        past: [],
        future: [],
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
      void get().loadFilmstrip();
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
    filmstripController?.abort();
    set({ isAnalyzing: false, notice: 'Cancelling…' });
  },

  loadFilmstrip: async () => {
    const { file, meta } = get();
    if (!file || !meta) return;
    filmstripController?.abort();
    const controller = new AbortController();
    filmstripController = controller;
    const worker = createFilmstripWorker();
    try {
      const frames = await worker.run<FilmstripWorkerResult>(
        { file, start: 0, end: meta.durationSec, count: 32 },
        { signal: controller.signal },
      );
      if (controller.signal.aborted) return;
      revokeFilmstrip(get().filmstrip);
      set({
        filmstrip: frames.map((frame) => ({ timeSec: frame.timeSec, url: URL.createObjectURL(frame.blob) })),
      });
    } catch (error) {
      if (!isCancelled(error)) {
        set({ notice: 'Frame strip unavailable; you can still step and cut by frame.' });
      }
    } finally {
      worker.dispose();
      if (filmstripController === controller) filmstripController = null;
    }
  },

  selectClip: (id) => set({ selectedClipId: id }),

  toggleSelected: (id) => {
    const current = get().selectedClipIds;
    set({ selectedClipIds: current.includes(id) ? current.filter((item) => item !== id) : [...current, id] });
  },

  selectAllClips: () => set({ selectedClipIds: get().clips.map((clip) => clip.id) }),

  clearClipSelection: () => set({ selectedClipIds: [] }),

  updateClip: (id, patch) => {
    const state = get();
    if (!state.clips.some((clip) => clip.id === id)) return;
    const key = `${id}|${Object.keys(patch).sort().join('|')}`;
    set({
      ...pushHistory(state, key),
      clips: state.clips.map((clip) => (clip.id === id ? { ...clip, ...patch } : clip)),
    });
    scheduleSave(get);
  },

  updateWord: (clipId, wordIndex, text) => {
    const state = get();
    const clip = state.clips.find((item) => item.id === clipId);
    if (!clip || !clip.words[wordIndex]) return;
    const words = clip.words.map((word, index) => (index === wordIndex ? { ...word, text } : word));
    set({
      ...pushHistory(state, `word:${clipId}:${wordIndex}`),
      clips: state.clips.map((item) => (item.id === clipId ? { ...item, words } : item)),
    });
    scheduleSave(get);
  },

  undo: () => {
    const state = get();
    const previous = state.past.at(-1);
    if (!previous) return;
    resetHistoryCoalescing();
    set({
      clips: previous,
      past: state.past.slice(0, -1),
      future: [state.clips, ...state.future].slice(0, HISTORY_LIMIT),
      ...reconcileSelection(previous, state.selectedClipId, state.selectedClipIds),
    });
    scheduleSave(get);
  },

  redo: () => {
    const state = get();
    const next = state.future[0];
    if (!next) return;
    resetHistoryCoalescing();
    set({
      clips: next,
      past: [...state.past, state.clips].slice(-HISTORY_LIMIT),
      future: state.future.slice(1),
      ...reconcileSelection(next, state.selectedClipId, state.selectedClipIds),
    });
    scheduleSave(get);
  },

  splitClip: (id, atSec) => {
    const state = get();
    const index = state.clips.findIndex((clip) => clip.id === id);
    const clip = state.clips[index];
    if (!clip || !Number.isFinite(atSec)) return;
    const at = Math.round(Math.min(clip.end - 0.5, Math.max(clip.start + 0.5, atSec)) * 10) / 10;
    if (at <= clip.start || at >= clip.end) return;
    const left: Clip = {
      ...clip,
      id: newClipId(),
      end: at,
      title: `${clip.title} (1)`,
      words: clip.words.filter((word) => word.start >= clip.start && word.start < at),
    };
    const right: Clip = {
      ...clip,
      id: newClipId(),
      start: at,
      title: `${clip.title} (2)`,
      words: clip.words.filter((word) => word.start >= at && word.start < clip.end),
    };
    const clips = [...state.clips];
    clips.splice(index, 1, left, right);
    resetHistoryCoalescing();
    set({
      ...pushHistory(state),
      clips,
      selectedClipId: right.id,
      selectedClipIds: [...state.selectedClipIds.filter((item) => item !== id), right.id],
      notice: `Split at ${at.toFixed(1)}s.`,
    });
    scheduleSave(get);
  },

  duplicateClip: (id) => {
    const state = get();
    const index = state.clips.findIndex((clip) => clip.id === id);
    const clip = state.clips[index];
    if (!clip) return;
    const length = clip.end - clip.start;
    const offset = clip.end + length <= (state.meta?.durationSec ?? Infinity) ? length : 0;
    const copy: Clip = {
      ...clip,
      id: newClipId(),
      start: clip.start + offset,
      end: clip.end + offset,
      title: `${clip.title} (copy)`,
      words: clip.words.map((word) => ({ ...word, start: word.start + offset, end: word.end + offset })),
    };
    const clips = [...state.clips];
    clips.splice(index + 1, 0, copy);
    resetHistoryCoalescing();
    set({
      ...pushHistory(state),
      clips,
      selectedClipId: copy.id,
      selectedClipIds: [...state.selectedClipIds, copy.id],
      notice: 'Clip duplicated.',
    });
    scheduleSave(get);
  },

  deleteClip: (id) => {
    const state = get();
    const index = state.clips.findIndex((clip) => clip.id === id);
    if (index < 0) return;
    const clips = state.clips.filter((clip) => clip.id !== id);
    resetHistoryCoalescing();
    set({
      ...pushHistory(state),
      clips,
      selectedClipId: clips[Math.min(index, clips.length - 1)]?.id ?? null,
      selectedClipIds: state.selectedClipIds.filter((item) => item !== id),
      notice: 'Clip deleted.',
    });
    scheduleSave(get);
  },

  removeSilences: (id) => {
    const state = get();
    const index = state.clips.findIndex((clip) => clip.id === id);
    const clip = state.clips[index];
    if (!clip) return;
    const threshold = 0.75;
    const words = clip.words
      .filter((word) => word.end > clip.start && word.start < clip.end)
      .sort((a, b) => a.start - b.start);
    if (words.length === 0) {
      set({ notice: 'No transcript words in this clip, so silences cannot be detected.' });
      return;
    }
    const gaps: { start: number; end: number }[] = [];
    for (let i = 1; i < words.length; i++) {
      const previous = words[i - 1];
      const current = words[i];
      if (!previous || !current) continue;
      if (current.start - previous.end >= threshold) gaps.push({ start: previous.end, end: current.start });
    }
    if (gaps.length === 0) {
      set({ notice: 'No silences longer than 0.75s were found in this clip.' });
      return;
    }
    // Keep the largest gaps so a transcript with many short pauses stays manageable.
    const chosen = gaps.sort((a, b) => (b.end - b.start) - (a.end - a.start)).slice(0, 7)
      .sort((a, b) => a.start - b.start);
    const ranges: { start: number; end: number }[] = [];
    let cursor = clip.start;
    for (const gap of chosen) {
      if (gap.start - cursor >= 0.5) ranges.push({ start: cursor, end: gap.start });
      cursor = Math.max(cursor, gap.end);
    }
    if (clip.end - cursor >= 0.5) ranges.push({ start: cursor, end: clip.end });
    if (ranges.length < 2) {
      set({ notice: 'No removable silence found inside this clip range.' });
      return;
    }
    const parts: Clip[] = ranges.map((range, partIndex) => ({
      ...clip,
      id: newClipId(),
      start: range.start,
      end: range.end,
      title: `${clip.title.replace(/ \(part \d+\)$/, '')} (part ${partIndex + 1})`,
      words: clip.words.filter((word) => word.start >= range.start && word.start < range.end),
    }));
    const clips = [...state.clips];
    clips.splice(index, 1, ...parts);
    resetHistoryCoalescing();
    set({
      ...pushHistory(state),
      clips,
      selectedClipId: parts[0]!.id,
      selectedClipIds: [...state.selectedClipIds.filter((item) => item !== id), ...parts.map((part) => part.id)],
      notice: `Removed ${chosen.length} silent gap(s); created ${parts.length} shorter clips.`,
    });
    scheduleSave(get);
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
    const { file, meta, clips, selectedClipIds, selectedClipId, caps } = get();
    if (!file || !meta) return;
    // Tick marks choose a set, but never block export: with none ticked we
    // export the clip being edited (or every clip when none is active).
    const ticked = clips.filter((clip) => selectedClipIds.includes(clip.id));
    const active = clips.find((clip) => clip.id === selectedClipId);
    const chosen = ticked.length > 0 ? ticked : active ? [active] : clips;
    if (chosen.length === 0) return;
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
