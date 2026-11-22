import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HighlightsRequest } from '../../src/contracts';
import { MODELS } from '../../src/shared/constants';
import {
  extractOutputText,
  ProviderError,
  requestGeminiHighlights,
  transcribeWithGroq,
} from './providers';

interface CapturedRequest {
  url: string;
  init?: RequestInit;
}

function stubFetch(response: Response): () => CapturedRequest | undefined {
  let captured: CapturedRequest | undefined;
  const mock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    captured = { url: String(input), init };
    return response;
  });
  vi.stubGlobal('fetch', mock);
  return () => captured;
}

const audioFile = () => new File([new Uint8Array(8)], 'clip.ogg', { type: 'audio/ogg' });

const highlightsRequest: HighlightsRequest = {
  windows: [{ id: 0, start: 0, end: 120, text: 'Some transcript text.' }],
  minClipSec: 20,
  maxClipSec: 60,
  maxClips: 5,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('shared model configuration', () => {
  it('exposes the single set of model names', () => {
    expect(MODELS).toEqual({
      transcription: 'whisper-large-v3-turbo',
      highlights: 'gemini-3.8-flash',
    });
  });
});

describe('transcribeWithGroq', () => {
  it('sends verbose_json word timestamps with the configured model', async () => {
    const captured = stubFetch(new Response('{"words":[]}', { status: 200 }));
    await transcribeWithGroq(audioFile(), 'en', 'groq-secret');

    const request = captured();
    expect(request?.url).toContain('api.groq.com');
    expect(request?.init?.method).toBe('POST');
    const headers = request?.init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer groq-secret');

    const form = request?.init?.body as FormData;
    expect(form.get('model')).toBe(MODELS.transcription);
    expect(form.get('response_format')).toBe('verbose_json');
    expect(form.get('timestamp_granularities[]')).toBe('word');
    expect(form.get('language')).toBe('en');
  });

  it('maps a 429 to rate_limited with retryAfterSec', async () => {
    stubFetch(
      new Response('{}', { status: 429, headers: { 'Retry-After': '7' } }),
    );
    await expect(transcribeWithGroq(audioFile(), undefined, 'key')).rejects.toMatchObject({
      code: 'rate_limited',
      retryAfterSec: 7,
    });
  });

  it('does not leak upstream error bodies into error messages', async () => {
    stubFetch(new Response('LEAKED_SECRET in body', { status: 500 }));
    try {
      await transcribeWithGroq(audioFile(), undefined, 'key');
      throw new Error('Expected the provider call to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(ProviderError);
      const message = (error as Error).message;
      expect(message).not.toContain('LEAKED_SECRET');
      expect(message).not.toContain('key');
    }
  });
});

describe('requestGeminiHighlights', () => {
  it('calls the Interactions API with a JSON response schema and reads output_text', async () => {
    const captured = stubFetch(
      new Response(JSON.stringify({ output_text: '{"clips":[]}' }), { status: 200 }),
    );
    const payload = await requestGeminiHighlights(highlightsRequest, 'gemini-secret');

    expect(payload).toEqual({ clips: [] });
    const request = captured();
    expect(request?.url).toContain('/v1beta/interactions');
    const headers = request?.init?.headers as Record<string, string>;
    expect(headers['x-goog-api-key']).toBe('gemini-secret');
    expect(headers['Api-Revision']).toBe('2026-05-20');

    const body = JSON.parse(request?.init?.body as string) as Record<string, unknown>;
    expect(body.model).toBe(MODELS.highlights);
    expect(body.store).toBe(false);
    expect(String(body.input)).toContain('Some transcript text.');
    const responseFormat = body.response_format as Record<string, unknown>;
    expect(responseFormat).toMatchObject({ type: 'text', mime_type: 'application/json' });
    expect(responseFormat.schema).toBeDefined();
  });

  it('maps a provider 429 to rate_limited', async () => {
    stubFetch(new Response('{}', { status: 429 }));
    await expect(requestGeminiHighlights(highlightsRequest, 'key')).rejects.toMatchObject({
      code: 'rate_limited',
    });
  });

  it('rejects malformed output_text', async () => {
    stubFetch(new Response(JSON.stringify({ output_text: 'not json' }), { status: 200 }));
    await expect(requestGeminiHighlights(highlightsRequest, 'key')).rejects.toMatchObject({
      code: 'provider_response_invalid',
    });
  });
});

describe('extractOutputText', () => {
  it('reads output_text or falls back to nested content parts', () => {
    expect(extractOutputText({ output_text: '{"clips":[]}' })).toBe('{"clips":[]}');
    expect(
      extractOutputText({
        outputs: [{ content: [{ text: 'fallback' }] }],
      }),
    ).toBe('fallback');
    expect(extractOutputText({ unexpected: true })).toBeUndefined();
  });
});
