import { LIMITS } from '../../config';
import { buildWindows } from '../highlights/window';
import { prefilterWindows } from '../highlights/prefilter';
import { requestHighlights } from '../highlights/client';
import { snapClips } from '../highlights/snap';
import { mergeTranscripts } from '../transcribe/merge';
import { transcribeAll } from '../transcribe/client';
import { centeredCrop } from '../render/crop';
import { assertWithinLimits, probeFile } from '../fileSource';
import {
  getProject,
  getSegmentResults,
  getTranscript,
  makeProject,
  saveProject,
  saveSegmentResult,
  saveTranscript,
} from '../storage/db';
import { createAudioWorker } from '../workers/client';
import type { AudioWorkerResult } from '../../workers/messages';
import { CancelledError, isCancelled } from '../errors';
import type { Clip, FileMeta, Progress, Transcript, Window, Word } from '../../types';

export type PipelineUpdate = (progress: Progress) => void;

export type PipelineResult = {
  meta: FileMeta;
  transcript: Transcript;
  windows: Window[];
  clips: Clip[];
  cached: boolean;
  /** True when a saved project (and its clips) was restored instead of calling the highlights API. */
  restored: boolean;
  /** Codec chosen by the audio worker, surfaced so the UI can explain the transcription format. */
  audioCodec: string | null;
};

function percent(done: number, total: number): number {
  return total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
}

/**
 * Lightweight job checkpoints reuse the existing `segments` object store (no new
 * db schema or dependency). Index -1 is reserved for a stage marker so it can
 * never collide with a real audio segment (all of which use non-negative indices).
 */
export type JobStage = 'audio' | 'transcript' | 'complete';
const JOB_STATE_INDEX = -1;
const JOB_STAGE_PREFIX = 'job:';

export async function getLastCompletedStage(fileId: string): Promise<JobStage | null> {
  const records = await getSegmentResults(fileId);
  const marker = records.find(
    (item) => item.index === JOB_STATE_INDEX && typeof item.language === 'string' && item.language.startsWith(JOB_STAGE_PREFIX),
  );
  if (!marker?.language) return null;
  return marker.language.slice(JOB_STAGE_PREFIX.length) as JobStage;
}

export async function saveCompletedStage(fileId: string, stage: JobStage): Promise<void> {
  await saveSegmentResult(fileId, {
    index: JOB_STATE_INDEX,
    offsetSec: 0,
    durationSec: 0,
    words: [],
    language: `${JOB_STAGE_PREFIX}${stage}`,
  });
}

/** Build a reporter with a per-phase ETA derived from elapsed time and completed units. */
export function createProgressReporter(update?: PipelineUpdate): (phase: string, done: number, total: number) => void {
  let activePhase = '';
  let activeTotal = 0;
  let startedAt = 0;
  return (phase, done, total) => {
    const now = Date.now();
    if (phase !== activePhase || total !== activeTotal) {
      activePhase = phase;
      activeTotal = total;
      startedAt = now;
    }
    const elapsedSec = Math.max(0, (now - startedAt) / 1000);
    let etaSec: number | undefined;
    if (total > 0 && done > 0 && done < total) etaSec = Math.max(0, Math.round((elapsedSec / done) * (total - done)));
    else if (total > 0 && done >= total) etaSec = 0;
    update?.({ phase, done, total, percent: percent(done, total), etaSec });
  };
}

function clipWords(words: Word[], start: number, end: number): Word[] {
  return words.filter((word) => word.end > start && word.start < end).map((word) => ({
    text: word.text,
    start: Math.max(word.start, start),
    end: Math.min(word.end, end),
  }));
}

/** Cached clips already carry their words, so a restored project can avoid re-transcribing too. */
function transcriptFromClips(fileId: string, clips: Clip[], durationSec: number): Transcript {
  const words = clips
    .flatMap((clip) => clip.words.map((word) => ({ ...word })))
    .sort((a, b) => a.start - b.start || a.end - b.end);
  return { fileId, words, durationSec };
}

