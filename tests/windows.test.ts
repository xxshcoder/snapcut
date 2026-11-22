import { describe, expect, it } from 'vitest';
import { buildWindows, isSentenceEnd, longestPause, windowText } from '../src/lib/highlights/window';
import type { Word } from '../src/types';

function word(text: string, start: number, end: number): Word {
  return { text, start, end };
}

describe('window helpers', () => {
  it('recognizes sentence-ending punctuation including quotes and CJK marks', () => {
    expect(isSentenceEnd('Hello.')).toBe(true);
    expect(isSentenceEnd('Really?!')).toBe(true);
    expect(isSentenceEnd('He said "go."')).toBe(true);
    expect(isSentenceEnd('你好。')).toBe(true);
    expect(isSentenceEnd('こんにちは！')).toBe(true);
    expect(isSentenceEnd('Hello')).toBe(false);
    expect(isSentenceEnd('')).toBe(false);
  });

  it('finds the longest gap between consecutive words', () => {
    expect(
      longestPause([word('a', 0, 1), word('b', 1, 2), word('c', 5, 6), word('d', 6.2, 7)]),
    ).toBeCloseTo(3, 5);
    expect(longestPause([word('a', 0, 1)])).toBe(0);
    expect(longestPause([])).toBe(0);
    expect(longestPause([word('a', 0, 1), word('b', 0.5, 1.5)])).toBe(0);
  });

  it('joins words into readable text without spaces before punctuation', () => {
    expect(windowText([word('Hello', 0, 1), word(' world', 1, 2), word(' .', 2, 3), word('How', 3, 4), word('are', 4, 5), word('you', 5, 6), word('?', 6, 7)])).toBe(
      'Hello world. How are you?',
    );
    expect(windowText([])).toBe('');
  });
});

describe('buildWindows', () => {
  it('returns no windows for an empty transcript', () => {
    expect(buildWindows([])).toEqual([]);
  });

  it('ends windows on sentence boundaries once the minimum length is reached', () => {
    const words = Array.from({ length: 12 }, (_, i) =>
      word(i === 4 || i === 9 ? `w${i}.` : `w${i}`, i * 2, i * 2 + 2),
    );

    const windows = buildWindows(words, { minSec: 10, maxSec: 30 });

    expect(windows.map((window) => window.id)).toEqual([0, 1, 2]);
    expect(windows.map((window) => window.start)).toEqual([0, 10, 20]);
    expect(windows.map((window) => window.end)).toEqual([10, 20, 24]);
    expect(windows[0]?.text).toBe('w0 w1 w2 w3 w4.');
    expect(windows[1]?.text).toBe('w5 w6 w7 w8 w9.');
    expect(windows[2]?.text).toBe('w10 w11');
    expect(windows.every((window) => window.prefilterScore === 0)).toBe(true);
    expect(windows.at(-1)?.end).toBe(words.at(-1)?.end);
  });

  it('does not cut at a sentence boundary before the minimum length', () => {
    const words = [
      word('Early.', 0, 1),
      word('More', 1, 2),
      word('text', 2, 3),
      word('here.', 3, 4),
      word('and', 4, 5),
      word('more.', 5, 6),
    ];

    const windows = buildWindows(words, { minSec: 5, maxSec: 20 });

    expect(windows).toHaveLength(1);
    expect(windows[0]?.end).toBe(6);
  });

  it('hard-cuts a long sentence at maxSec so no words are lost', () => {
    const words = Array.from({ length: 30 }, (_, i) => word(`w${i}`, i, i + 0.8));

    const windows = buildWindows(words, { minSec: 10, maxSec: 20 });

    expect(windows.length).toBeGreaterThan(1);
    // The cut lands on the word that crossed maxSec, so a window may overrun
    // by at most one word (0.8 s here).
    expect(windows.every((window) => window.end - window.start <= 21)).toBe(true);
    expect(windows[0]?.start).toBe(0);
    expect(windows.at(-1)?.end).toBeCloseTo(29.8, 5);
    // Consecutive windows must be contiguous and never overlap or skip words.
    for (let i = 1; i < windows.length; i++) {
      const previous = windows[i - 1];
      const current = windows[i];
      if (!previous || !current) throw new Error('missing window');
      expect(current.start).toBeGreaterThanOrEqual(previous.end);
    }
  });

  it('falls back to a long pause when no sentence boundary is available', () => {
    const words = Array.from({ length: 30 }, (_, i) => {
      const start = i < 10 ? i : i + 5; // 5.2 s pause after word 9
      return word(`w${i}`, start, start + 0.8);
    });

    expect(longestPause(words)).toBeCloseTo(5.2, 5);

    const windows = buildWindows(words, { minSec: 10, maxSec: 20 });

    expect(windows[0]?.end).toBeLessThanOrEqual(10.5);
  });
});
