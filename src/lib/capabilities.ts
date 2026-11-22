import type { Capabilities } from '../types';

type GlobalWithCodecs = typeof globalThis & {
  VideoEncoder?: { isConfigSupported?: unknown };
  VideoDecoder?: unknown;
  AudioEncoder?: unknown;
  AudioDecoder?: unknown;
  OffscreenCanvas?: unknown;
};

function hasShareWithFiles(): boolean {
  if (typeof navigator === 'undefined') return false;
  if (typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function') return false;
  try {
    const probe = new File(['x'], 'snapcut-probe.txt', { type: 'text/plain' });
    return navigator.canShare({ files: [probe] });
  } catch {
    return false;
  }
}

export function detectCapabilities(): Capabilities {
  const g = globalThis as GlobalWithCodecs;
  const userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(userAgent);
  const videoEncoder = typeof g.VideoEncoder !== 'undefined';
  const videoDecoder = typeof g.VideoDecoder !== 'undefined';
  const audioEncoder = typeof g.AudioEncoder !== 'undefined';
  const audioDecoder = typeof g.AudioDecoder !== 'undefined';
  const offscreenCanvas = typeof g.OffscreenCanvas !== 'undefined';
  const opfs = typeof navigator !== 'undefined' && typeof navigator.storage?.getDirectory === 'function';
  const wakeLock = typeof navigator !== 'undefined' && 'wakeLock' in navigator;

  const missing: string[] = [];
  if (!videoDecoder) missing.push('VideoDecoder');
  if (!videoEncoder) missing.push('VideoEncoder');
  if (!audioDecoder) missing.push('AudioDecoder');
  if (!audioEncoder) missing.push('AudioEncoder');
  if (!offscreenCanvas) missing.push('OffscreenCanvas');

  return {
    videoEncoder,
    videoDecoder,
    audioEncoder,
    audioDecoder,
    opfs,
    wakeLock,
    shareFiles: hasShareWithFiles(),
    offscreenCanvas,
    mediabunny: true,
    ffmpegFallback: !isMobile && typeof window !== 'undefined',
    isMobile,
    isDesktop: !isMobile,
    missing,
  };
}

export function describeCapabilities(caps: Capabilities): string {
  if (caps.missing.length === 0) return 'All required browser features are available.';
  return `Missing: ${caps.missing.join(', ')}.`;
}
