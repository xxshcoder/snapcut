import { describe, expect, it } from 'vitest';
import { AUDIO, LIMITS } from '../src/config';
import { estimateBytesPerSecond, estimatedSegmentBytes, planAudioSegments } from '../src/lib/audio/segment';

describe('estimateBytesPerSecond', () => {
  it('includes container overhead and the configured opus bitrate', () => {
    expect(estimateBytesPerSecond(AUDIO.opusBitrate)).toBeCloseTo(3324, 5);
    expect(estimateBytesPerSecond(16_000)).toBeGreaterThan(16_000 / 8);
    expect(estimatedSegmentBytes(10, AUDIO.opusBitrate)).toBe(Math.ceil(10 * 3324));
  });
});

describe('planAudioSegments', () => {
  it('produces about six 10-minute segments for a 1 h source (7 including the overlap tail)', () => {
    const plans = planAudioSegments(60 * 60);

    // 3600 / 600 = 6 full segments, plus a final 6 s tail because each step
    // advances segmentSec - overlapSec = 599 s.
    expect(plans.length).toBeGreaterThanOrEqual(6);
    expect(plans.length).toBeLessThanOrEqual(7);
    expect(plans).toHaveLength(7);
    expect(plans.map((plan) => plan.index)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(plans.map((plan) => plan.offsetSec)).toEqual([0, 599, 1198, 1797, 2396, 2995, 3594]);
    expect(plans.slice(0, 6).every((plan) => plan.durationSec === LIMITS.segmentSec)).toBe(true);
    expect(plans.at(-1)?.durationSec).toBe(6);

    // The overlap is intentional, so the union of the segments - not the sum
    // of their durations - must cover the source exactly.
    const coveredUntil = plans.reduce((maxEnd, plan) => Math.max(maxEnd, plan.offsetSec + plan.durationSec), 0);
    expect(coveredUntil).toBe(60 * 60);
    for (let i = 1; i < plans.length; i++) {
      const previous = plans[i - 1];
      const current = plans[i];
      if (!previous || !current) throw new Error('missing plan');
      expect(current.offsetSec).toBeGreaterThan(previous.offsetSec);
      expect(current.offsetSec + current.durationSec).toBeGreaterThan(previous.offsetSec);
      expect(previous.offsetSec + previous.durationSec - current.offsetSec).toBeCloseTo(LIMITS.segmentOverlapSec, 3);
    }
  });

  it('keeps every estimated segment at or below the 5 MB API cap', () => {
    const plans = planAudioSegments(60 * 60);

    for (const plan of plans) {
      expect(estimatedSegmentBytes(plan.durationSec)).toBeLessThanOrEqual(LIMITS.maxSegmentBytes);
    }
    // A single default-length segment leaves plenty of headroom.
    expect(estimatedSegmentBytes(LIMITS.segmentSec)).toBeLessThan(LIMITS.maxSegmentBytes);
  });

  it('shortens segments when the byte budget would otherwise be exceeded', () => {
    const plans = planAudioSegments(12, { bytesPerSecond: 1_000_000, maxSegmentBytes: 5_000_000 });

    expect(plans.map((plan) => plan.offsetSec)).toEqual([0, 4, 8]);
    expect(plans.every((plan) => plan.durationSec <= 5)).toBe(true);
    for (const plan of plans) {
      expect(plan.durationSec * 1_000_000).toBeLessThanOrEqual(5_000_000);
    }
  });

  it('clamps the overlap to at most half of a segment', () => {
    const plans = planAudioSegments(200, { segmentSec: 100, overlapSec: 1_000 });

    expect(plans.map((plan) => plan.offsetSec)).toEqual([0, 50, 100]);
    expect(plans.map((plan) => plan.durationSec)).toEqual([100, 100, 100]);
  });

  it('handles empty, invalid and short durations', () => {
    expect(planAudioSegments(0)).toEqual([]);
    expect(planAudioSegments(-10)).toEqual([]);
    expect(planAudioSegments(Number.NaN)).toEqual([]);
    expect(planAudioSegments(Number.POSITIVE_INFINITY)).toEqual([]);
    expect(planAudioSegments(30)).toEqual([{ index: 0, offsetSec: 0, durationSec: 30 }]);
  });
});
