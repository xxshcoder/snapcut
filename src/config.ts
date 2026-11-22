export { MODELS, HIGHLIGHT_SYSTEM_PROMPT } from './shared/constants';

const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env ?? {};

/** Same-origin by default; set VITE_API_BASE_URL to a Worker origin when deploying separately. */
export const API_BASE_URL = (env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');

export const API = {
  maxRetries: 4,
  baseRetryMs: 500,
  maxRetryMs: 8000,
  requestTimeoutMs: 120_000,
} as const;

export const LIMITS = {
  phone: { maxBytes: 1_000_000_000, maxDurationSec: 60 * 60 },
  desktop: { maxBytes: 8_000_000_000, maxDurationSec: 3 * 60 * 60 },
  segmentSec: 10 * 60,
  segmentOverlapSec: 1,
  maxSegmentBytes: 5_000_000,
  minClipSec: 20,
  maxClipSec: 60,
  maxClips: 10,
  windowMinSec: 60,
  windowMaxSec: 90,
  prefilterKeepRatio: 0.25,
  prefilterMinWindows: 6,
} as const;

export const AUDIO = {
  sampleRate: 16_000,
  channels: 1,
  opusBitrate: 16_000,
  aacBitrate: 48_000,
  aacSampleRate: 48_000,
  encoderChunkFrames: 20 * 16_000,
} as const;

export const RENDER = {
  phone: { width: 720, height: 1280, videoBitrateBps: 2_500_000, audioBitrateBps: 128_000 },
  desktop: { width: 1080, height: 1920, videoBitrateBps: 5_000_000, audioBitrateBps: 160_000 },
  lowMemory: { width: 540, height: 960, videoBitrateBps: 1_500_000, audioBitrateBps: 96_000 },
  frameRate: 30,
  captionFont: 'system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif',
} as const;

export const FFMPEG_CORE_BASE =
  env.VITE_FFMPEG_CORE_BASE ?? 'https://unpkg.com/@ffmpeg/core@0.12.10/dist/umd';

export const TRACKING = {
  sampleFps: 2,
  lowResWidth: 320,
  smoothingWindow: 5,
  wasmUrl: env.VITE_MEDIAPIPE_WASM_URL ?? 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.3/wasm',
  modelUrl:
    env.VITE_MEDIAPIPE_MODEL_URL ??
    'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite',
} as const;
