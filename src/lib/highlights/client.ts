import { API_BASE_URL, LIMITS } from '../../config';
import { highlightsRequestSchema, highlightsResponseSchema } from '../../contracts';
import { ApiError, CancelledError, NetworkError } from '../errors';
import type { Window } from '../../types';
import type { RawClip } from '../../contracts';

export type HighlightOptions = {
  minClipSec?: number;
  maxClipSec?: number;
  maxClips?: number;
  signal?: AbortSignal;
};

/** Calls the proxy and validates its JSON before any clip is accepted. */
export async function requestHighlights(windows: Window[], options: HighlightOptions = {}): Promise<RawClip[]> {
  const request = highlightsRequestSchema.parse({
    windows: windows.map(({ id, start, end, text }) => ({ id, start, end, text })),
    minClipSec: options.minClipSec ?? LIMITS.minClipSec,
    maxClipSec: options.maxClipSec ?? LIMITS.maxClipSec,
    maxClips: options.maxClips ?? LIMITS.maxClips,
  });

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/highlights`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal: options.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw new CancelledError();
    throw new NetworkError();
  }
  if (!response.ok) throw new ApiError(response.status, `Highlights request failed (HTTP ${response.status}).`);
  return highlightsResponseSchema.parse(await response.json()).clips;
}
