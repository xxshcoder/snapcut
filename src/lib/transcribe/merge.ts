import type { Transcript, Word } from '../../types';

export type SegmentWordResult = {
  index: number;
  offsetSec: number;
  words: Word[];
  language?: string;
  durationSec: number;
};

const round = (n: number): number => Math.round(n * 1000) / 1000;

/**
 * Offsets each segment's words, removes words duplicated by the overlap region,
 * and guarantees monotonically increasing, non-negative timestamps.
 */
export function mergeTranscripts(
  results: SegmentWordResult[],
  fileId: string,
  durationSec: number,
  overlapSec = 1,
): Transcript {
  const ordered = [...results].sort((a, b) => a.offsetSec - b.offsetSec);
  const absolute: Word[] = [];

  for (const result of ordered) {
    for (const word of result.words) {
      const candidate: Word = {
        text: word.text.trim(),
        start: round(word.start + result.offsetSec),
        end: round(word.end + result.offsetSec),
      };
      if (!candidate.text) continue;

      // Words fully inside the overlap of an earlier segment were already seen.
      const overlapEnd = result.offsetSec + overlapSec + 0.05;
      if (result.offsetSec > 0 && candidate.end <= overlapEnd) continue;

      const previous = absolute.at(-1);
      if (previous && previous.text === candidate.text && Math.abs(previous.start - candidate.start) < 0.01) continue;
      if (previous && candidate.start < previous.start) continue;
      if (previous && candidate.start < previous.end) candidate.start = previous.end;
      if (candidate.end <= candidate.start) candidate.end = candidate.start + 0.05;
      absolute.push(candidate);
    }
  }

  absolute.sort((a, b) => a.start - b.start || a.end - b.end);
  const deduped: Word[] = [];
  for (const word of absolute) {
    const previous = deduped.at(-1);
    if (previous && previous.text === word.text && previous.start === word.start) continue;
    deduped.push({ ...word, end: Math.min(word.end, durationSec || word.end) });
  }

  return {
    fileId,
    language: ordered.find((r) => r.language)?.language,
    words: deduped,
    durationSec,
  };
}
