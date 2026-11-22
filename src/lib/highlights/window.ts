import { LIMITS } from '../../config';
import type { Word, Window } from '../../types';

export type WindowOptions = {
  minSec?: number;
  maxSec?: number;
};

const SENTENCE_END = /[.!?。！？]["'’”)\]]?$/;

export function isSentenceEnd(text: string): boolean {
  return SENTENCE_END.test(text.trim());
}

/** Longest gap between consecutive words, in seconds. */
export function longestPause(words: Word[]): number {
  let longest = 0;
  for (let i = 1; i < words.length; i++) {
    const previous = words[i - 1];
    const current = words[i];
    if (previous && current) longest = Math.max(longest, Math.max(0, current.start - previous.end));
  }
  return longest;
}

/** Index of the last word before the longest pause in [from, to], if > 0.7 s. */
function largestPauseIndex(words: Word[], from: number, to: number): number {
  let best = -1;
  let longest = 0.7;
  for (let i = from + 1; i <= to; i++) {
    const previous = words[i - 1];
    const current = words[i];
    if (!previous || !current) continue;
    const gap = current.start - previous.end;
    if (gap > longest) {
      longest = gap;
      best = i - 1;
    }
  }
  return best;
}

export function windowText(words: Word[]): string {
  return words
    .map((w) => w.text.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+([,.!?])/g, '$1');
}

/**
 * Group words into 60-90 s windows ending on sentence boundaries. Falls back
 * to the largest pause when a window exceeds maxSec.
 */
export function buildWindows(words: Word[], options: WindowOptions = {}): Window[] {
  const minSec = options.minSec ?? LIMITS.windowMinSec;
  const maxSec = options.maxSec ?? LIMITS.windowMaxSec;
  const result: Window[] = [];
  if (words.length === 0) return result;

  let startIndex = 0;
  while (startIndex < words.length) {
    const start = words[startIndex]?.start ?? 0;
    let endIndex = startIndex;
    let cut = false;

    while (endIndex < words.length - 1) {
      const candidate = words[endIndex];
      if (!candidate) break;
      const elapsed = candidate.end - start;
      if (elapsed >= maxSec) {
        // Prefer a recent sentence boundary; otherwise cut at the longest pause.
        let fallback = endIndex;
        let foundBoundary = false;
        for (let i = endIndex; i > startIndex && candidate.end - (words[i]?.end ?? 0) < 15; i--) {
          if (isSentenceEnd(words[i]?.text ?? '')) {
            fallback = i;
            foundBoundary = true;
            break;
          }
        }
        if (!foundBoundary) {
          const pauseIndex = largestPauseIndex(words, startIndex, endIndex);
          if (pauseIndex >= 0) fallback = pauseIndex;
        }
        endIndex = fallback;
        cut = true;
        break;
      }
      if (elapsed >= minSec && isSentenceEnd(candidate.text)) {
        cut = true;
        break;
      }
      endIndex++;
    }

    const group = words.slice(startIndex, endIndex + 1);
    const end = group.at(-1)?.end ?? start;
    if (group.length > 0 && end > start) {
      result.push({
        id: result.length,
        start: Math.round(start * 1000) / 1000,
        end: Math.round(end * 1000) / 1000,
        text: windowText(group),
        prefilterScore: 0,
      });
    }
    if (!cut && endIndex >= words.length - 1) break;
    startIndex = endIndex + 1;
  }
  return result;
}
