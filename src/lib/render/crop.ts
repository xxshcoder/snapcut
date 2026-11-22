import type { CropPath } from '../../types';

export type Rect = { x: number; y: number; w: number; h: number };
export type PixelRect = { left: number; top: number; width: number; height: number };

export const TARGET_ASPECT = 9 / 16;

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

export function centeredCrop(sourceW: number, sourceH: number): Rect {
  const sourceAspect = sourceW / Math.max(1, sourceH);
  if (sourceAspect > TARGET_ASPECT) {
    const w = TARGET_ASPECT / sourceAspect;
    return { x: (1 - w) / 2, y: 0, w, h: 1 };
  }
  const h = sourceAspect / TARGET_ASPECT;
  return { x: 0, y: (1 - h) / 2, w: 1, h };
}

/** Interpolate tracked keyframes at time t. */
export function cropAtTime(crop: CropPath, t: number): Rect {
  if (crop.mode === 'static') return { x: crop.x, y: crop.y, w: crop.w, h: crop.h };
  const keys = crop.keyframes;
  if (keys.length === 0) return { x: 0, y: 0, w: 1, h: 1 };
  const first = keys[0];
  if (!first) return { x: 0, y: 0, w: 1, h: 1 };
  if (t <= first.t) return { x: first.x, y: first.y, w: first.w, h: first.h };
  const last = keys.at(-1);
  if (last && t >= last.t) return { x: last.x, y: last.y, w: last.w, h: last.h };
  for (let i = 1; i < keys.length; i++) {
    const a = keys[i - 1];
    const b = keys[i];
    if (!a || !b) continue;
    if (t <= b.t) {
      const span = b.t - a.t || 1;
      const f = (t - a.t) / span;
      return {
        x: a.x + (b.x - a.x) * f,
        y: a.y + (b.y - a.y) * f,
        w: a.w + (b.w - a.w) * f,
        h: a.h + (b.h - a.h) * f,
      };
    }
  }
  return { x: first.x, y: first.y, w: first.w, h: first.h };
}

/** Expand the shorter dimension to exactly 9:16, then clamp inside the frame. */
export function fitCropToFrame(rect: PixelRect, sourceW: number, sourceH: number): PixelRect {
  let width = Math.max(1, rect.width);
  let height = Math.max(1, rect.height);
  if (width / height > TARGET_ASPECT) height = width / TARGET_ASPECT;
  else width = height * TARGET_ASPECT;

  width = Math.min(width, sourceW);
  height = Math.min(height, sourceH);
  let left = Math.max(0, Math.min(rect.left, sourceW - width));
  let top = Math.max(0, Math.min(rect.top, sourceH - height));

  // After clamping, keep the exact 9:16 ratio by shrinking around the centre.
  if (width / height > TARGET_ASPECT) {
    const newWidth = height * TARGET_ASPECT;
    left += (width - newWidth) / 2;
    width = newWidth;
  } else if (width / height < TARGET_ASPECT) {
    const newHeight = width / TARGET_ASPECT;
    top += (height - newHeight) / 2;
    height = newHeight;
  }
  return { left, top, width, height };
}

export function normalizeCrop(rect: Rect, sourceW: number, sourceH: number): Rect {
  const fitted = fitCropToFrame(
    { left: rect.x * sourceW, top: rect.y * sourceH, width: rect.w * sourceW, height: rect.h * sourceH },
    sourceW,
    sourceH,
  );
  return {
    x: clamp01(fitted.left / sourceW),
    y: clamp01(fitted.top / sourceH),
    w: clamp01(fitted.width / sourceW),
    h: clamp01(fitted.height / sourceH),
  };
}

export function cropToPixels(crop: CropPath, sourceW: number, sourceH: number, t = 0): PixelRect {
  const rect = cropAtTime(crop, t);
  return fitCropToFrame(
    { left: rect.x * sourceW, top: rect.y * sourceH, width: rect.w * sourceW, height: rect.h * sourceH },
    sourceW,
    sourceH,
  );
}
