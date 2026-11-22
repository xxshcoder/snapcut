import { AUDIO, LIMITS } from '../../config';
import type { SegmentPlan } from '../../types';

export type SegmentOptions = {
  segmentSec?: number;
  overlapSec?: number;
  maxSegmentBytes?: number;
  bytesPerSecond?: number;
};

const round = (n: number): number => Math.round(n * 1000) / 1000;

/** Bytes per second of encoded audio, including container overhead. */
export function estimateBytesPerSecond(bitrateBps: number): number {
  return bitrateBps / 8 * 1.15 + 1024;
}

/**
 * Split a source duration into overlapping segments whose encoded audio stays
 * under the API's per-request byte cap. Overlap is removed again in merge.ts.
 */
export function planAudioSegments(durationSec: number, options: SegmentOptions = {}): SegmentPlan[] {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return [];

  const bytesPerSecond = options.bytesPerSecond ?? estimateBytesPerSecond(AUDIO.opusBitrate);
  const maxBytes = options.maxSegmentBytes ?? LIMITS.maxSegmentBytes;
  const byteLimitedSec = maxBytes / bytesPerSecond;
  const segmentSec = Math.max(1, Math.min(options.segmentSec ?? LIMITS.segmentSec, byteLimitedSec));
  const overlapSec = Math.max(0, Math.min(options.overlapSec ?? LIMITS.segmentOverlapSec, segmentSec / 2));

  const plans: SegmentPlan[] = [];
  let offset = 0;
  while (offset < durationSec - 0.001 && plans.length < 10_000) {
    const duration = Math.min(segmentSec, durationSec - offset);
    plans.push({ index: plans.length, offsetSec: round(offset), durationSec: round(duration) });
    if (offset + duration >= durationSec - 0.001) break;
    offset += duration - overlapSec;
  }
  return plans;
}

export function estimatedSegmentBytes(durationSec: number, bitrateBps = AUDIO.opusBitrate): number {
  return Math.ceil(durationSec * estimateBytesPerSecond(bitrateBps));
}
