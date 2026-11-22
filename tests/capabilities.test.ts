/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
// The lib references above make the DOM globals used by src/lib/capabilities.ts
// available to tsconfig.node.json (which otherwise only loads the ES + node libs).

import { afterEach, describe, expect, it, vi } from 'vitest';
import { describeCapabilities, detectCapabilities } from '../src/lib/capabilities';

const CODEC_GLOBALS = ['VideoEncoder', 'VideoDecoder', 'AudioEncoder', 'AudioDecoder', 'OffscreenCanvas'] as const;

const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36';
const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Version/17.0';

function stubCodecs(present: boolean): void {
  for (const name of CODEC_GLOBALS) {
    vi.stubGlobal(name, present ? class Stub {} : undefined);
  }
}

function stubNavigator(values: Record<string, unknown>): void {
  vi.stubGlobal('navigator', values);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('detectCapabilities', () => {
  it('detects a fully capable desktop browser', () => {
    stubCodecs(true);
    stubNavigator({
      userAgent: DESKTOP_UA,
      storage: { getDirectory: async () => ({}) },
      wakeLock: { request: async () => ({}) },
      share: async () => undefined,
      canShare: () => true,
    });
    vi.stubGlobal('window', {});

    const caps = detectCapabilities();

    expect(caps).toMatchObject({
      videoEncoder: true,
      videoDecoder: true,
      audioEncoder: true,
      audioDecoder: true,
      opfs: true,
      wakeLock: true,
      shareFiles: true,
      offscreenCanvas: true,
      mediabunny: true,
      ffmpegFallback: true,
      isMobile: false,
      isDesktop: true,
      missing: [],
    });
    expect(describeCapabilities(caps)).toBe('All required browser features are available.');
  });

  it('reports all missing codecs in a readable order', () => {
    stubCodecs(false);
    stubNavigator({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64)' });
    vi.stubGlobal('window', undefined);

    const caps = detectCapabilities();

    expect(caps.missing).toEqual(['VideoDecoder', 'VideoEncoder', 'AudioDecoder', 'AudioEncoder', 'OffscreenCanvas']);
    expect(caps).toMatchObject({
      opfs: false,
      wakeLock: false,
      shareFiles: false,
      ffmpegFallback: false,
      mediabunny: true,
      isDesktop: true,
    });
    expect(describeCapabilities(caps)).toBe(
      'Missing: VideoDecoder, VideoEncoder, AudioDecoder, AudioEncoder, OffscreenCanvas.',
    );
  });

  it('detects mobile user agents and disables the desktop ffmpeg fallback', () => {
    stubCodecs(true);
    stubNavigator({ userAgent: IPHONE_UA });
    vi.stubGlobal('window', {});

    const caps = detectCapabilities();

    expect(caps.isMobile).toBe(true);
    expect(caps.isDesktop).toBe(false);
    expect(caps.ffmpegFallback).toBe(false);
    expect(caps.missing).toEqual([]);
  });

  it('reports Android chrome as mobile', () => {
    stubCodecs(true);
    stubNavigator({ userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36' });

    expect(detectCapabilities().isMobile).toBe(true);
  });

  it('requires both share and canShare with file support', () => {
    stubCodecs(true);

    stubNavigator({ userAgent: DESKTOP_UA, share: async () => undefined });
    expect(detectCapabilities().shareFiles).toBe(false);

    stubNavigator({ userAgent: DESKTOP_UA, share: async () => undefined, canShare: () => false });
    expect(detectCapabilities().shareFiles).toBe(false);

    stubNavigator({
      userAgent: DESKTOP_UA,
      share: async () => undefined,
      canShare: () => {
        throw new Error('files not allowed');
      },
    });
    expect(detectCapabilities().shareFiles).toBe(false);

    stubNavigator({
      userAgent: DESKTOP_UA,
      share: async () => undefined,
      canShare: (data: { files?: File[] }) => Array.isArray(data.files) && data.files.length === 1,
    });
    expect(detectCapabilities().shareFiles).toBe(true);
  });

  it('handles a missing navigator and detects wake lock by property presence', () => {
    stubCodecs(true);
    vi.stubGlobal('navigator', undefined);

    const withoutNavigator = detectCapabilities();
    expect(withoutNavigator.opfs).toBe(false);
    expect(withoutNavigator.wakeLock).toBe(false);
    expect(withoutNavigator.shareFiles).toBe(false);
    expect(withoutNavigator.isDesktop).toBe(true);

    stubNavigator({ userAgent: DESKTOP_UA, wakeLock: undefined, storage: {} });
    const withEmptyWakeLock = detectCapabilities();
    expect(withEmptyWakeLock.wakeLock).toBe(true);
    expect(withEmptyWakeLock.opfs).toBe(false);
  });
});
