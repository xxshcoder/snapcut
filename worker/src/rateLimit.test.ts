import { describe, expect, it } from 'vitest';
import type { Env } from './env';
import {
  checkRateLimit,
  clientIp,
  evaluateLimit,
  hashIp,
  InMemoryLimiter,
  RateLimiter,
  type LimitConfig,
  type LimitSnapshot,
} from './rateLimit';

const config: LimitConfig = { perMinute: 2, dailyCap: 3 };
const noon = Date.parse('2026-11-22T12:00:30.000Z');

describe('evaluateLimit', () => {
  it('allows up to perMinute jobs inside a fixed 60-second window', () => {
    const first = evaluateLimit(undefined, config, noon);
    const second = evaluateLimit(first.next, config, noon + 1_000);
    const third = evaluateLimit(second.next, config, noon + 2_000);

    expect(first.result).toEqual({ allowed: true });
    expect(second.result).toEqual({ allowed: true });
    expect(third.result).toMatchObject({ allowed: false, reason: 'rate_limited' });
    if (!third.result.allowed) {
      expect(third.result.retryAfterSec).toBeGreaterThan(0);
      expect(third.result.retryAfterSec).toBeLessThanOrEqual(60);
    }
  });

  it('resets the minute counter on a new window but keeps the daily counter', () => {
    const first = evaluateLimit(undefined, config, noon);
    const second = evaluateLimit(first.next, config, noon + 60_000);
    expect(second.result).toEqual({ allowed: true });
    expect(second.next.minuteCount).toBe(1);
    expect(second.next.dayCount).toBe(2);
  });

  it('enforces the daily cap before the minute limit', () => {
    let snapshot: LimitSnapshot | undefined;
    for (let index = 0; index < 3; index += 1) {
      const evaluated = evaluateLimit(snapshot, config, noon + index * 60_000);
      snapshot = evaluated.next;
      expect(evaluated.result).toEqual({ allowed: true });
    }
    const blocked = evaluateLimit(snapshot, config, noon + 3 * 60_000);
    expect(blocked.result).toMatchObject({ allowed: false, reason: 'daily_limit' });
    if (!blocked.result.allowed) {
      expect(blocked.result.retryAfterSec).toBeGreaterThan(0);
      expect(blocked.result.retryAfterSec).toBeLessThanOrEqual(86_400);
    }
  });
});

describe('InMemoryLimiter', () => {
  it('limits per key independently', () => {
    const limiter = new InMemoryLimiter();
    expect(limiter.check('a', config, noon)).toEqual({ allowed: true });
    expect(limiter.check('a', config, noon)).toEqual({ allowed: true });
    expect(limiter.check('a', config, noon)).toMatchObject({ reason: 'rate_limited' });
    expect(limiter.check('b', config, noon)).toEqual({ allowed: true });
  });
});

describe('IP helpers', () => {
  it('prefers the Cloudflare header and falls back to forwarded/real IP', () => {
    const cloudflare = new Request('https://worker.test/health', {
      headers: { 'cf-connecting-ip': '1.2.3.4', 'x-forwarded-for': '9.9.9.9' },
    });
    expect(clientIp(cloudflare)).toBe('1.2.3.4');

    const forwarded = new Request('https://worker.test/health', {
      headers: { 'x-forwarded-for': '8.8.8.8, 10.0.0.1' },
    });
    expect(clientIp(forwarded)).toBe('8.8.8.8');
    expect(clientIp(new Request('https://worker.test/health'))).toBe('unknown');
  });

  it('hashes the IP without exposing it', async () => {
    const hash = await hashIp('1.2.3.4');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain('1.2.3.4');
    expect(await hashIp('1.2.3.4')).toBe(hash);
    expect(await hashIp('1.2.3.5')).not.toBe(hash);
  });
});

describe('RateLimiter Durable Object', () => {
  it('persists and enforces limits through storage', async () => {
    const values = new Map<string, unknown>();
    const storage = {
      get: async <T>(key: string): Promise<T | undefined> =>
        values.get(key) as T | undefined,
      put: async (key: string, value: unknown): Promise<void> => {
        values.set(key, value);
      },
    };
    const state = { storage } as unknown as DurableObjectState;
    const limiter = new RateLimiter(state);

    const call = async (): Promise<Response> =>
      limiter.fetch(
        new Request('https://limiter.test/check', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(config),
        }),
      );

    expect((await call()).status).toBe(200);
    expect(await (await call()).json()).toEqual({ allowed: true });
    const blocked = await call();
    expect(blocked.status).toBe(200);
    expect(await blocked.json()).toMatchObject({ allowed: false, reason: 'rate_limited' });
  });

  it('rejects unsupported paths', async () => {
    const storage = {
      get: async <T>(): Promise<T | undefined> => undefined,
      put: async (): Promise<void> => undefined,
    };
    const limiter = new RateLimiter({ storage } as unknown as DurableObjectState);
    const response = await limiter.fetch(new Request('https://limiter.test/other'));
    expect(response.status).toBe(404);
  });
});

describe('checkRateLimit', () => {
  it('uses the in-memory fallback when the binding is absent', async () => {
    const env: Env = {
      GROQ_API_KEY: 'key',
      GEMINI_API_KEY: 'key',
      ALLOWED_ORIGIN: 'https://app.test',
    };
    const tight: LimitConfig = { perMinute: 1, dailyCap: 10 };
    expect(await checkRateLimit(env, '198.51.100.1', tight)).toEqual({ allowed: true });
    expect(await checkRateLimit(env, '198.51.100.1', tight)).toMatchObject({
      reason: 'rate_limited',
    });
  });

  it('uses the Durable Object stub when the binding is present', async () => {
    const responses = [
      new Response(JSON.stringify({ allowed: true }), {
        headers: { 'Content-Type': 'application/json' },
      }),
      new Response(JSON.stringify({ allowed: false, reason: 'daily_limit', retryAfterSec: 60 }), {
        headers: { 'Content-Type': 'application/json' },
      }),
    ];
    let fetchCount = 0;
    const stub = {
      fetch: async (): Promise<Response> => {
        const response = responses[fetchCount];
        fetchCount += 1;
        return response ?? new Response('{}');
      },
    };
    const namespace = {
      idFromName: (): string => 'id',
      get: (): typeof stub => stub,
    };
    const env: Env = {
      GROQ_API_KEY: 'key',
      GEMINI_API_KEY: 'key',
      ALLOWED_ORIGIN: 'https://app.test',
      RATE_LIMITER: namespace as unknown as DurableObjectNamespace,
    };

    expect(await checkRateLimit(env, '203.0.113.2', config)).toEqual({ allowed: true });
    expect(await checkRateLimit(env, '203.0.113.2', config)).toMatchObject({
      reason: 'daily_limit',
    });
    expect(fetchCount).toBe(2);
  });
});
