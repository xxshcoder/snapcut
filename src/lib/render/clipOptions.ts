import type { Clip } from '../../types';

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

/** Speed is clamped defensively because saved projects predate the control. */
export function clipSpeed(clip: Clip): number {
  const speed = clip.speed ?? 1;
  return Number.isFinite(speed) ? clamp(speed, 0.5, 2) : 1;
}

export function clipSourceDuration(clip: Clip): number {
  return Math.max(0.01, clip.end - clip.start);
}

export function clipOutputDuration(clip: Clip): number {
  return clipSourceDuration(clip) / clipSpeed(clip);
}

export function clipVolume(clip: Clip): number {
  const volume = clip.volume ?? 1;
  return Number.isFinite(volume) ? clamp(volume, 0, 1.5) : 1;
}

export function clipFade(clip: Clip, field: 'fadeInSec' | 'fadeOutSec'): number {
  const value = clip[field] ?? 0;
  return Number.isFinite(value) ? clamp(value, 0, 10) : 0;
}
