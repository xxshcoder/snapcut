import { LIMITS } from '../../config';
import type { Window } from '../../types';
import { longestPause } from './window';

const NUMBER = /\b\d+([.,]\d+)?%?\b/g;
const KEYWORDS =
  /\b(secret|mistake|best|worst|never|always|actually|because|instead|first|last|why|how|what|watch|stop|start|proven|stopped|real|truth|free|easy|fast|day|years?|million|billion)\b/gi;

export function scoreWindow(window: Window, words: { text: string; start: number; end: number }[]): number {
  if (words.length === 0) return 0;
  const duration = Math.max(0.1, window.end - window.start);
  const rate = words.length / duration;
  const rateScore = Math.max(0, 1 - Math.abs(rate - 2.4) / 2.4) * 25;
  const text = window.text;
  const questions = (text.match(/\?/g) ?? []).length;
  const exclamations = (text.match(/!/g) ?? []).length;
  const questionScore = Math.min(questions, 3) * 8;
  const exclamationScore = Math.min(exclamations, 3) * 7;
  const pause = longestPause(words);
  const pauseScore = pause > 0.3 && pause < 1.2 ? 12 : 0;
  const numbers = (text.match(NUMBER) ?? []).length;
  const keywords = (text.match(KEYWORDS) ?? []).length;
  const densityScore = Math.min(numbers * 5 + keywords * 3, 25);
  return Math.round(Math.max(0, Math.min(100, rateScore + questionScore + exclamationScore + pauseScore + densityScore)));
}

/** Score and keep the top ~25% (at least 6 windows when available). */
export function prefilterWindows(
  windows: Window[],
  allWords: { text: string; start: number; end: number }[],
  options: { keepRatio?: number; minWindows?: number } = {},
): Window[] {
  if (windows.length === 0) return [];
  const scored = windows.map((window) => {
    const words = allWords.filter((w) => w.start >= window.start && w.end <= window.end);
    return { ...window, prefilterScore: scoreWindow(window, words) };
  });
  const keepRatio = options.keepRatio ?? LIMITS.prefilterKeepRatio;
  const minWindows = options.minWindows ?? LIMITS.prefilterMinWindows;
  const keep = Math.min(scored.length, Math.max(minWindows, Math.ceil(scored.length * keepRatio)));
  return scored.sort((a, b) => b.prefilterScore - a.prefilterScore).slice(0, keep);
}
