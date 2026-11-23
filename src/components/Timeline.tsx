import { useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from 'react';
import { Icon } from './Icon';
import { LIMITS, RENDER } from '../config';
import type { Clip, FilmstripFrame, FileMeta } from '../types';

type Props = {
  clips: Clip[];
  clip: Clip;
  meta: FileMeta;
  playhead: number;
  selectedIds: string[];
  filmstrip: FilmstripFrame[];
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
  onUpdate: (patch: Partial<Clip>) => void;
  onSplit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onRemoveSilences: () => void;
  onSeek: (time: number) => void;
};

type DragMode = 'start' | 'end' | 'move';
type DragState = {
  mode: DragMode;
  pointerId: number;
  startX: number;
  originStart: number;
  originEnd: number;
};

function clock(value: number): string {
  const total = Math.max(0, Math.floor(value));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
const snap = (value: number): number => Math.round(value * 10) / 10;

/**
 * One usable track: a frame strip for finding the exact cut, one clip bar for
 * selecting/moving/trimming, and nothing else competing for space.
 */
export function Timeline({
  clips,
  clip,
  meta,
  playhead,
  selectedIds,
  filmstrip,
  onSelect,
  onToggle,
  onUpdate,
  onSplit,
  onDuplicate,
  onDelete,
  onRemoveSilences,
  onSeek,
}: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const rulerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const scrubRef = useRef<number | null>(null);
  const [dragging, setDragging] = useState<DragMode | null>(null);

  const viewSpan = Math.max(8, Math.min(meta.durationSec, 30));
  const viewStart = clamp(clip.start - viewSpan * 0.1, 0, Math.max(0, meta.durationSec - viewSpan));
  const viewEnd = Math.min(meta.durationSec, viewStart + viewSpan);
  const pct = (time: number): number => (clamp(time - viewStart, 0, viewSpan) / viewSpan) * 100;
  const firstMark = Math.ceil(viewStart / 5) * 5;
  const rulerMarks = Array.from({ length: Math.floor((viewEnd - firstMark) / 5) + 1 }, (_, i) => firstMark + i * 5)
    .filter((mark) => pct(mark) < 96);

  const deltaSeconds = (clientX: number, originX: number): number => {
    const width = trackRef.current?.getBoundingClientRect().width ?? 0;
    return width > 0 ? ((clientX - originX) / width) * viewSpan : 0;
  };

  const timeAt = (clientX: number): number => {
    const box = trackRef.current?.getBoundingClientRect();
    if (!box || box.width === 0) return playhead;
    return viewStart + clamp((clientX - box.left) / box.width, 0, 1) * viewSpan;
  };

  /** Trims prefer real word boundaries so words are never half cut. */
  const snapWord = (value: number, radius = 0.3): number => {
    let best = value;
    let distance = radius;
    for (const word of clip.words) {
      for (const point of [word.start, word.end]) {
        const delta = Math.abs(point - value);
        if (delta < distance) {
          distance = delta;
          best = point;
        }
      }
    }
    return snap(best);
  };

  const beginDrag = (mode: DragMode) => (event: ReactPointerEvent<HTMLElement>): void => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      mode,
      pointerId: event.pointerId,
      startX: event.clientX,
      originStart: clip.start,
      originEnd: clip.end,
    };
    setDragging(mode);
  };

  const onDragMove = (event: ReactPointerEvent<HTMLElement>): void => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const delta = deltaSeconds(event.clientX, drag.startX);
    const min = LIMITS.minClipSec;

    if (drag.mode === 'start') {
      const value = clamp(drag.originStart + delta, 0, drag.originEnd - min);
      onUpdate({ start: snapWord(value) });
    } else if (drag.mode === 'end') {
      const value = clamp(drag.originEnd + delta, drag.originStart + min, viewEnd);
      onUpdate({ end: snapWord(value) });
    } else {
      const length = drag.originEnd - drag.originStart;
      const value = clamp(drag.originStart + delta, 0, Math.max(0, viewEnd - length));
      const start = snapWord(value);
      onUpdate({ start, end: snap(start + length) });
    }
  };

  const endDrag = (event: ReactPointerEvent<HTMLElement>): void => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragRef.current = null;
    setDragging(null);
  };

  const dragHandlers = {
    onPointerMove: onDragMove,
    onPointerUp: endDrag,
    onPointerCancel: endDrag,
    onLostPointerCapture: endDrag,
  };

  const beginScrub = (event: ReactPointerEvent<HTMLDivElement>): void => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    scrubRef.current = event.pointerId;
    onSeek(snapWord(timeAt(event.clientX)));
  };
  const moveScrub = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (scrubRef.current !== event.pointerId) return;
    onSeek(snapWord(timeAt(event.clientX)));
  };
  const endScrub = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (scrubRef.current !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    scrubRef.current = null;
  };

  /** A vertical wheel scrolls the frame strip sideways; touch uses native pan-x. */
  const onFilmstripWheel = (event: ReactWheelEvent<HTMLDivElement>): void => {
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
    event.currentTarget.scrollLeft += event.deltaY;
  };

  const canSplit = playhead > clip.start && playhead < clip.end;

  return (
    <section className="panel flex min-h-0 min-w-0 flex-1 flex-col gap-2 overflow-hidden p-2 sm:p-3" aria-label="Timeline">
      <div className="flex shrink-0 items-center justify-between gap-3">
        <h2 className="shrink-0 text-xs font-semibold tracking-wide">Suggested clips ({clips.length})</h2>
        <div className="flex items-center gap-1">
          <button
            className="edit-icon-btn"
            onClick={onSplit}
            disabled={!canSplit}
            aria-label="Split clip"
            title="Split the active clip at the playhead"
          >
            <Icon name="scissors" size={14} />
          </button>
          <button
            className="edit-icon-btn"
            onClick={onDuplicate}
            aria-label="Duplicate clip"
            title="Duplicate the active clip"
          >
            <Icon name="copy" size={14} />
          </button>
          <button
            className="edit-icon-btn"
            onClick={onRemoveSilences}
            aria-label="Remove silences"
            title="Cut long pauses into separate clips"
          >
            <Icon name="silence" size={14} />
          </button>
          <button
            className="edit-icon-btn"
            onClick={onDelete}
            disabled={clips.length <= 1}
            aria-label="Delete clip"
            title="Delete the active clip"
          >
            <Icon name="trash" size={14} />
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-1 rounded-2xl bg-[#0e1124] p-2">
        <div
          ref={rulerRef}
          className="relative h-6 shrink-0 cursor-ew-resize border-b border-[var(--divider)]"
          aria-label="Scrub playhead"
          onPointerDown={beginScrub}
          onPointerMove={moveScrub}
          onPointerUp={endScrub}
          onPointerCancel={endScrub}
          onLostPointerCapture={endScrub}
        >
          {rulerMarks.map((mark) => (
            <span
              key={mark}
              className="muted pointer-events-none absolute top-0.5 -translate-x-1/2 text-[10px] tabular-nums"
              style={{ left: `${pct(mark)}%` }}
            >
              {mark === 0 ? '00:00s' : clock(mark)}
            </span>
          ))}
        </div>

        <div ref={trackRef} className="relative flex min-h-0 min-w-0 flex-1 flex-col" style={{ touchAction: 'none' }}>
          {/* Frame strip: swipe or wheel through frames, tap one to seek there. */}
          <div className="relative h-10 shrink-0 border-b border-[var(--divider)] bg-black/20">
            <div
              className="absolute inset-0 overflow-x-auto overflow-y-hidden overscroll-x-contain"
              onWheel={onFilmstripWheel}
              role="group"
              aria-label="Frame strip — swipe to browse"
            >
              <div
                className="flex h-full w-max min-w-full snap-x snap-mandatory items-stretch gap-[2px] p-1"
                style={{ touchAction: 'pan-x' }}
              >
                {filmstrip.length > 0 ? (
                  filmstrip.map((frame) => {
                    const frameNumber = Math.round(frame.timeSec * RENDER.frameRate);
                    const selected = Math.abs(playhead - frame.timeSec) < 0.5 / RENDER.frameRate;
                    return (
                      <button
                        key={`${frame.timeSec}-${frame.url}`}
                        className={`h-full w-14 shrink-0 snap-center overflow-hidden rounded border transition-all ${
                          selected ? 'border-[var(--accent)] ring-2 ring-[var(--accent)]/60' : 'border-white/10 hover:border-white/60'
                        }`}
                        onClick={() => onSeek(frame.timeSec)}
                        aria-label={`Seek to frame ${frameNumber}`}
                        title={`Frame ${frameNumber} · ${clock(frame.timeSec)}`}
                      >
                        <img src={frame.url} alt="" className="h-full w-full object-cover" draggable={false} />
                      </button>
                    );
                  })
                ) : (
                  <span className="flex h-full w-full items-center justify-center text-[10px] muted">
                    {filmstrip.length === 0 ? 'Decoding source frames…' : 'No frames decoded'}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* One clip bar: drag the body to move, the ends to trim. */}
          <div className="relative min-h-9 flex-1 bg-white/[0.03]">
            {clips.map((item, index) => {
              const active = item.id === clip.id;
              const isDragging = dragging !== null && active;
              return (
                <div
                  key={item.id}
                  className={`absolute inset-y-0 ${active ? 'z-10' : 'z-[5]'}`}
                  style={{
                    left: `${pct(item.start)}%`,
                    width: `${Math.max(3, pct(item.end) - pct(item.start))}%`,
                    touchAction: 'none',
                  }}
                  onPointerDown={active ? beginDrag('move') : undefined}
                  {...(active ? dragHandlers : {})}
                >
                  <div
                    className={`absolute inset-x-0 inset-y-1 rounded-lg border-2 ${
                      active
                        ? `border-[var(--accent)] bg-[var(--accent)]/15 ${isDragging ? 'shadow-lg' : ''}`
                        : 'border-white/25 bg-white/[0.07]'
                    } ${dragging === 'move' && active ? 'cursor-grabbing' : active ? 'cursor-grab' : ''}`}
                  />
                  <div className="absolute left-4 right-4 top-1 flex min-w-0 items-center gap-1 rounded-md bg-black/70 px-1 py-0.5 text-[10px] font-semibold text-white">
                    <input
                      type="checkbox"
                      className="h-3 w-3 shrink-0 accent-[#1f6bff]"
                      checked={selectedIds.includes(item.id)}
                      onChange={() => onToggle(item.id)}
                      onClick={(event) => event.stopPropagation()}
                      onPointerDown={(event) => event.stopPropagation()}
                      aria-label={`Export clip ${index + 1}`}
                    />
                    <button
                      className="min-w-0 truncate text-left"
                      onClick={() => onSelect(item.id)}
                      onPointerDown={(event) => event.stopPropagation()}
                      aria-label={item.title}
                      title={item.title}
                    >
                      {item.title}
                    </button>
                  </div>
                  {active ? (
                    <>
                      <button
                        className="absolute inset-y-0 left-0 z-20 w-3 cursor-ew-resize rounded-l-lg bg-white/70 before:absolute before:inset-y-0 before:-inset-x-1 before:content-['']"
                        onPointerDown={beginDrag('start')}
                        {...dragHandlers}
                        aria-label="Drag clip start"
                        title="Drag to change start"
                      />
                      <button
                        className="absolute inset-y-0 right-0 z-20 w-3 cursor-ew-resize rounded-r-lg bg-white/70 before:absolute before:inset-y-0 before:-inset-x-1 before:content-['']"
                        onPointerDown={beginDrag('end')}
                        {...dragHandlers}
                        aria-label="Drag clip end"
                        title="Drag to change end"
                      />
                    </>
                  ) : null}
                </div>
              );
            })}
          </div>

          {/* One playhead across both rows. */}
          <div
            className="pointer-events-none absolute inset-y-0 z-30 w-0.5 bg-white shadow-[0_0_10px_rgba(255,255,255,0.6)]"
            style={{ left: `${pct(playhead)}%` }}
          >
            <span
              className={`absolute top-0 rounded-md border border-white/40 bg-white px-1.5 py-0.5 text-[10px] font-bold text-black shadow tabular-nums ${
                pct(playhead) > 85 ? 'right-1' : 'left-1'
              }`}
            >
              {clock(playhead)}
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