/** Full file -> transcript -> candidate clips pipeline. Cached transcripts skip audio + API work. */
export async function analyzeFile(
  file: File,
  options: { isMobile: boolean; signal?: AbortSignal; onProgress?: PipelineUpdate },
): Promise<PipelineResult> {
  const report = createProgressReporter(options.onProgress);
  if (options.signal?.aborted) throw new CancelledError();

  report('Reading file', 0, 1);
  const meta = await probeFile(file);
  assertWithinLimits(meta, options.isMobile);

  // Restore work completed by a previous run before doing anything expensive.
  const savedProject = await getProject(meta.fileId);
  const savedTranscript = await getTranscript(meta.fileId);
  if (savedProject && savedProject.clips.length > 0) {
    const transcript = savedTranscript ?? transcriptFromClips(meta.fileId, savedProject.clips, meta.durationSec);
    const windows = prefilterWindows(buildWindows(transcript.words), transcript.words);
    report('Restoring saved project', 1, 1);
    return {
      meta,
      transcript,
      windows,
      clips: savedProject.clips,
      cached: true,
      restored: true,
      audioCodec: null,
    };
  }

  const lastStage = await getLastCompletedStage(meta.fileId);
  let transcript = savedTranscript;
  let audioCodec: string | null = null;
  if (!transcript) {
    report('Extracting audio', 0, 100);
    const worker = createAudioWorker();
    try {
      const audio = await worker.run<AudioWorkerResult>(
        { file },
        {
          signal: options.signal,
          onProgress: (p, phase) => report(phase, Math.round(p), 100),
        },
      );
      audioCodec = audio.codec;
      await saveCompletedStage(meta.fileId, 'audio');
      report('Transcribing audio', 0, audio.segments.length);
      const results = await transcribeAll(meta.fileId, audio.segments, {
        signal: options.signal,
        onProgress: (done, total) => report('Transcribing audio', done, total),
      });
      transcript = mergeTranscripts(results, meta.fileId, meta.durationSec, LIMITS.segmentOverlapSec);
      await saveTranscript(transcript);
      await saveCompletedStage(meta.fileId, 'transcript');
    } finally {
      worker.dispose();
    }
  } else if (lastStage === 'transcript' || lastStage === 'complete') {
    report('Resuming from saved transcript', 1, 1);
  } else {
    report('Using cached transcript', 1, 1);
    await saveCompletedStage(meta.fileId, 'transcript');
  }

  if (options.signal?.aborted) throw new CancelledError();
  report('Finding moments', 0, 3);
  const windows = buildWindows(transcript.words);
  if (windows.length === 0) throw new Error('The transcript did not contain any usable speech.');

  const filtered = prefilterWindows(windows, transcript.words);
  report('Asking Gemini for highlights', 1, 3);
  const rawClips = await requestHighlights(filtered, { signal: options.signal });
  report('Snapping clips', 2, 3);
  const snapped = snapClips(rawClips, transcript.words, filtered);
  if (snapped.length === 0) throw new Error('Gemini did not return any clips that met the duration rules.');

  const defaultCrop = centeredCrop(meta.width, meta.height);
  const clips: Clip[] = snapped.map((clip, index) => ({
    id: `${meta.fileId}-${index}-${Math.round(clip.start * 10)}`,
    start: clip.start,
    end: clip.end,
    title: clip.title,
    hook: clip.hook,
    score: clip.score,
    crop: { mode: 'static', ...defaultCrop },
    captionsEnabled: true,
    captionStyle: 'bold-pop',
    words: clipWords(transcript.words, clip.start, clip.end),
  }));

  await saveProject(makeProject(meta.fileId, meta.name, meta.durationSec, clips));
  await saveCompletedStage(meta.fileId, 'complete');
  report('Ready', 3, 3);
  return { meta, transcript, windows: filtered, clips, cached: savedTranscript !== undefined, restored: false, audioCodec };
}

export function isPipelineCancelled(error: unknown): boolean {
  return isCancelled(error);
}
