import { describe, expect, it } from 'vitest';
import { mergeTranscripts, type SegmentWordResult } from '../src/lib/transcribe/merge';
import type { Word } from '../src/types';

function word(text: string, start: number, end: number): Word {
  return { text, start, end };
}

const FIRST_SEGMENT: SegmentWordResult = {
  index: 0,
  offsetSec: 0,
  durationSec: 10,
  language: 'en',
  words: [
    word(' Hello', 0, 0.5),
    word('world.', 0.5, 1),
    word('Second', 1, 1.6),
    word('sentence.', 1.6, 2.2),
    word('Tail', 9, 9.4),
    word('word.', 9.4, 10),
  ],
};

const SECOND_SEGMENT: SegmentWordResult = {
  index: 1,
  offsetSec: 9,
  durationSec: 6,
  language: 'en',
  words: [
    // These two belong to the 1 s overlap and must be dropped.
    word('Tail', 0, 0.4),
    word('word.', 0.4, 1),
    word('Next', 1.1, 1.7),
    word('part.', 1.7, 2.4),
    word('  ', 2.4, 2.5),
  ],
};

describe('mergeTranscripts', () => {
  it('adds offsets, drops overlap duplicates and keeps monotonic timestamps', () => {
    const transcript = mergeTranscripts([FIRST_SEGMENT, SECOND_SEGMENT], 'file-1', 15);

    expect(transcript.fileId).toBe('file-1');
    expect(transcript.language).toBe('en');
    expect(transcript.durationSec).toBe(15);
    expect(transcript.words.map((item) => item.text)).toEqual([
      'Hello',
      'world.',
      'Second',
      'sentence.',
      'Tail',
      'word.',
      'Next',
      'part.',
    ]);
    expect(transcript.words.slice(0, 6).map((item) => item.start)).toEqual([0, 0.5, 1, 1.6, 9, 9.4]);
    expect(transcript.words.slice(6).map((item) => item.start)).toEqual([10.1, 10.7]);

    for (let i = 0; i < transcript.words.length; i++) {
      const current = transcript.words[i];
      if (!current) throw new Error('missing word');
      expect(current.end).toBeGreaterThan(current.start);
      expect(current.end).toBeLessThanOrEqual(15);
      const previous = transcript.words[i - 1];
      if (previous) {
        expect(current.start).toBeGreaterThanOrEqual(previous.start);
      }
    }
  });

  it('sorts out-of-order segment results before merging', () => {
    const reversed = mergeTranscripts([SECOND_SEGMENT, FIRST_SEGMENT], 'file-2', 15);
    const ordered = mergeTranscripts([FIRST_SEGMENT, SECOND_SEGMENT], 'file-2', 15);

    expect(reversed).toEqual(ordered);
  });

  it('takes the language from the earliest segment that has one', () => {
    const first: SegmentWordResult = { ...FIRST_SEGMENT, language: undefined };
    const second: SegmentWordResult = { ...SECOND_SEGMENT, offsetSec: 0, language: 'fr' };
    const third: SegmentWordResult = { ...SECOND_SEGMENT, offsetSec: 20, language: 'de' };

    expect(mergeTranscripts([third, first, second], 'file-3', 30).language).toBe('fr');
  });

  it('clamps words that start before the previous word ends and skips backwards words', () => {
    const first: SegmentWordResult = {
      index: 0,
      offsetSec: 0,
      durationSec: 20,
      words: [word('first', 0, 5)],
    };
    const second: SegmentWordResult = {
      index: 1,
      offsetSec: 5,
      durationSec: 20,
      words: [word('backwards', -6, -5), word('overlapping', -0.2, 0.5)],
    };

    const transcript = mergeTranscripts([first, second], 'file-4', 20, 0);

    expect(transcript.words).toEqual([
      word('first', 0, 5),
      word('overlapping', 5, 5.5),
    ]);
  });

  it('skips words whose text is empty after trimming', () => {
    const result: SegmentWordResult = {
      index: 0,
      offsetSec: 0,
      durationSec: 10,
      words: [word('   ', 0, 0.5), word('kept', 1, 1.5)],
    };

    expect(mergeTranscripts([result], 'file-5', 10, 0).words).toEqual([word('kept', 1, 1.5)]);
  });

  it('identical words from duplicate results are deduped', () => {
    const duplicate: SegmentWordResult = {
      index: 0,
      offsetSec: 0,
      durationSec: 10,
      words: [word('same', 1, 1.5)],
    };

    const transcript = mergeTranscripts([duplicate, duplicate], 'file-5b', 10, 0);

    expect(transcript.words).toEqual([word('same', 1, 1.5)]);
  });

  it('returns an empty transcript when there are no words', () => {
    expect(mergeTranscripts([], 'file-6', 0)).toEqual({
      fileId: 'file-6',
      language: undefined,
      words: [],
      durationSec: 0,
    });
  });
});
