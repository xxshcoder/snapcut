/**
 * Worker bindings and numeric configuration parsing.
 *
 * Secrets (`GROQ_API_KEY`, `GEMINI_API_KEY`) are supplied with `wrangler secret put`
 * and are deliberately never written to `wrangler.toml`, logs or error bodies.
 */
export interface Env {
  GROQ_API_KEY: string;
  GEMINI_API_KEY: string;
  ALLOWED_ORIGIN: string;
  MAX_AUDIO_BYTES?: string | number;
  RATE_LIMIT_PER_MIN?: string | number;
  DAILY_JOB_CAP?: string | number;
  /** Local-development only, set in worker/.dev.vars. Never set in a deployed Worker. */
  MOCK_PROVIDERS?: string;
  RATE_LIMITER?: DurableObjectNamespace;
}

export interface WorkerConfig {
  /** Exact origins permitted by CORS. Comma-separated in the Cloudflare var. */
  allowedOrigins: Set<string>;
  maxAudioBytes: number;
  rateLimitPerMin: number;
  dailyJobCap: number;
}

const DEFAULT_MAX_AUDIO_BYTES = 5_000_000;
const DEFAULT_RATE_LIMIT_PER_MIN = 30;
const DEFAULT_DAILY_JOB_CAP = 200;

function positiveInt(value: string | number | undefined, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

/** Cloudflare vars are strings, so parse them defensively with sane defaults. */
export function readConfig(env: Env): WorkerConfig {
  return {
    allowedOrigins: new Set(
      (env.ALLOWED_ORIGIN ?? '')
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),
    maxAudioBytes: positiveInt(env.MAX_AUDIO_BYTES, DEFAULT_MAX_AUDIO_BYTES),
    rateLimitPerMin: positiveInt(env.RATE_LIMIT_PER_MIN, DEFAULT_RATE_LIMIT_PER_MIN),
    dailyJobCap: positiveInt(env.DAILY_JOB_CAP, DEFAULT_DAILY_JOB_CAP),
  };
}
