import { useRef, type PointerEvent as ReactPointerEvent, type WheelEvent } from 'react';
import { cropAtTime, fitCropToFrame, normalizeCrop, type Rect } from '../lib/render/crop';
import type { CropPath } from '../types';

type Bounds = { left: number; top: number; width: number; height: number };

type Props = {
  crop: CropPath;
  sourceWidth: number;
  sourceHeight: number;
  time?: number;
  /** Displayed video rectangle inside the letterboxed preview box, in CSS pixels. */
  bounds?: Bounds;
  onChange: (crop: CropPath) => void;
};

type DragState = { x: number; y: number; pointerX: number; pointerY: number };
type TouchPoint = { x: number; y: number };

function currentRect(crop: CropPath, time: number): Rect {
  return cropAtTime(crop, time);
}

export function CropBox({ crop, sourceWidth, sourceHeight, time = 0, bounds, onChange }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const touchesRef = useRef(new Map<number, TouchPoint>());
  const pinchRef = useRef<number | null>(null);
  const rect = currentRect(crop, time);
  const cropStyle = bounds && bounds.width > 0 && bounds.height > 0
    ? {
        left: `${bounds.left + rect.x * bounds.width}px`,
        top: `${bounds.top + rect.y * bounds.height}px`,
        width: `${rect.w * bounds.width}px`,
        height: `${rect.h * bounds.height}px`,
      }
    : {
        left: `${rect.x * 100}%`,
        top: `${rect.y * 100}%`,
        width: `${rect.w * 100}%`,
        height: `${rect.h * 100}%`,
      };

  const commit = (next: Rect): void => {
    const normalized = normalizeCrop(next, sourceWidth, sourceHeight);
    onChange({ mode: 'static', ...normalized });
  };

  const zoom = (factor: number): void => {
    const centerX = rect.x + rect.w / 2;
    const centerY = rect.y + rect.h / 2;
    const pixelWidth = rect.w * sourceWidth * factor;
    const maxPixelWidth = Math.min(sourceWidth, sourceHeight * (9 / 16));
    const nextPixelWidth = Math.max(sourceWidth * 0.1, Math.min(maxPixelWidth, pixelWidth));
    const nextW = nextPixelWidth / sourceWidth;
    const nextH = nextPixelWidth / (9 / 16) / sourceHeight;
    const next: Rect = { x: centerX - nextW / 2, y: centerY - nextH / 2, w: nextW, h: nextH };
    const fitted = fitCropToFrame(
      { left: next.x * sourceWidth, top: next.y * sourceHeight, width: next.w * sourceWidth, height: next.h * sourceHeight },
      sourceWidth,
      sourceHeight,
    );
    commit({
      x: fitted.left / sourceWidth,
      y: fitted.top / sourceHeight,
      w: fitted.width / sourceWidth,
      h: fitted.height / sourceHeight,
    });
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    event.currentTarget.setPointerCapture(event.pointerId);
    touchesRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (touchesRef.current.size === 2) {
      const [a, b] = [...touchesRef.current.values()];
      if (a && b) pinchRef.current = Math.hypot(a.x - b.x, a.y - b.y);
      return;
    }
    dragRef.current = { x: rect.x, y: rect.y, pointerX: event.clientX, pointerY: event.clientY };
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!touchesRef.current.has(event.pointerId)) return;
    touchesRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (touchesRef.current.size === 2) {
      const [a, b] = [...touchesRef.current.values()];
      if (!a || !b) return;
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchRef.current && pinchRef.current > 0) zoom(distance / pinchRef.current);
      pinchRef.current = distance;
      return;
    }
    const drag = dragRef.current;
    const area = bounds ?? rootRef.current?.getBoundingClientRect();
    if (!drag || !area || area.width === 0 || area.height === 0) return;
    commit({
      ...rect,
      x: drag.x + (event.clientX - drag.pointerX) / area.width,
      y: drag.y + (event.clientY - drag.pointerY) / area.height,
    });
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>): void => {
    touchesRef.current.delete(event.pointerId);
    dragRef.current = null;
    pinchRef.current = null;
  };

  const onWheel = (event: WheelEvent<HTMLDivElement>): void => {
    event.preventDefault();
    zoom(event.deltaY > 0 ? 1.08 : 0.92);
  };

  return (
    <div ref={rootRef} className="pointer-events-none absolute inset-0" aria-label="Crop area">
      <div
        className="pointer-events-auto absolute cursor-grab touch-none rounded-md border border-[var(--accent)] shadow-[0_0_0_9999px_rgba(0,0,0,0.35)] active:cursor-grabbing"
        style={cropStyle}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
      >
        <div className="absolute inset-x-0 top-1/2 h-px bg-white/30" />
        <div className="absolute inset-y-0 left-1/2 w-px bg-white/30" />
      </div>
      <div className="pointer-events-auto absolute bottom-2 left-2 flex gap-2">
        <button className="btn px-2 py-1 text-xs" onClick={() => zoom(0.85)} aria-label="Zoom in">+</button>
        <button className="btn px-2 py-1 text-xs" onClick={() => zoom(1.18)} aria-label="Zoom out">−</button>
      </div>
    </div>
  );
}
