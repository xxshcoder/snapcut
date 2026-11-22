import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { LIMITS } from '../config';
import type { Word } from '../types';

type Props = {
  start: number;
  end: number;
  duration: number;
  words: Word[];
  onChange: (start: number, end: number) => void;
};

type Handle = 'start' | 'end';

function formatTime(value: number): string {
  const rounded = Math.max(0, value);
  return `${Math.floor(rounded / 60)}:${String(Math.floor(rounded % 60)).padStart(2, '0')}.${String(Math.floor((rounded % 1) * 10))}`;
}

export function TrimBar({ start, end, duration, words, onChange }: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<Handle | null>(null);

  const snap = (value: number): number => {
    let nearest = value;
    let distance = 1.6;
    for (const word of words) {
      for (const candidate of [word.start, word.end]) {
        const delta = Math.abs(candidate - value);
        if (delta < distance) {
          distance = delta;
          nearest = candidate;
        }
      }
    }
    return Math.round(nearest * 100) / 100;
  };

  const timeFromPointer = (clientX: number): number => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return 0;
    return Math.max(0, Math.min(duration, ((clientX - rect.left) / rect.width) * duration));
  };

  const apply = (handle: Handle, raw: number): void => {
    const value = snap(raw);
    if (handle === 'start') {
      const next = Math.max(0, Math.min(value, end - LIMITS.minClipSec, start + LIMITS.maxClipSec));
      onChange(Math.round(next * 100) / 100, end);
    } else {
      const next = Math.min(duration, Math.max(value, start + LIMITS.minClipSec, end - LIMITS.maxClipSec));
      onChange(start, Math.round(next * 100) / 100);
    }
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!dragging) return;
    apply(dragging, timeFromPointer(event.clientX));
  };

  const beginDrag = (handle: Handle) => (event: ReactPointerEvent<HTMLButtonElement>): void => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(handle);
  };

  /** Clicking anywhere on the track jumps the nearest handle there. */
  const onTrackPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if ((event.target as HTMLElement).closest('button')) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const value = timeFromPointer(event.clientX);
    const handle: Handle = Math.abs(value - start) <= Math.abs(value - end) ? 'start' : 'end';
    apply(handle, value);
    setDragging(handle);
  };

  const stopDrag = (): void => setDragging(null);
  const left = duration > 0 ? (start / duration) * 100 : 0;
  const width = duration > 0 ? ((end - start) / duration) * 100 : 0;

  return (
    <div>
      <div className="muted mb-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
        <label className="flex items-center gap-1">
          Start
          <input
            type="number"
            className="field w-20 px-2 py-1 text-xs"
            min={0}
            max={Math.max(0, end - LIMITS.minClipSec)}
            step={0.1}
            value={Math.round(start * 10) / 10}
            onChange={(event) => {
              const value = Number(event.target.value);
              if (Number.isFinite(value)) apply('start', value);
            }}
            aria-label="Clip start time in seconds"
          />
        </label>
        <label className="flex items-center gap-1">
          End
          <input
            type="number"
            className="field w-20 px-2 py-1 text-xs"
            min={start + LIMITS.minClipSec}
            max={duration}
            step={0.1}
            value={Math.round(end * 10) / 10}
            onChange={(event) => {
              const value = Number(event.target.value);
              if (Number.isFinite(value)) apply('end', value);
            }}
            aria-label="Clip end time in seconds"
          />
        </label>
        <span className="ml-auto">Length {formatTime(end - start)}</span>
      </div>
      <div
        ref={trackRef}
        className="relative h-14 cursor-pointer touch-none select-none rounded-lg border border-[var(--border)] bg-[linear-gradient(90deg,#222238_25%,#2d2d45_50%,#222238_75%)] bg-[length:16px_100%]"
        onPointerDown={onTrackPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={stopDrag}
        onPointerCancel={stopDrag}
        role="group"
        aria-label="Trim clip timeline"
      >
        <div
          className="pointer-events-none absolute inset-y-0 border-x-2 border-[var(--accent)] bg-[color:var(--accent)]/20"
          style={{ left: `${left}%`, width: `${width}%` }}
        />
        <button
          type="button"
          className="absolute top-1/2 h-11 w-11 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[var(--accent)] bg-[var(--surface)] text-xs font-bold shadow-lg"
          style={{ left: `${left}%` }}
          onPointerDown={beginDrag('start')}
          aria-label="Drag clip start"
        >
          ⟨
        </button>
        <button
          type="button"
          className="absolute top-1/2 h-11 w-11 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[var(--accent)] bg-[var(--surface)] text-xs font-bold shadow-lg"
          style={{ left: `${left + width}%` }}
          onPointerDown={beginDrag('end')}
          aria-label="Drag clip end"
        >
          ⟩
        </button>
      </div>
    </div>
  );
}
