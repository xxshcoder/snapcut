import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env } from './env';
import { fetch as workerFetch } from './index';

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    GROQ_API_KEY: 'groq-secret',
    GEMINI_API_KEY: 'gemini-secret',
    ALLOWED_ORIGIN: 'https://app.example.com',
    MAX_AUDIO_BYTES: '5000000',
    RATE_LIMIT_PER_MIN: '100',
    DAILY_JOB_CAP: '1000',
    ...overrides,
  };
}

function withIp(ip: string, request: Request): Request {
  return new Request(request, { headers: { ...Object.fromEntries(request.headers), 'cf-connecting-ip': ip } });
}

function stubFetchOnce(payload: unknown, status = 200, headers: Record<string, string> = {}) {
  const response = new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
  const mock = vi.fn(async (): Promise<Response> => response);
  vi.stubGlobal('fetch', mock);
  return mock;
}

function audioRequest(): Request {
  const form = new FormData();
  form.append('file', new File([new Uint8Array(10)], 'clip.ogg', { type: 'audio/ogg' }));
  form.append('language', 'en');
  return new Request('https://worker.test/transcribe', { method: 'POST', body: form });
}

function highlightsRequest(): Request {
  return new Request('https://worker.test/highlights', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://app.example.com' },
    body: JSON.stringify({
      windows: [{ id: 0, start: 0, end: 200, text: 'A window of transcript text.' }],
      minClipSec: 20,
      maxClipSec: 60,
      maxClips: 5,
    }),
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('/health and CORS', () => {
  it('returns { ok: true }', async () => {
    const response = await workerFetch(
      withIp('10.0.0.1', new Request('https://worker.test/health')),
      makeEnv(),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it('rejects a disallowed origin without CORS headers', async () => {
    const request = new Request('https://worker.test/health', {
      headers: { Origin: 'https://evil.example.com' },
    });
    const response = await workerFetch(withIp('10.0.0.2', request), makeEnv());
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: 'Origin not allowed',
      code: 'forbidden',
    });
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('adds CORS headers for the allowed origin and answers preflight', async () => {
    const request = new Request('https://worker.test/health', {
      headers: { Origin: 'https://app.example.com' },
    });
    const response = await workerFetch(withIp('10.0.0.3', request), makeEnv());
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://app.example.com');

    const preflight = new Request('https://worker.test/transcribe', {
      method: 'OPTIONS',
      headers: { Origin: 'https://app.example.com' },
    });
    const preflightResponse = await workerFetch(withIp('10.0.0.3', preflight), makeEnv());
    expect(preflightResponse.status).toBe(204);
    expect(preflightResponse.headers.get('Access-Control-Allow-Methods')).toContain('POST');
  });

  it('returns 404 for unknown routes', async () => {
    const response = await workerFetch(
      withIp('10.0.0.4', new Request('https://worker.test/unknown')),
      makeEnv(),
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: 'not_found' });
  });
});

describe('POST /transcribe', () => {
  it('normalizes the Groq response and never returns the API key', async () => {
    stubFetchOnce({
      language: 'english',
      duration: 6,
      words: [
        { word: ' hello', start: 0, end: 1 },
        { word: ' world', start: 2, end: 3 },
      ],
    });
    const response = await workerFetch(withIp('10.0.1.1', audioRequest()), makeEnv());
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body.words).toEqual([
      { text: 'hello', start: 0, end: 1 },
      { text: 'world', start: 2, end: 3 },
    ]);
    expect(body.language).toBe('english');
    expect(JSON.stringify(body)).not.toContain('groq-secret');
  });

  it('maps a provider 429 to rate_limited with retryAfterSec', async () => {
    stubFetchOnce({}, 429, { 'Retry-After': '12' });
    const response = await workerFetch(withIp('10.0.1.2', audioRequest()), makeEnv());
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({
      error: 'Transcription rate limit reached',
      code: 'rate_limited',
      retryAfterSec: 12,
    });
    expect(response.headers.get('Retry-After')).toBe('12');
  });

  it('rejects non-multipart bodies and missing keys', async () => {
    const jsonRequest = new Request('https://worker.test/transcribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    const wrongType = await workerFetch(withIp('10.0.1.3', jsonRequest), makeEnv());
    expect(wrongType.status).toBe(415);
    expect(await wrongType.json()).toMatchObject({ code: 'invalid_body' });

    const noKey = await workerFetch(
      withIp('10.0.1.3', audioRequest()),
      makeEnv({ GROQ_API_KEY: '' }),
    );
    expect(noKey.status).toBe(503);
    expect(await noKey.json()).toMatchObject({ code: 'server_misconfigured' });
  });
});

describe('POST /highlights', () => {
  it('validates the request and cleans the provider output', async () => {
    stubFetchOnce({
      output_text: JSON.stringify({
        clips: [
          { start: 10, end: 40, title: 'Best moment', hook: 'A hook', score: 95 },
          { start: 20, end: 50, title: 'Overlap', hook: 'A hook', score: 80 },
          { start: 300, end: 340, title: 'Outside', hook: 'A hook', score: 99 },
        ],
      }),
    });
    const response = await workerFetch(withIp('10.0.2.1', highlightsRequest()), makeEnv());
    const body = (await response.json()) as { clips: { title: string }[] };

    expect(response.status).toBe(200);
    expect(body.clips.map((clip) => clip.title)).toEqual(['Best moment']);
    expect(JSON.stringify(body)).not.toContain('gemini-secret');
  });

  it('rejects a malformed highlights request', async () => {
    const request = new Request('https://worker.test/highlights', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ windows: [] }),
    });
    const response = await workerFetch(withIp('10.0.2.2', request), makeEnv());
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'invalid_request' });
  });
});

describe('abuse limits', () => {
  it('blocks requests over the per-minute limit', async () => {
    const env = makeEnv({ RATE_LIMIT_PER_MIN: '1', DAILY_JOB_CAP: '100' });
    stubFetchOnce({ words: [], language: 'english', duration: 0 });
    expect((await workerFetch(withIp('10.0.3.1', audioRequest()), env)).status).toBe(200);

    const blocked = await workerFetch(withIp('10.0.3.1', audioRequest()), env);
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toMatchObject({ code: 'rate_limited' });
  });

  it('blocks requests over the daily cap', async () => {
    const env = makeEnv({ RATE_LIMIT_PER_MIN: '100', DAILY_JOB_CAP: '1' });
    stubFetchOnce({ words: [], language: 'english', duration: 0 });
    expect((await workerFetch(withIp('10.0.3.2', audioRequest()), env)).status).toBe(200);

    const blocked = await workerFetch(withIp('10.0.3.2', audioRequest()), env);
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toMatchObject({ code: 'daily_limit' });
  });
});
