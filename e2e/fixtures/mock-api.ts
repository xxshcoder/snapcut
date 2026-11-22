export const SOURCE_DURATION_SEC = 70;

/** Raw highlight returned by the mocked /highlights route. */
export const MOCK_RAW_CLIP = {
  start: 1,
  end: 24,
  title: 'A tiny fixture with a payoff',
  hook: 'A mocked hook proves the whole browser flow.',
  score: 91,
} as const;

export type MockWord = { text: string; start: number; end: number };

const WORD_BANK = [
  'This',
  'small',
  'fixture',
  'has',
  'a',
  'clear',
  'tip',
  'and',
  'a',
  'fast',
  'payoff',
  'for',
  'the',
  'browser',
  'pipeline',
];

/** Sentence ends make buildWindows() and snapClips() behave like real transcripts. */
const SENTENCE_END_INDEXES = new Set([14, 33, 61, 69]);

export function mockWords(): MockWord[] {
  return Array.from({ length: SOURCE_DURATION_SEC }, (_, index) => {
    const base = WORD_BANK[index % WORD_BANK.length] ?? 'word';
    return {
      text: SENTENCE_END_INDEXES.has(index) ? `${base}.` : base,
      start: index,
      end: index + 0.9,
    };
  });
}

export function transcribeResponse(): { words: MockWord[]; language: string; duration: number } {
  return {
    words: mockWords(),
    language: 'en',
    duration: SOURCE_DURATION_SEC,
  };
}

export function highlightsResponse(): { clips: readonly (typeof MOCK_RAW_CLIP)[] } {
  return { clips: [MOCK_RAW_CLIP] };
}
