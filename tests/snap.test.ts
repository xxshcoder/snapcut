import { describe, expect, it } from 'vitest';
import { snapClips } from '../src/lib/highlights/snap';
import type { RawClip } from '../src/contracts';
import type { Window, Word } from '../src/types';

function makeWords(count: number, endOffset = 0.8): Word[] {
  return Array.from({ length: count }, (_, i) => ({
    text: i % 5 === 4 ? `w${i}.` : `w${i}`,
    start: i,
    end: i + endOffset,
  }));
}

function makeWindow(start: number, end: number): Window {
  return { id: 0, start, end, text: 'transcript text', prefilterScore: 0 };
}

function raw(start: number, end: number, score: number, title = 'A great clip'): RawClip {
  return { start, end, title, hook: 'The most compelling sentence in the clip.', score };
}

describe('snapClips', () => {
  const words = makeWords(180);
  const windows = [makeWindow(0, 180)];

  it('snaps to a sentence start and a word end inside 20-60 s', () => {
    const [clip] = snapClips([raw(7, 40, 80)], words, windows);

    expect(clip).toBeDefined();
    expect(clip?.start).toBe(5);
    expect(clip?.end).toBe(39.8);
    expect(clip?.end - (clip?.start ?? 0)).toBeGreaterThanOrEqual(20);
    expect(clip?.end - (clip?.start ?? 0)).toBeLessThanOrEqual(60);
    expect(clip?.title).toBe('A great clip');
    expect(clip?.hook).toBe('The most compelling sentence in the clip.');
  });

  it('caps long clips at 60 s and clamps bounds to the window span', () => {
    const [clip] = snapClips([raw(100.2, 200, 70)], words, windows);

    expect(clip?.start).toBe(100);
    expect(clip?.end).toBe(160);
    expect((clip?.end ?? 0) - (clip?.start ?? 0)).toBeCloseTo(60, 5);

    const [clamped] = snapClips([raw(0, 30, 70)], words, [makeWindow(10, 100)]);
    expect(clamped?.start).toBeGreaterThanOrEqual(10);
    expect(clamped?.end).toBeLessThanOrEqual(100);
  });

  it('drops overlaps by score, caps maxClips and truncates long metadata', () => {
    const clips = snapClips(
      [
        raw(5, 45, 90, 'x'.repeat(120)),
        raw(10, 50, 80, 'Loser'), // overlaps the higher-scored clip
        raw(60, 100, 70),
        raw(120, 160, 60),
      ],
      words,
      windows,
      { maxClips: 2 },
    );

    expect(clips).toHaveLength(2);
    expect(clips.map((clip) => clip.score)).toEqual([90, 70]);
    expect(clips.map((clip) => clip.start)).toEqual([5, 60]);
    expect(clips[0]?.title).toHaveLength(80);
  });

  it('drops a clip that cannot reach the minimum duration inside the span', () => {
    expect(snapClips([raw(25, 30, 80)], makeWords(30), [makeWindow(0, 30)])).toEqual([]);
  });

  it('ignores non-finite raw bounds and empty inputs', () => {
    expect(
      snapClips([raw(Number.NaN, 30, 50), raw(0, Number.POSITIVE_INFINITY, 50)], words, windows),
    ).toEqual([]);
    expect(snapClips([raw(0, 30, 50)], [], windows)).toEqual([]);
    expect(snapClips([raw(0, 30, 50)], words, [])).toEqual([]);
  });

  it('clamps scores to 0-100', () => {
    const [clampedHigh, clampedLow] = snapClips([raw(0, 30, -20), raw(60, 100, 500)], words, windows);

    expect(clampedHigh?.score).toBe(100);
    expect(clampedLow?.score).toBe(0);
  });

  it('the 60 s cap leaves the end snapped to a word end', () => {
    const offsetWords = makeWords(180, 0.37);

    const clips = snapClips([raw(0, 180, 90)], offsetWords, windows);

    const wordEnds = offsetWords.map((item) => item.end);
    expect(clips).toHaveLength(1);
    expect(wordEnds.some((end) => Math.abs(end - (clips[0]?.end ?? -1)) < 0.0001)).toBe(true);
  });
});
