import {
  highlightsResponseSchema,
  transcribeResponseSchema,
  type HighlightsRequest,
  type HighlightsResponse,
  type RawClip,
  type TranscribeResponse,
} from '../../src/contracts';
import { HIGHLIGHT_SYSTEM_PROMPT } from '../../src/shared/constants';

/** Hard bounds enforced independently of what a client asks for. */
export const HARD_MIN_CLIP_SEC = 20;
export const HARD_MAX_CLIP_SEC = 60;
export const HARD_MAX_CLIPS = 10;

const EXTRA_AUDIO_TYPES = new Set([
  '',
  'application/octet-stream',
  'application/ogg',
  'application/mp4',
  'video/mp4', // m4a segments
]);

export class ValidationError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, code: string, status: number) {
    super(message);
    this.name = 'ValidationError';
    this.code = code;
    this.status = status;
  }
}

export interface TranscribeForm {
  file: File;
  language?: string;
}

/** Parses and bounds the multipart upload before any provider call is made. */
export async function parseTranscribeForm(
  request: Request,
  maxBytes: number,
): Promise<TranscribeForm> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw new ValidationError('Expected multipart/form-data', 'invalid_body', 400);
  }

  const value = form.get('file');
  if (!value || typeof value === 'string' || typeof value.arrayBuffer !== 'function') {
    throw new ValidationError('Missing audio file', 'missing_file', 400);
  }
  const file = value as File;

  if (file.size <= 0) {
    throw new ValidationError('Audio file is empty', 'invalid_file', 400);
  }
  if (file.size > maxBytes) {
    throw new ValidationError(`Audio file exceeds the ${maxBytes} byte limit`, 'file_too_large', 413);
  }
  const mime = file.type.toLowerCase();
  if (!mime.startsWith('audio/') && !EXTRA_AUDIO_TYPES.has(mime)) {
    throw new ValidationError('Unsupported audio type', 'invalid_file', 415);
  }

  const rawLanguage = form.get('language');
  if (typeof rawLanguage === 'string' && rawLanguage.trim()) {
    const language = rawLanguage.trim();
    if (!/^[a-zA-Z-]{2,35}$/.test(language)) {
      throw new ValidationError('Invalid language code', 'invalid_language', 400);
    }
    return { file, language: language.toLowerCase() };
  }
  return { file };
}

/** Groq verbose_json -> the shared, zod-validated API contract. */
export function normalizeGroqTranscription(payload: unknown): TranscribeResponse {
  if (!payload || typeof payload !== 'object') {
    throw new ValidationError('Invalid transcription response', 'provider_response_invalid', 502);
  }
  const raw = payload as Record<string, unknown>;
  const rawWords = Array.isArray(raw.words) ? raw.words : [];
  const words: TranscribeResponse['words'] = [];

  for (const item of rawWords) {
    if (!item || typeof item !== 'object') continue;
    const word = item as Record<string, unknown>;
    const text = String(word.word ?? word.text ?? '').trim();
    const start = Number(word.start);
    const end = Number(word.end);
    if (!text || !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start) {
      continue;
    }
    words.push({ text, start, end });
  }
  words.sort((a, b) => a.start - b.start);

  const reportedDuration = Number(raw.duration);
  const duration =
    Number.isFinite(reportedDuration) && reportedDuration >= 0
      ? reportedDuration
      : (words.at(-1)?.end ?? 0);
  const language =
    typeof raw.language === 'string' && raw.language ? raw.language : 'unknown';

  return transcribeResponseSchema.parse({ words, language, duration });
}

/** JSON schema handed to Gemini's structured-output response_format. */
export const HIGHLIGHTS_JSON_SCHEMA = {
  type: 'object',
  properties: {
    clips: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          start: { type: 'number' },
          end: { type: 'number' },
          title: { type: 'string' },
          hook: { type: 'string' },
          score: { type: 'number' },
        },
        required: ['start', 'end', 'title', 'hook', 'score'],
        additionalProperties: false,
      },
    },
  },
  required: ['clips'],
  additionalProperties: false,
} as const;

export function highlightBounds(request: HighlightsRequest): {
  minSec: number;
  maxSec: number;
  maxClips: number;
} {
  return {
    minSec: Math.max(HARD_MIN_CLIP_SEC, request.minClipSec),
    maxSec: Math.min(HARD_MAX_CLIP_SEC, request.maxClipSec),
    maxClips: Math.min(HARD_MAX_CLIPS, request.maxClips),
  };
}

export function buildHighlightsPrompt(request: HighlightsRequest): string {
  const bounds = highlightBounds(request);
  const instructions = HIGHLIGHT_SYSTEM_PROMPT.replaceAll('{minClipSec}', String(bounds.minSec))
    .replaceAll('{maxClipSec}', String(bounds.maxSec))
    .replaceAll('{maxClips}', String(bounds.maxClips));
  return `${instructions}\n\nWindows:\n${JSON.stringify(request.windows)}`;
}

function normalizeClip(
  clip: RawClip,
  spanStart: number,
  spanEnd: number,
  minSec: number,
  maxSec: number,
): RawClip | null {
  const rawStart = Number(clip.start);
  const rawEnd = Number(clip.end);
  if (!Number.isFinite(rawStart) || !Number.isFinite(rawEnd)) return null;

  // Tolerate tiny rounding differences from the model, but never widen the span.
  const start = Math.max(rawStart, spanStart);
  const end = Math.min(rawEnd, spanEnd);
  const duration = end - start;
  if (rawStart < spanStart - 0.05 || rawEnd > spanEnd + 0.05) return null;
  if (duration < minSec || duration > maxSec) return null;

  const title = clip.title.trim().split(/\s+/).slice(0, 8).join(' ').slice(0, 120);
  const hook = clip.hook.trim().slice(0, 600);
  if (!title || !hook) return null;

  const numericScore = Number(clip.score);
  const score = Math.round(
    Math.max(0, Math.min(100, Number.isFinite(numericScore) ? numericScore : 0)),
  );
  return { start, end, title, hook, score };
}

/** Filters, clamps and de-duplicates provider output into the public contract. */
export function cleanHighlights(
  payload: unknown,
  request: HighlightsRequest,
): HighlightsResponse {
  const parsed = highlightsResponseSchema.parse(payload);
  const spanStart = Math.min(...request.windows.map((window) => window.start));
  const spanEnd = Math.max(...request.windows.map((window) => window.end));
  const bounds = highlightBounds(request);

  const candidates = parsed.clips
    .map((clip) =>
      normalizeClip(clip, spanStart, spanEnd, bounds.minSec, bounds.maxSec),
    )
    .filter((clip): clip is RawClip => clip !== null)
    .sort((a, b) => b.score - a.score);

  const kept: RawClip[] = [];
  for (const clip of candidates) {
    if (kept.length >= bounds.maxClips) break;
    if (kept.some((other) => clip.start < other.end && clip.end > other.start)) continue;
    kept.push(clip);
  }

  return highlightsResponseSchema.parse({ clips: kept });
}
