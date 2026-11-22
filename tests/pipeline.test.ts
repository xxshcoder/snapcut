import { afterEach, describe, expect, it, vi } from 'vitest';
import { API } from '../src/config';
import { audioCodecLabel } from '../src/store/useAppStore';
import {
  createProgressReporter,
  getLastCompletedStage,
  saveCompletedStage,
} from '../src/lib/jobs/pipeline';
import { isTransientRenderError } from '../src/lib/jobs/renderQueue';
import { retryDelay, uploadSegment } from '../src/lib/transcribe/client';
import { getSegmentResults } from '../src/lib/storage/db';
import {
  CancelledError,
  InvalidInputError,
  NetworkError,
  UnsupportedCodecError,
} from '../src/lib/errors';

describe('pipeline progress', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('reports coherent percent and an ETA from elapsed time and remaining units', () => {
    const now = vi.spyOn(Date, 'now');
    now.mockReturnValue(1000);
    const updates: { phase: string; done: number; total: number; percent: number; etaSec?: number }[] = [];
    const report = createProgressReporter((progress) => updates.push(progress));

    report('Reading file', 0, 1);
    now.mockReturnValue(3000);
    report('Transcribing audio', 1, 4);
    now.mockReturnValue(4000);
    report('Transcribing audio', 2, 4);
    now.mockReturnValue(5000);
    report('Transcribing audio', 4, 4);
    now.mockReturnValue(6000);
    report('Snapping clips', 0, 3);
    now.mockReturnValue(8000);
    report('Snapping clips', 1, 3);
    now.mockReturnValue(9000);
    report('Snapping clips', 2, 3);
    now.mockReturnValue(10000);
    report('Snapping clips', 3, 3);

    expect(updates[0]).toMatchObject({ phase: 'Reading file', done: 0, total: 1, percent: 0 });
    expect(updates[0]?.etaSec).toBeUndefined();
    // A new phase restarts its clock, so the first sample has no estimate yet.
    expect(updates[1]).toMatchObject({ phase: 'Transcribing audio', done: 1, total: 4, percent: 25, etaSec: 0 });
    expect(updates[2]).toMatchObject({ done: 2, total: 4, percent: 50, etaSec: 1 });
    expect(updates[3]).toMatchObject({ done: 4, total: 4, percent: 100, etaSec: 0 });
    expect(updates[5]).toMatchObject({ phase: 'Snapping clips', done: 1, total: 3, percent: 33, etaSec: 4 });
    expect(updates[6]).toMatchObject({ done: 2, total: 3, percent: 67, etaSec: 2 });
    expect(updates[7]).toMatchObject({ done: 3, total: 3, percent: 100, etaSec: 0 });
  });
});

describe('job stage checkpoints', () => {
  it('persists the last completed stage in the existing segment store without polluting results', async () => {
    const fileId = `job-stage-${Date.now()}`;
    expect(await getLastCompletedStage(fileId)).toBeNull();

    await saveCompletedStage(fileId, 'audio');
    expect(await getLastCompletedStage(fileId)).toBe('audio');
    await saveCompletedStage(fileId, 'transcript');
    expect(await getLastCompletedStage(fileId)).toBe('transcript');

    const saved = await getSegmentResults(fileId);
    expect(saved).toHaveLength(1);
    expect(saved[0]?.index).toBe(-1);
  });
});

describe('transcription retry wait', () => {
  it('honors a server-requested retryAfterSec even when it exceeds the local cap', () => {
    expect(retryDelay(60, 0)).toBe(60_000);
    expect(retryDelay(12.5, 2)).toBe(12_500);
    expect(retryDelay(undefined, 0)).toBeLessThanOrEqual(API.maxRetryMs + 250);
  });

  it('aborts cleanly while waiting out a long server-requested delay', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 429,
      ok: false,
      json: async () => ({ error: 'slow down', code: 'rate_limited', retryAfterSec: 3600 }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();
    const segment = { index: 0, offsetSec: 0, durationSec: 1, blob: new Blob(['x']), mime: 'audio/ogg' };

    const promise = uploadSegment(segment, undefined, controller.signal);
    // Let the 429 response be parsed and the (long) wait begin.
    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.abort();

    await expect(promise).rejects.toBeInstanceOf(CancelledError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('render failure classification and codec labels', () => {
  it('only retries transient failures', () => {
    expect(isTransientRenderError(new NetworkError())).toBe(true);
    expect(isTransientRenderError(new Error('transient'))).toBe(true);
    expect(isTransientRenderError(new UnsupportedCodecError('avc'))).toBe(false);
    expect(isTransientRenderError(new InvalidInputError('bad file'))).toBe(false);
    expect(isTransientRenderError(new CancelledError())).toBe(false);
  });

  it('labels the worker codec for the UI', () => {
    expect(audioCodecLabel('opus')).toBe('Opus (Ogg)');
    expect(audioCodecLabel('aac')).toBe('AAC (MP4)');
    expect(audioCodecLabel(null)).toBeNull();
  });
});
