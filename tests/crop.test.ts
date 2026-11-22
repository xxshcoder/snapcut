import { describe, expect, it } from 'vitest';
import {
  TARGET_ASPECT,
  centeredCrop,
  cropAtTime,
  cropToPixels,
  fitCropToFrame,
  normalizeCrop,
} from '../src/lib/render/crop';
import type { CropPath } from '../src/types';

const STATIC: CropPath = { mode: 'static', x: 0, y: 0, w: 1, h: 1 };

function expectPortrait(width: number, height: number): void {
  expect(width / height).toBeCloseTo(TARGET_ASPECT, 6);
}

describe('centeredCrop', () => {
  it('produces a centered 9:16 window from a 16:9 source', () => {
    const crop = centeredCrop(1920, 1080);

    expect(crop.w).toBeCloseTo(0.31640625, 6);
    expect(crop.x).toBeCloseTo(0.341796875, 6);
    expect(crop.y).toBe(0);
    expect(crop.h).toBe(1);
    expectPortrait(crop.w * 1920, crop.h * 1080);
  });

  it('uses the full frame when the source is already 9:16', () => {
    expect(centeredCrop(1080, 1920)).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });

  it('centers horizontally on a portrait-but-too-wide source', () => {
    const crop = centeredCrop(900, 1200); // 3:4, wider than 9:16

    expect(crop.h).toBe(1);
    expect(crop.w).toBeCloseTo(0.75, 6);
    expect(crop.x).toBeCloseTo(0.125, 6);
    expect(crop.y).toBe(0);
  });
});

describe('cropAtTime', () => {
  it('returns the static crop unchanged', () => {
    const crop: CropPath = { mode: 'static', x: 0.1, y: 0.2, w: 0.3, h: 0.4 };

    expect(cropAtTime(crop, 0)).toEqual({ x: 0.1, y: 0.2, w: 0.3, h: 0.4 });
    expect(cropAtTime(crop, 123)).toEqual({ x: 0.1, y: 0.2, w: 0.3, h: 0.4 });
  });

  it('linearly interpolates tracked keyframes and clamps outside their range', () => {
    const crop: CropPath = {
      mode: 'tracked',
      keyframes: [
        { t: 0, x: 0, y: 0, w: 1, h: 1 },
        { t: 1, x: 0.4, y: 0.2, w: 0.2, h: 0.6 },
      ],
    };

    expect(cropAtTime(crop, 0.5)).toEqual({ x: 0.2, y: 0.1, w: 0.6, h: 0.8 });
    expect(cropAtTime(crop, -5)).toEqual({ x: 0, y: 0, w: 1, h: 1 });
    expect(cropAtTime(crop, 9)).toEqual({ x: 0.4, y: 0.2, w: 0.2, h: 0.6 });
  });

  it('falls back to the full frame when there are no keyframes', () => {
    expect(cropAtTime({ mode: 'tracked', keyframes: [] }, 3)).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });
});

describe('fitCropToFrame / normalizeCrop / cropToPixels', () => {
  it('expands the shorter dimension to an exact 9:16 ratio', () => {
    const fitted = fitCropToFrame({ left: 100, top: 0, width: 200, height: 100 }, 400, 400);

    expect(fitted).toEqual({ left: 100, top: 0, width: 200, height: 200 / TARGET_ASPECT });
    expectPortrait(fitted.width, fitted.height);
  });

  it('shrinks a full-frame 16:9 crop around its centre', () => {
    const fitted = fitCropToFrame({ left: 0, top: 0, width: 1920, height: 1080 }, 1920, 1080);

    expect(fitted.left).toBeCloseTo(656.25, 5);
    expect(fitted.top).toBe(0);
    expect(fitted.width).toBeCloseTo(607.5, 5);
    expect(fitted.height).toBe(1080);
    expectPortrait(fitted.width, fitted.height);
  });

  it('keeps the crop inside the frame', () => {
    const fitted = fitCropToFrame({ left: -100, top: -100, width: 300, height: 300 }, 400, 400);

    expect(fitted.left).toBeGreaterThanOrEqual(0);
    expect(fitted.top).toBeGreaterThanOrEqual(0);
    expect(fitted.left + fitted.width).toBeLessThanOrEqual(400.0001);
    expect(fitted.top + fitted.height).toBeLessThanOrEqual(400.0001);
    expectPortrait(fitted.width, fitted.height);
  });

  it('normalizes pixel crops to 0-1 coordinates that still describe 9:16', () => {
    const normalized = normalizeCrop({ x: 0, y: 0, w: 1, h: 1 }, 1920, 1080);

    expect(normalized.x).toBeCloseTo(0.341796875, 6);
    expect(normalized.w).toBeCloseTo(0.31640625, 6);
    expect(normalized.y).toBe(0);
    expect(normalized.h).toBe(1);
    expectPortrait(normalized.w * 1920, normalized.h * 1080);
    expect(Object.values(normalized).every((value) => value >= 0 && value <= 1)).toBe(true);
  });

  it('converts static and tracked crops to portrait pixel rectangles', () => {
    const staticPixels = cropToPixels(STATIC, 1920, 1080, 0);
    expect(staticPixels.left).toBeCloseTo(656.25, 5);
    expect(staticPixels.width).toBeCloseTo(607.5, 5);
    expectPortrait(staticPixels.width, staticPixels.height);

    const tracked: CropPath = {
      mode: 'tracked',
      keyframes: [
        { t: 0, x: 0.2, y: 0.1, w: 0.6, h: 0.8 },
        { t: 2, x: 0.4, y: 0.1, w: 0.4, h: 0.8 },
      ],
    };
    const mid = cropToPixels(tracked, 1920, 1080, 1);
    expect(mid.left).toBeCloseTo(752.25, 4);
    expect(mid.width).toBeCloseTo(607.5, 4);
    expect(mid.top).toBe(0);
    expectPortrait(mid.width, mid.height);

    const late = cropToPixels(tracked, 1920, 1080, 5);
    expect(late.left).toBeCloseTo(848.25, 4);
    expectPortrait(late.width, late.height);
  });
});
