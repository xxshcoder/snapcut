import { describe, expect, it } from 'vitest';
import type { HighlightsRequest } from '../../src/contracts';
import { HIGHLIGHT_SYSTEM_PROMPT } from '../../src/shared/constants';
import {
  buildHighlightsPrompt,
  cleanHighlights,
  normalizeGroqTranscription,
  parseTranscribeForm,
  ValidationError,
} from './validate';

const highlightsRequest: HighlightsRequest = {
  windows: [{ id: 1, start: 0, end: 300, text: 'A full window of transcript text.' }],
  minClipSec: 20,
  maxClipSec: 60,
  maxClips: 2,
};

describe('normalizeGroqTranscription', () => {
  it('trims Groq word tokens, sorts them and coerces timestamps', () => {
    const result = normalizeGroqTranscription({
      language: 'english',
      duration: 12,
      words: [
        { word: ' world', start: '5', end: '7' },
        { word: 'hello', start: 0, end: 1 },
        { word: '', start: 2, end: 3 },
        { word: 'bad', start: 9, end: 4 },
      ],
    });

    expect(result.words).toEqual([
      { text: 'hello', start: 0, end: 1 },
      { text: 'world', start: 5, end: 7 },
    ]);
    expect(result.language).toBe('english');
    expect(result.duration).toBe(12);
  });

  it('derives duration from the last word and defaults a missing language', () => {
    const result = normalizeGroqTranscription({ words: [{ text: 'ok', start: 1, end: 4 }] });
    expect(result.duration).toBe(4);
    expect(result.language).toBe('unknown');
  });

  it('accepts the text field used by some providers', () => {
    const result = normalizeGroqTranscription({
      words: [{ text: 'hi', start: 0.5, end: 1.5 }],
    });
    expect(result.words[0]?.text).toBe('hi');
  });
});

describe('parseTranscribeForm', () => {
  it('reads the file and normalizes an optional language', async () => {
    const form = new FormData();
    form.append('file', new File([new Uint8Array(10)], 'clip.ogg', { type: 'audio/ogg' }));
    form.append('language', ' EN ');
    const request = new Request('https://worker.test/transcribe', { method: 'POST', body: form });

    const parsed = await parseTranscribeForm(request, 5_000_000);
    expect(parsed.file.size).toBe(10);
    expect(parsed.language).toBe('en');
  });

  it('rejects oversized files', async () => {
    const form = new FormData();
    form.append('file', new File([new Uint8Array(20)], 'clip.ogg', { type: 'audio/ogg' }));
    const request = new Request('https://worker.test/transcribe', { method: 'POST', body: form });

    await expect(parseTranscribeForm(request, 10)).rejects.toMatchObject({
      code: 'file_too_large',
      status: 413,
    });
  });

  it('rejects a missing file and an invalid language', async () => {
    const empty = new FormData();
    const emptyRequest = new Request('https://worker.test/transcribe', {
      method: 'POST',
      body: empty,
    });
    await expect(parseTranscribeForm(emptyRequest, 1000)).rejects.toBeInstanceOf(
      ValidationError,
    );

    const form = new FormData();
    form.append('file', new File([new Uint8Array(2)], 'clip.m4a', { type: 'audio/mp4' }));
    form.append('language', 'not a language code!');
    const badLanguage = new Request('https://worker.test/transcribe', {
      method: 'POST',
      body: form,
    });
    await expect(parseTranscribeForm(badLanguage, 1000)).rejects.toMatchObject({
      code: 'invalid_language',
    });
  });
});

describe('buildHighlightsPrompt', () => {
  it('interpolates hard bounds and embeds the windows', () => {
    const prompt = buildHighlightsPrompt({
      ...highlightsRequest,
      minClipSec: 1,
      maxClipSec: 999,
      maxClips: 999,
    });
    expect(prompt).toContain('between 20 and 60 seconds');
    expect(prompt).toContain('at most 10 clips');
    expect(prompt).toContain('"id":1');
    expect(prompt).toContain(HIGHLIGHT_SYSTEM_PROMPT.split('\n')[0]);
  });
});

describe('cleanHighlights', () => {
  it('drops out-of-span and out-of-range clips, removes overlaps and caps the count', () => {
    const result = cleanHighlights(
      {
        clips: [
          { start: 10, end: 40, title: 'A', hook: 'hook', score: 80 },
          { start: 20, end: 50, title: 'B', hook: 'hook', score: 90 },
          { start: 100, end: 130, title: 'C', hook: 'hook', score: 70 },
          { start: 140, end: 150, title: 'too short', hook: 'hook', score: 99 },
          { start: 290, end: 320, title: 'outside', hook: 'hook', score: 99 },
        ],
      },
      highlightsRequest,
    );

    expect(result.clips.map((clip) => clip.title)).toEqual(['B', 'C']);
    expect(result.clips[0]?.score).toBe(90);
  });

  it('clamps score, truncates titles to 8 words and clamps to the window span', () => {
    const result = cleanHighlights(
      {
        clips: [
          {
            start: -0.02,
            end: 30.02,
            title: 'one two three four five six seven eight nine ten',
            hook: 'a hook',
            score: 500,
          },
        ],
      },
      {
        ...highlightsRequest,
        windows: [{ id: 1, start: 0, end: 30, text: 'A bounded window.' }],
      },
    );

    expect(result.clips).toHaveLength(1);
    const clip = result.clips[0];
    expect(clip?.start).toBe(0);
    expect(clip?.end).toBe(30);
    expect(clip?.score).toBe(100);
    expect(clip?.title).toBe('one two three four five six seven eight');
  });

  it('returns an empty list when the provider returns no usable clips', () => {
    const result = cleanHighlights({ clips: [] }, highlightsRequest);
    expect(result).toEqual({ clips: [] });
  });
});
