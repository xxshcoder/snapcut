import type { Env } from './env';

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

export interface LimitConfig {
  perMinute: number;
  dailyCap: number;
}

export type LimitReason = 'rate_limited' | 'daily_limit';

export type LimitResult =
  | { allowed: true }
  | { allowed: false; reason: LimitReason; retryAfterSec: number };

export interface LimitSnapshot {
  minuteStart: number;
  minuteCount: number;
  day: string;
  dayCount: number;
}

const EMPTY_SNAPSHOT: LimitSnapshot = {
  minuteStart: 0,
  minuteCount: 0,
  day: '',
  dayCount: 0,
};

/**
 * Pure fixed-window evaluator. The daily counter is checked first so a blocked
 * job does not consume any per-minute quota. Returns the next snapshot so the
 * caller (Durable Object or in-memory fallback) only has to persist one value.
 */
export function evaluateLimit(
  snapshot: LimitSnapshot | undefined,
  config: LimitConfig,
  now: number,
): { result: LimitResult; next: LimitSnapshot } {
  const minuteStart = Math.floor(now / MINUTE_MS) * MINUTE_MS;
  const day = new Date(now).toISOString().slice(0, 10);
  const previous = snapshot ?? EMPTY_SNAPSHOT;
  const minuteCount = previous.minuteStart === minuteStart ? previous.minuteCount : 0;
  const dayCount = previous.day === day ? previous.dayCount : 0;
  const current: LimitSnapshot = { minuteStart, minuteCount, day, dayCount };

  if (dayCount >= config.dailyCap) {
    const nextMidnight = Date.parse(`${day}T00:00:00.000Z`) + DAY_MS;
    return {
      result: {
        allowed: false,
        reason: 'daily_limit',
        retryAfterSec: Math.max(1, Math.ceil((nextMidnight - now) / 1000)),
      },
      next: current,
    };
  }

  if (minuteCount >= config.perMinute) {
    return {
      result: {
        allowed: false,
        reason: 'rate_limited',
        retryAfterSec: Math.max(1, Math.ceil((minuteStart + MINUTE_MS - now) / 1000)),
      },
      next: current,
    };
  }

  return {
    result: { allowed: true },
    next: { minuteStart, minuteCount: minuteCount + 1, day, dayCount: dayCount + 1 },
  };
}

/** Fallback used only when the RATE_LIMITER binding is absent (local dev/tests). */
export class InMemoryLimiter {
  private readonly snapshots = new Map<string, LimitSnapshot>();

  check(key: string, config: LimitConfig, now: number = Date.now()): LimitResult {
    const { result, next } = evaluateLimit(this.snapshots.get(key), config, now);
    this.snapshots.set(key, next);
    return result;
  }

  clear(): void {
    this.snapshots.clear();
  }
}

const fallbackLimiter = new InMemoryLimiter();

/** Cloudflare puts the visitor IP here; the other headers cover proxies/local dev. */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return (
    request.headers.get('cf-connecting-ip') ??
    forwarded ??
    request.headers.get('x-real-ip') ??
    'unknown'
  );
}

/** One-way hash so Durable Object ids never contain a raw IP address. */
export async function hashIp(ip: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Durable Object: one instance per hashed IP, holding a single snapshot key.
 * Exported from the worker entry point so wrangler can bind it.
 */
export class RateLimiter {
  private readonly state: DurableObjectState;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'POST' || new URL(request.url).pathname !== '/check') {
      return new Response(JSON.stringify({ error: 'Not found', code: 'not_found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    let config: LimitConfig;
    try {
      const body = (await request.json()) as Partial<LimitConfig>;
      config = {
        perMinute: Number(body.perMinute) || 1,
        dailyCap: Number(body.dailyCap) || 1,
      };
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid request', code: 'bad_request' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const now = Date.now();
    const snapshot = await this.state.storage.get<LimitSnapshot>('limit');
    const { result, next } = evaluateLimit(snapshot, config, now);
    await this.state.storage.put('limit', next);
    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Checks the limit for an IP. Fails open if the Durable Object itself is
 * unreachable: a broken limiter must not take down every legitimate request.
 */
export async function checkRateLimit(
  env: Env,
  ip: string,
  config: LimitConfig,
): Promise<LimitResult> {
  const key = await hashIp(ip);
  const binding = env.RATE_LIMITER;
  if (!binding) {
    return fallbackLimiter.check(key, config);
  }

  try {
    const stub = binding.get(binding.idFromName(key));
    const response = await stub.fetch('https://rate-limiter.internal/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    });
    if (!response.ok) return { allowed: true };
    return (await response.json()) as LimitResult;
  } catch {
    return { allowed: true };
  }
}
