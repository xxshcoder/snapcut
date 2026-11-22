import { LIMITS } from '../../config';
import type { Word, Window } from '../../types';
import type { RawClip } from '../../contracts';
import { isSentenceEnd } from './window';

export type SnapLimits = {
  minClipSec?: number;
  maxClipSec?: number;
  maxClips?: number;
  searchRadiusSec?: number;
};

export type SnappedClip = {
  start: number;
  end: number;
  title: string;
  hook: string;
  score: number;
};

const round = (n: number) => Math.round(n * 1000) / 1000;

function isSentenceStart(words: Word[], index: number): boolean {
  if (index <= 0) return true;
  const previous = words[index - 1];
  return previous ? isSentenceEnd(previous.text) : true;
}

/**
 * Snap generated clip bounds to real word boundaries, enforce the duration
 * window, drop overlaps (higher score wins) and cap the number of clips.
 */
export function snapClips(
  rawClips: RawClip[],
  words: Word[],
  windows: Window[],
  options: SnapLimits = {},
): SnappedClip[] {
  if (words.length === 0 || windows.length === 0) return [];
  const minSec = options.minClipSec ?? LIMITS.minClipSec;
  const maxSec = options.maxClipSec ?? LIMITS.maxClipSec;
  const maxClips = options.maxClips ?? LIMITS.maxClips;
  const radius = options.searchRadiusSec ?? 8;
  const spanStart = Math.min(...windows.map((w) => w.start));
  const spanEnd = Math.max(...windows.map((w) => w.end));
  const snapped: SnappedClip[] = [];

  for (const raw of rawClips) {
    if (!Number.isFinite(raw.start) || !Number.isFinite(raw.end)) continue;
    const nearStart = words
      .map((word, index) => ({ word, index }))
      .filter(({ word, index }) => Math.abs(word.start - raw.start) <= radius && isSentenceStart(words, index))
      .map(({ word }) => word.start);
    const startCandidates = nearStart.length > 0 ? nearStart : words.map((w) => w.start);
    let start = closest(startCandidates, raw.start);
    const endCandidates = words.filter((w) => Math.abs(w.end - raw.end) <= radius).map((w) => w.end);
    let end = closest(endCandidates.length > 0 ? endCandidates : words.map((w) => w.end), raw.end);

    start = Math.max(start, spanStart, words[0]?.start ?? 0);
    end = Math.min(end, spanEnd, words.at(-1)?.end ?? spanEnd);
    if (end - start < minSec) end = Math.min(start + minSec, spanEnd, words.at(-1)?.end ?? spanEnd);
    if (end - start > maxSec) {
      const cap = start + maxSec;
      const capped = words
        .filter((word) => word.end <= cap + 0.001 && word.end >= start + minSec - 0.5)
        .map((word) => word.end);
      const nearestWordEnd = capped.length > 0 ? Math.max(...capped) : cap;
      // A word end within a quarter-second of the cap is close enough to use the exact cap.
      end = cap - nearestWordEnd <= 0.25 ? cap : nearestWordEnd;
    }
    if (end - start < minSec - 0.5) continue;

    const score = Math.max(0, Math.min(100, raw.score));
    snapped.push({
      start: round(start),
      end: round(end),
      title: raw.title.slice(0, 80),
      hook: raw.hook.slice(0, 300),
      score,
    });
  }

  snapped.sort((a, b) => b.score - a.score);
  const nonOverlapping: SnappedClip[] = [];
  for (const clip of snapped) {
    if (nonOverlapping.some((other) => clip.start < other.end && other.start < clip.end)) continue;
    nonOverlapping.push(clip);
    if (nonOverlapping.length >= maxClips) break;
  }
  return nonOverlapping;
}

function closest(candidates: number[], target: number): number {
  let best = candidates[0] ?? target;
  let bestDistance = Math.abs(best - target);
  for (const candidate of candidates) {
    const distance = Math.abs(candidate - target);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}
