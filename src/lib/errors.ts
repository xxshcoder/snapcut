export type ErrorCode =
  | 'unsupported'
  | 'unsupported_codec'
  | 'no_audio'
  | 'out_of_memory'
  | 'rate_limited'
  | 'network'
  | 'api'
  | 'cancelled'
  | 'invalid_input'
  | 'quota';

export class SnapcutError extends Error {
  readonly code: ErrorCode;
  readonly action?: string;

  constructor(code: ErrorCode, message: string, action?: string) {
    super(message);
    this.name = 'SnapcutError';
    this.code = code;
    this.action = action;
  }
}

export class UnsupportedError extends SnapcutError {
  constructor(feature: string) {
    super('unsupported', `${feature} is not supported in this browser.`, 'Try desktop Chrome or Edge.');
    this.name = 'UnsupportedError';
  }
}

export class UnsupportedCodecError extends SnapcutError {
  constructor(codec: string) {
    super(
      'unsupported_codec',
      `This browser cannot encode or decode "${codec}".`,
      'Try the desktop ffmpeg fallback or another browser.',
    );
    this.name = 'UnsupportedCodecError';
  }
}

export class NoAudioTrackError extends SnapcutError {
  constructor() {
    super('no_audio', 'This video has no audio track.', 'Choose a video with sound.');
    this.name = 'NoAudioTrackError';
  }
}

export class OutOfMemoryError extends SnapcutError {
  constructor() {
    super(
      'out_of_memory',
      'The browser ran out of memory while processing this video.',
      'Try a shorter source or close other tabs.',
    );
    this.name = 'OutOfMemoryError';
  }
}

export class ApiRateLimitedError extends SnapcutError {
  readonly retryAfterSec: number;
  constructor(retryAfterSec = 60) {
    super('rate_limited', `Too many requests. Retry in ${retryAfterSec}s.`, 'Wait and try again.');
    this.name = 'ApiRateLimitedError';
    this.retryAfterSec = retryAfterSec;
  }
}

export class NetworkError extends SnapcutError {
  constructor(message = 'Network request failed.') {
    super('network', message, 'Check your connection and try again.');
    this.name = 'NetworkError';
  }
}

export class ApiError extends SnapcutError {
  readonly status: number;
  constructor(status: number, message: string) {
    super('api', message, 'Try again later.');
    this.name = 'ApiError';
    this.status = status;
  }
}

export class CancelledError extends SnapcutError {
  constructor() {
    super('cancelled', 'Cancelled.', undefined);
    this.name = 'CancelledError';
  }
}

export class InvalidInputError extends SnapcutError {
  constructor(message: string) {
    super('invalid_input', message, 'Choose a different file.');
    this.name = 'InvalidInputError';
  }
}

export class QuotaError extends SnapcutError {
  constructor() {
    super(
      'quota',
      'Local storage is full.',
      'Clear site data or choose a smaller video.',
    );
    this.name = 'QuotaError';
  }
}

export type FriendlyError = { message: string; action?: string; code: ErrorCode };

export function toFriendlyError(error: unknown): FriendlyError {
  if (error instanceof SnapcutError) {
    return { code: error.code, message: error.message, action: error.action };
  }
  if (error instanceof DOMException && error.name === 'QuotaExceededError') {
    return new QuotaError();
  }
  return {
    code: 'api',
    message: error instanceof Error ? error.message : 'Unexpected error.',
    action: 'Try again or reload the page.',
  };
}

export function isCancelled(error: unknown): boolean {
  return error instanceof CancelledError || (error instanceof Error && error.name === 'AbortError');
}
