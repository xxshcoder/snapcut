import { API, API_BASE_URL } from '../../config';
import { apiErrorSchema, transcribeResponseSchema } from '../../contracts';
import { ApiError, ApiRateLimitedError, CancelledError, NetworkError, isCancelled } from '../errors';
import { getSegmentResults, saveSegmentResult } from '../storage/db';
import type { AudioSegment, Word } from '../../types';
import type { SegmentWordResult } from './merge';

const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new CancelledError());
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    function onAbort(): void {
      clearTimeout(timer);
      reject(new CancelledError());
    }
    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }
  });

/** A server-requested Retry-After is authoritative; never silently shorten it. */
export function retryDelay(retryAfterSec: number | undefined, attempt: number): number {
  if (retryAfterSec && retryAfterSec > 0) return retryAfterSec * 1000;
  return Math.min(API.baseRetryMs * 2 ** attempt, API.maxRetryMs) + Math.random() * 250;
}

export async function uploadSegment(
  segment: AudioSegment,
  language: string | undefined,
  signal?: AbortSignal,
): Promise<SegmentWordResult> {
  const body = new FormData();
  body.append('file', segment.blob, `segment-${segment.index}.${segment.mime.includes('ogg') ? 'ogg' : 'm4a'}`);
  if (language) body.append('language', language);

  let lastError: unknown;
  for (let attempt = 0; attempt <= API.maxRetries; attempt++) {
    if (signal?.aborted) throw new CancelledError();
    try {
      const response = await fetch(`${API_BASE_URL}/transcribe`, {
        method: 'POST',
        body,
        signal,
      });
      if (response.status === 429) {
        const payload = apiErrorSchema.safeParse(await response.json().catch(() => null));
        throw new ApiRateLimitedError(payload.success ? (payload.data.retryAfterSec ?? 60) : 60);
      }
      if (!response.ok) {
        const payload = apiErrorSchema.safeParse(await response.json().catch(() => null));
        throw new ApiError(response.status, payload.success ? payload.data.error : `HTTP ${response.status}`);
      }
      const parsed = transcribeResponseSchema.parse(await response.json());
      return {
        offsetSec: segment.offsetSec,
        index: segment.index,
        durationSec: parsed.duration || segment.durationSec,
        language: parsed.language,
        words: parsed.words as Word[],
      };
    } catch (error) {
      if (isCancelled(error)) throw error;
      // A bare TypeError means fetch() never got a response: Worker down,
      // CORS/origin rejected, or a wrong VITE_API_BASE_URL. Surface it as a
      // retryable, actionable network error instead of "Failed to fetch".
      const normalized =
        error instanceof TypeError
          ? new NetworkError('Cannot reach the analysis API. Start the Worker and check the app origin.')
          : error;
      lastError = normalized;
      const retryable = normalized instanceof ApiRateLimitedError || normalized instanceof NetworkError || normalized instanceof ApiError && normalized.status >= 500;
      const retryAfter = error instanceof ApiRateLimitedError ? error.retryAfterSec : undefined;
      if (!retryable || attempt === API.maxRetries) break;
      await sleep(retryDelay(retryAfter, attempt), signal);
    }
  }
  if (lastError instanceof Error) throw lastError;
  throw new NetworkError();
}

/** Sequential, resumable upload: already-persisted segments are skipped. */
export async function transcribeAll(
  fileId: string,
  segments: AudioSegment[],
  options: { language?: string; signal?: AbortSignal; onProgress?: (done: number, total: number) => void } = {},
): Promise<SegmentWordResult[]> {
  const saved = await getSegmentResults(fileId);
  const done = new Map(saved.map((item) => [item.index, item]));
  const results: SegmentWordResult[] = [];
  for (const segment of segments) {
    const existing = done.get(segment.index);
    if (existing) {
      results.push({
        index: existing.index,
        offsetSec: existing.offsetSec,
        durationSec: existing.durationSec,
        language: existing.language,
        words: existing.words,
      });
    }
  }

  for (const segment of segments) {
    if (done.has(segment.index)) continue;
    const result = await uploadSegment(segment, options.language, options.signal);
    await saveSegmentResult(fileId, result);
    results.push(result);
    options.onProgress?.(results.length, segments.length);
  }
  return results.sort((a, b) => a.offsetSec - b.offsetSec);
}
