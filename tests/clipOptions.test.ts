import { describe, expect, it } from 'vitest';
import { clipFade, clipOutputDuration, clipSourceDuration, clipSpeed, clipVolume } from '../src/lib/render/clipOptions';
import type { Clip } from '../src/types';

const base: Clip = {
  id: 'clip-1',
  start: 2,
  end: 12,
  title: 'Title',
  hook: 'Hook',
  score: 80,
  crop: { mode: 'static', x: 0, y: 0, w: 0.3, h: 0.5 },
  captionsEnabled: true,
  captionStyle: 'bold-pop',
  words: [],
};

describe('clip option defaults', () => {
  it('keeps legacy clips unchanged', () => {
    expect(clipSpeed(base)).toBe(1);
    expect(clipVolume(base)).toBe(1);
    expect(clipFade(base, 'fadeInSec')).toBe(0);
    expect(clipFade(base, 'fadeOutSec')).toBe(0);
    expect(clipSourceDuration(base)).toBe(10);
    expect(clipOutputDuration(base)).toBe(10);
  });

  it('clamps out-of-range saved values', () => {
    expect(clipSpeed({ ...base, speed: 9 })).toBe(2);
    expect(clipSpeed({ ...base, speed: 0.1 })).toBe(0.5);
    expect(clipSpeed({ ...base, speed: Number.NaN })).toBe(1);
    expect(clipVolume({ ...base, volume: -2 })).toBe(0);
    expect(clipVolume({ ...base, volume: 9 })).toBe(1.5);
    expect(clipFade({ ...base, fadeInSec: 99 }, 'fadeInSec')).toBe(10);
  });

  it('scales output duration inversely to speed', () => {
    expect(clipOutputDuration({ ...base, speed: 2 })).toBe(5);
    expect(clipOutputDuration({ ...base, speed: 0.5 })).toBe(20);
  });
});
