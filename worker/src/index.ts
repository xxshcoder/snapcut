import { ZodError } from 'zod';
import { highlightsRequestSchema } from '../../src/contracts';
import { readConfig, type Env, type WorkerConfig } from './env';
import { ProviderError, requestGeminiHighlights, transcribeWithGroq } from './providers';
import { checkRateLimit, clientIp, RateLimiter, type LimitConfig } from './rateLimit';
import {
  cleanHighlights,
  normalizeGroqTranscription,
  parseTranscribeForm,
  ValidationError,
} from './validate';

// Wrangler binds this class through [[durable_objects.bindings]] in wrangler.toml.
export { RateLimiter };

type ResponseHeaders = Record<string, string>;

function corsHeaders(origin: string | null, config: WorkerConfig): ResponseHeaders {
  if (!origin || origin !== config.allowedOrigin) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

function jsonResponse(
  body: unknown,
  status: number,
  request: Request,
  config: WorkerConfig,
  extra: ResponseHeaders = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      Vary: 'Origin',
      ...corsHeaders(request.headers.get('Origin'), config),
      ...extra,
    },
  });
}

function errorResponse(
  code: string,
  message: string,
  status: number,
  request: Request,
  config: WorkerConfig,
  retryAfterSec?: number,
): Response {
  const body: { error: string; code: string; retryAfterSec?: number } = { error: message, code };
  const extra: ResponseHeaders = {};
  if (retryAfterSec !== undefined) {
    body.retryAfterSec = retryAfterSec;
    extra['Retry-After'] = String(retryAfterSec);
  }
  return jsonResponse(body, status, request, config, extra);
}

/** Never logs raw errors: provider failures may contain request details. */
function errorToResponse(error: unknown, request: Request, config: WorkerConfig): Response {
  if (error instanceof ValidationError) {
    return errorResponse(error.code, error.message, error.status, request, config);
  }
  if (error instanceof ProviderError) {
    return errorResponse(
      error.code,
      error.message,
      error.status === 429 ? 429 : 502,
      request,
      config,
      error.retryAfterSec,
    );
  }
  if (error instanceof ZodError) {
    return errorResponse(
      'invalid_request',
      'Request does not match the API contract',
      400,
      request,
      config,
    );
  }
  return errorResponse('internal_error', 'Unexpected server error', 500, request, config);
}

async function handleTranscribe(
  request: Request,
  env: Env,
  config: WorkerConfig,
): Promise<Response> {
  const contentType = (request.headers.get('Content-Type') ?? '').toLowerCase();
  if (!contentType.includes('multipart/form-data')) {
    return errorResponse('invalid_body', 'Expected multipart/form-data', 415, request, config);
  }
  const contentLength = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(contentLength) && contentLength > config.maxAudioBytes + 1_000_000) {
    return errorResponse('file_too_large', 'Request body too large', 413, request, config);
  }
  if (!env.GROQ_API_KEY) {
    return errorResponse(
      'server_misconfigured',
      'Transcription is not configured',
      503,
      request,
      config,
    );
  }

  try {
    const { file, language } = await parseTranscribeForm(request, config.maxAudioBytes);
    const providerPayload = await transcribeWithGroq(file, language, env.GROQ_API_KEY);
    const result = normalizeGroqTranscription(providerPayload);
    return jsonResponse(result, 200, request, config);
  } catch (error) {
    return errorToResponse(error, request, config);
  }
}

async function handleHighlights(
  request: Request,
  env: Env,
  config: WorkerConfig,
): Promise<Response> {
  const contentType = (request.headers.get('Content-Type') ?? '').toLowerCase();
  if (!contentType.includes('application/json')) {
    return errorResponse('invalid_body', 'Expected application/json', 415, request, config);
  }
  if (!env.GEMINI_API_KEY) {
    return errorResponse(
      'server_misconfigured',
      'Highlights are not configured',
      503,
      request,
      config,
    );
  }

  try {
    const parsed = highlightsRequestSchema.parse(await request.json());
    const providerPayload = await requestGeminiHighlights(parsed, env.GEMINI_API_KEY);
    const result = cleanHighlights(providerPayload, parsed);
    return jsonResponse(result, 200, request, config);
  } catch (error) {
    return errorToResponse(error, request, config);
  }
}

export async function fetch(request: Request, env: Env): Promise<Response> {
  const config = readConfig(env);
  const origin = request.headers.get('Origin');

  // Strict CORS: requests declaring a foreign Origin are rejected outright.
  // Requests without Origin (curl, same-origin) are allowed but get no CORS headers.
  if (origin && origin !== config.allowedOrigin) {
    return errorResponse('forbidden', 'Origin not allowed', 403, request, config);
  }
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(origin, config) });
  }

  const url = new URL(request.url);
  if (request.method === 'GET' && url.pathname === '/health') {
    return jsonResponse({ ok: true }, 200, request, config);
  }
  if (
    request.method !== 'POST' ||
    (url.pathname !== '/transcribe' && url.pathname !== '/highlights')
  ) {
    return errorResponse('not_found', 'Not found', 404, request, config);
  }

  const limits: LimitConfig = {
    perMinute: config.rateLimitPerMin,
    dailyCap: config.dailyJobCap,
  };
  const limit = await checkRateLimit(env, clientIp(request), limits);
  if (!limit.allowed) {
    return errorResponse(
      limit.reason,
      limit.reason === 'daily_limit' ? 'Daily job limit reached' : 'Too many requests',
      429,
      request,
      config,
      limit.retryAfterSec,
    );
  }

  return url.pathname === '/transcribe'
    ? handleTranscribe(request, env, config)
    : handleHighlights(request, env, config);
}

/**
 * Module-format Workers are instantiated from the default export. Wrangler's
 * local workerd runtime ignores a bare named `fetch` export and answers every
 * request with 500, so both the handler and the Durable Object must be exposed
 * here as well (the named exports stay for the unit tests).
 */
export default { fetch, RateLimiter };
