import { describe, expect, it } from 'vitest';
import {
  ApiError,
  ApiRateLimitedError,
  CancelledError,
  InvalidInputError,
  NetworkError,
  NoAudioTrackError,
  OutOfMemoryError,
  QuotaError,
  SnapcutError,
  UnsupportedCodecError,
  UnsupportedError,
  isCancelled,
  toFriendlyError,
} from '../src/lib/errors';

describe('typed errors', () => {
  it.each([
    [new UnsupportedError('OffscreenCanvas'), 'unsupported', 'UnsupportedError', 'Try desktop Chrome or Edge.'],
    [
      new UnsupportedCodecError('H.264'),
      'unsupported_codec',
      'UnsupportedCodecError',
      'Try the desktop ffmpeg fallback or another browser.',
    ],
    [new NoAudioTrackError(), 'no_audio', 'NoAudioTrackError', 'Choose a video with sound.'],
    [new OutOfMemoryError(), 'out_of_memory', 'OutOfMemoryError', 'Try a shorter source or close other tabs.'],
    [new NetworkError(), 'network', 'NetworkError', 'Check your connection and try again.'],
    [new ApiError(503, 'Service unavailable'), 'api', 'ApiError', 'Try again later.'],
    [new InvalidInputError('File is too large.'), 'invalid_input', 'InvalidInputError', 'Choose a different file.'],
    [new QuotaError(), 'quota', 'QuotaError', 'Clear site data or choose a smaller video.'],
  ] as const)('maps %s to a friendly message with an action', (error, code, name, action) => {
    expect(error).toBeInstanceOf(SnapcutError);
    expect(error.code).toBe(code);
    expect(error.name).toBe(name);
    expect(error.message.length).toBeGreaterThan(0);
    expect(toFriendlyError(error)).toEqual({ code, message: error.message, action });
  });

  it('carries retry information for rate limits', () => {
    const error = new ApiRateLimitedError(12);

    expect(error.code).toBe('rate_limited');
    expect(error.retryAfterSec).toBe(12);
    expect(error.message).toContain('12s');
    expect(toFriendlyError(error)).toEqual({
      code: 'rate_limited',
      message: error.message,
      action: 'Wait and try again.',
    });
    expect(new ApiRateLimitedError().retryAfterSec).toBe(60);
  });

  it('has an action-less cancellation error', () => {
    const error = new CancelledError();

    expect(error.code).toBe('cancelled');
    expect(toFriendlyError(error)).toEqual({ code: 'cancelled', message: 'Cancelled.', action: undefined });
  });

  it('exposes the API status', () => {
    expect(new ApiError(429, 'Too many requests').status).toBe(429);
  });
});

describe('toFriendlyError', () => {
  it('maps a quota DOMException to QuotaError', () => {
    const result = toFriendlyError(new DOMException('full', 'QuotaExceededError'));

    expect(result.code).toBe('quota');
    expect(result.message).toBe('Local storage is full.');
    expect(result.action).toBe('Clear site data or choose a smaller video.');
  });

  it('falls back to a generic API message for unknown errors', () => {
    expect(toFriendlyError(new Error('boom'))).toEqual({
      code: 'api',
      message: 'boom',
      action: 'Try again or reload the page.',
    });
    expect(toFriendlyError('just a string')).toEqual({
      code: 'api',
      message: 'Unexpected error.',
      action: 'Try again or reload the page.',
    });
  });
});

describe('isCancelled', () => {
  it('recognizes CancelledError and AbortError only', () => {
    expect(isCancelled(new CancelledError())).toBe(true);
    expect(isCancelled(Object.assign(new Error('stop'), { name: 'AbortError' }))).toBe(true);
    expect(isCancelled(new NetworkError())).toBe(false);
    expect(isCancelled(new Error('nope'))).toBe(false);
    expect(isCancelled(undefined)).toBe(false);
  });
});
