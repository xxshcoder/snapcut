import type { HighlightsRequest } from '../../src/contracts';
import { MODELS } from '../../src/shared/constants';
import { buildHighlightsPrompt, HIGHLIGHTS_JSON_SCHEMA } from './validate';

export { MODELS };

const GROQ_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/interactions';

/** Provider errors carry only sanitized, user-safe text (never an API key). */
export class ProviderError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryAfterSec?: number;

  constructor(message: string, status: number, code: string, retryAfterSec?: number) {
    super(message);
    this.name = 'ProviderError';
    this.status = status;
    this.code = code;
    if (retryAfterSec !== undefined) this.retryAfterSec = retryAfterSec;
  }
}

function parseRetryAfter(header: string | null, now: number = Date.now()): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.max(1, Math.ceil(seconds));
  }
  const date = Date.parse(header);
  if (Number.isFinite(date)) {
    return Math.max(1, Math.ceil((date - now) / 1000));
  }
  return undefined;
}

function rateLimitError(provider: string, response: Response): ProviderError {
  const retryAfterSec = parseRetryAfter(response.headers.get('Retry-After'));
  return new ProviderError(
    `${provider} rate limit reached`,
    429,
    'rate_limited',
    retryAfterSec ?? 1,
  );
}

/** Swap this function to change speech-to-text providers. */
export async function transcribeWithGroq(
  file: File,
  language: string | undefined,
  apiKey: string,
): Promise<unknown> {
  const form = new FormData();
  form.append('file', file, file.name || 'audio.ogg');
  form.append('model', MODELS.transcription);
  form.append('response_format', 'verbose_json');
  form.append('timestamp_granularities[]', 'word');
  if (language) form.append('language', language);

  let response: Response;
  try {
    response = await fetch(GROQ_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
  } catch {
    throw new ProviderError('Transcription provider unavailable', 502, 'provider_unavailable');
  }

  if (response.status === 429) throw rateLimitError('Transcription', response);
  if (!response.ok) {
    // Deliberately do not echo the upstream body: it may contain request details.
    throw new ProviderError(
      `Transcription provider returned ${response.status}`,
      502,
      'provider_error',
    );
  }
  try {
    return await response.json();
  } catch {
    throw new ProviderError(
      'Transcription provider returned invalid JSON',
      502,
      'provider_response_invalid',
    );
  }
}

/** Reads `output_text` from an Interactions API response, with a small fallback. */
export function extractOutputText(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const record = payload as Record<string, unknown>;
  if (typeof record.output_text === 'string') return record.output_text;

  const outputs = record.outputs;
  if (!Array.isArray(outputs)) return undefined;
  for (const output of outputs) {
    if (!output || typeof output !== 'object') continue;
    const content = (output as Record<string, unknown>).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (part && typeof part === 'object') {
        const text = (part as Record<string, unknown>).text;
        if (typeof text === 'string') return text;
      }
    }
  }
  return undefined;
}

/** Swap this function to change highlight providers. */
export async function requestGeminiHighlights(
  request: HighlightsRequest,
  apiKey: string,
): Promise<unknown> {
  const body = {
    model: MODELS.highlights,
    input: buildHighlightsPrompt(request),
    // We never chain interactions, so opt out of provider-side transcript storage.
    store: false,
    response_format: {
      type: 'text',
      mime_type: 'application/json',
      schema: HIGHLIGHTS_JSON_SCHEMA,
    },
  };

  let response: Response;
  try {
    response = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
        'Api-Revision': '2026-05-20',
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ProviderError('Highlights provider unavailable', 502, 'provider_unavailable');
  }

  if (response.status === 429) throw rateLimitError('Highlights', response);
  if (!response.ok) {
    throw new ProviderError(
      `Highlights provider returned ${response.status}`,
      502,
      'provider_error',
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ProviderError(
      'Highlights provider returned invalid JSON',
      502,
      'provider_response_invalid',
    );
  }

  const text = extractOutputText(payload);
  if (text === undefined) {
    throw new ProviderError(
      'Highlights provider returned no text',
      502,
      'provider_response_invalid',
    );
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ProviderError(
      'Highlights provider returned invalid JSON',
      502,
      'provider_response_invalid',
    );
  }
}
