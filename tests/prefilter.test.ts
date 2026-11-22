import { describe, expect, it } from 'vitest';
import { prefilterWindows, scoreWindow } from '../src/lib/highlights/prefilter';
import type { Window } from '../src/types';

type ScoredWord = { text: string; start: number; end: number };

function makeWindow(id: number, text: string, start = 0, end = 60): Window {
  return { id, start, end, text, prefilterScore: 0 };
}

function steadyWords(count: number, start: number, end: number): ScoredWord[] {
  const duration = end - start;
  return Array.from({ length: count }, (_, i) => ({
    text: `word${i}`,
    start: start + (i * duration) / count,
    end: start + ((i + 1) * duration) / count - 0.05,
  }));
}

describe('scoreWindow', () => {
  it('returns zero for a window with no words', () => {
    expect(scoreWindow(makeWindow(0, 'Anything?'), [])).toBe(0);
  });

  it('rewards questions, exclamations, numbers and hook keywords', () => {
    const words = steadyWords(144, 0, 60); // ~2.4 words/s: best speech-rate score

    const plain = scoreWindow(makeWindow(0, 'The thing was there and then it stayed.'), words);
    const engaging = scoreWindow(
      makeWindow(1, 'What? Why did the 3 secrets work? Amazing!'),
      words,
    );

    expect(plain).toBeGreaterThan(0);
    expect(engaging).toBeGreaterThan(plain);
    expect(engaging).toBeLessThanOrEqual(100);
  });

  it('caps repeated punctuation and keyword bonuses', () => {
    const words = steadyWords(10, 0, 10);
    const capped = scoreWindow(makeWindow(0, 'why why why why why why why why why why ???? !!!!'), words);

    expect(capped).toBeLessThanOrEqual(100);
  });

  it('awards the pause bonus only for a moderate pause', () => {
    const words = steadyWords(20, 0, 20);
    const withPause = [...words];
    const shifted = withPause.slice(10).map((item) => ({
      ...item,
      start: item.start + 0.5,
      end: item.end + 0.5,
    }));
    withPause.splice(10, withPause.length - 10, ...shifted);

    const window = makeWindow(0, 'plain text');
    expect(scoreWindow(window, withPause)).toBeGreaterThan(scoreWindow(window, words));
  });
});

describe('prefilterWindows', () => {
  it('keeps the top 25% with a minimum of 6 windows and sorts by score', () => {
    const windows = Array.from({ length: 8 }, (_, i) =>
      makeWindow(i, `secret `.repeat(i).trim() || 'nothing special'),
    );
    const allWords = windows.flatMap((window) => steadyWords(10, window.start, window.end));

    const kept = prefilterWindows(windows, allWords);

    expect(kept).toHaveLength(6);
    expect(kept.map((window) => window.id)).toEqual([7, 6, 5, 4, 3, 2]);
    expect(kept.map((window) => window.prefilterScore)).toEqual(
      [...kept.map((window) => window.prefilterScore)].sort((a, b) => b - a),
    );
    expect(kept.every((window) => window.prefilterScore > 0)).toBe(true);
    // The input windows are not mutated.
    expect(windows.every((window) => window.prefilterScore === 0)).toBe(true);
  });

  it('keeps more than the minimum once there are enough windows', () => {
    const windows = Array.from({ length: 40 }, (_, i) => makeWindow(i, `secret `.repeat(i).trim()));
    const allWords = windows.flatMap((window) => steadyWords(10, window.start, window.end));

    const kept = prefilterWindows(windows, allWords);

    expect(kept).toHaveLength(10);
  });

  it('honours explicit keepRatio and minWindows options', () => {
    const windows = Array.from({ length: 20 }, (_, i) => makeWindow(i, `secret `.repeat(i).trim()));
    const allWords = windows.flatMap((window) => steadyWords(10, window.start, window.end));

    expect(prefilterWindows(windows, allWords, { keepRatio: 0.1, minWindows: 2 })).toHaveLength(2);
    expect(prefilterWindows(windows, allWords, { keepRatio: 0.5, minWindows: 1 })).toHaveLength(10);
  });

  it('returns an empty array for no windows', () => {
    expect(prefilterWindows([], [])).toEqual([]);
  });
});
