/**
 * Local-development provider stubs. Enabled only by MOCK_PROVIDERS=true in
 * worker/.dev.vars; never enabled by the deployed wrangler.toml.
 */
import type { HighlightsRequest, HighlightsResponse, TranscribeResponse } from '../../src/contracts';

const WORD_BANK = [
  'This',
  'local',
  'demo',
  'uses',
  'mock',
  'provider',
  'results',
  'because',
  'no',
  'API',
  'keys',
  'are',
  'configured',
  'The',
  'full',
  'browser',
  'pipeline',
  'still',
  'runs',
  'end',
  'to',
  'end',
  'and',
  'exports',
  'a',
  'real',
  'nine',
  'by',
  'sixteen',
  'clip',
] as const;

/** Rough Opus duration estimate; exact timing is unnecessary for a UI demo. */
export function mockTranscription(audioBytes: number): TranscribeResponse {
  const duration = Math.max(20, Math.min(600, Math.round(audioBytes / 2000)));
  const words = Array.from({ length: duration }, (_, second) => ({
    text: `${WORD_BANK[second % WORD_BANK.length]}${second > 0 && second % 10 === 9 ? '.' : ''}`,
    start: second,
    end: second + 0.9,
  }));
  return { words, language: 'en', duration };
}

export function mockHighlights(request: HighlightsRequest): HighlightsResponse {
  const first = request.windows[0];
  if (!first) return { clips: [] };
  const start = first.start;
  const end = Math.min(first.end, start + Math.min(24, request.maxClipSec));
  return {
    clips: [
      {
        start,
        end,
        title: 'Mock highlight (demo mode)',
        hook: 'No API keys are configured, so this clip comes from a local stub.',
        score: 90,
      },
    ],
  };
}
