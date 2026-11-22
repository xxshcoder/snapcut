import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Icon } from './Icon';
import { LIMITS } from '../config';
import type { Clip, FileMeta } from '../types';

type Props = {
  clips: Clip[];
  clip: Clip;
  meta: FileMeta;
  playhead: number;
  selectedIds: string[];
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
  onUpdate: (patch: Partial<Clip>) => void;
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
const WAVEFORM = Array.from({ length: 120 }, (_, i) => 20 + Math.abs(Math.sin(i * 1.7) * 45) + (i % 7) * 3);

export function Timeline({ clips, clip, meta, playhead, selectedIds, onSelect, onToggle, onUpdate }: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const [dragging, setDragging] = useState<DragMode | null>(null);

  const viewEnd = Math.min(meta.durationSec, Math.max(30, clip.end + 6));
  const range = Math.max(0.001, viewEnd);
  const pct = (time: number): number => (clamp(time, 0, viewEnd) / range) * 100;
  const rulerMarks = Array.from({ length: Math.floor(viewEnd / 5) + 1 }, (_, i) => i * 5)
    .filter((mark) => pct(mark) < 96);

  /** Convert a horizontal pointer move into seconds using the real track width. */
  const deltaSeconds = (clientX: number, originX: number): number => {
    const width = trackRef.current?.getBoundingClientRect().width ?? 0;
    return width > 0 ? ((clientX - originX) / width) * viewEnd : 0;
  };

  const beginDrag = (mode: DragMode) => (event: ReactPointerEvent<HTMLElement>): void => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const state: DragState = {
      mode,
      pointerId: event.pointerId,
      startX: event.clientX,
      originStart: clip.start,
      originEnd: clip.end,
    };
    dragRef.current = state;
    setDragging(mode);
  };

  const onDragMove = (event: ReactPointerEvent<HTMLElement>): void => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const delta = deltaSeconds(event.clientX, drag.startX);
    const min = LIMITS.minClipSec;

    if (drag.mode === 'start') {
      onUpdate({ start: snap(clamp(drag.originStart + delta, 0, drag.originEnd - min)) });
    } else if (drag.mode === 'end') {
      onUpdate({ end: snap(clamp(drag.originEnd + delta, drag.originStart + min, viewEnd)) });
    } else {
      const length = drag.originEnd - drag.originStart;
      const start = snap(clamp(drag.originStart + delta, 0, Math.max(0, viewEnd - length)));
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
  };

  return (
    <section className="panel flex min-h-0 flex-1 flex-col gap-1.5 overflow-hidden p-2 sm:p-3" aria-label="Timeline">
      <div className="flex shrink-0 items-center justify-between gap-2">
        <h2 className="text-xs font-semibold tracking-wide">Suggested clips ({clips.length})</h2>
        <span className="muted hidden text-xs sm:inline">Drag handles to trim · drag clip to move</span>
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden rounded-2xl bg-[#0e1124]">
        {/* Track labels */}
        <div className="flex w-[110px] shrink-0 flex-col border-r border-[var(--divider)] text-xs xl:w-[220px]">
          {/* Header matches the ruler height so every label lines up with its lane. */}
          <div className="muted flex h-6 shrink-0 items-center border-b border-[var(--divider)] px-2 text-[10px] font-bold uppercase tracking-wider sm:px-3">
            Tracks
          </div>
          <div className="flex h-9 shrink-0 items-center gap-2 border-b border-[var(--divider)] px-2 sm:px-3">
            <Icon name="image" size={14} /> <span className="truncate">Sunset.jpg</span>
          </div>
          <div className="flex h-9 shrink-0 items-center gap-2 border-b border-[var(--divider)] bg-[var(--chip)] px-2 font-semibold">
            <Icon name="text" size={14} /> Text
            <span className="ml-auto rounded-full bg-[var(--badge-bg)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--badge-text)]">
              24pt
            </span>
          </div>
          <div className="hidden shrink-0 border-b border-[var(--divider)] px-2 [@media(min-height:820px)]:block">
            <div className="flex h-7 items-center gap-2 pl-4 text-[11px] muted">font-size</div>
            <div className="flex h-6 items-center gap-2 pl-4 text-[11px] muted">
              <Icon name="plus" size={11} /> Add property
            </div>
          </div>
          <div className="flex min-h-9 flex-1 items-center gap-2 px-2 sm:px-3">
            <Icon name="music" size={14} /> <span className="truncate">Roll.mp3</span>
          </div>
        </div>

        {/* Ruler + lanes share the same width, so marks line up with clips. */}
        <div className="relative flex min-h-0 flex-1 flex-col">
          <div className="relative h-6 shrink-0 border-b border-[var(--divider)]">
            {rulerMarks.map((mark) => (
              <span
                key={mark}
                className="muted absolute top-0.5 -translate-x-1/2 text-[10px] tabular-nums first:translate-x-0"
                style={{ left: `${pct(mark)}%` }}
              >
                {mark === 0 ? '00:00s' : `00:${String(mark).padStart(2, '0')}`}
              </span>
            ))}
          </div>

          <div ref={trackRef} className="relative flex min-h-0 flex-1 flex-col" style={{ touchAction: 'none' }}>
            {/* Image clip */}
            <div className="relative h-9 shrink-0 border-b border-[var(--divider)]">
              <div
                className="absolute top-1 flex h-6 items-center gap-1 rounded-lg bg-[var(--red)] px-1 text-[10px] font-bold text-[#2a0b08]"
                style={{ left: '0%', width: `${pct(Math.min(12, viewEnd))}%` }}
              >
                <Icon name="minus" size={10} />
                <span className="truncate">Image</span>
              </div>
            </div>

            {/* Text clips: drag the body to move, drag the edge handles to trim. */}
            <div className="relative h-9 shrink-0 border-b border-[var(--divider)]">
              {clips.map((item, index) => {
                const active = item.id === clip.id;
                const left = pct(item.start);
                const width = Math.max(3, pct(item.end) - left);
                const isDragging = dragging !== null && active;
                return (
                  <div
                    key={item.id}
                    className={`absolute top-1 flex h-6 items-center gap-1 overflow-visible rounded-lg px-1 text-[10px] font-bold ${
                      active
                        ? `bg-[var(--green)] text-[#062f16] ring-2 ring-white/70 ${dragging === 'move' ? 'cursor-grabbing' : 'cursor-grab'}`
                        : 'bg-[#3fbf66] text-[#062f16]'
                    } ${isDragging ? 'shadow-lg' : ''}`}
                    style={{ left: `${left}%`, width: `${width}%`, touchAction: 'none' }}
                    onPointerDown={active ? beginDrag('move') : undefined}
                    {...(active ? dragHandlers : {})}
                  >
                    <input
                      type="checkbox"
                      className="relative z-10 h-3.5 w-3.5 shrink-0 accent-[#1f6bff]"
                      checked={selectedIds.includes(item.id)}
                      onChange={() => onToggle(item.id)}
                      onClick={(event) => event.stopPropagation()}
                      onPointerDown={(event) => event.stopPropagation()}
                      aria-label={`Export clip ${index + 1}`}
                    />
                    <button
                      className="relative z-10 min-w-0 flex-1 truncate text-left"
                      onClick={() => onSelect(item.id)}
                      onPointerDown={(event) => event.stopPropagation()}
                      aria-label={item.title}
                      title={item.title}
                    >
                      {item.title}
                    </button>
                    {active ? (
                      <>
                        <button
                          className="relative z-20 flex h-6 w-6 shrink-0 cursor-ew-resize items-center justify-center rounded bg-white/85 before:absolute before:-inset-x-3 before:-inset-y-3 before:content-['']"
                          onPointerDown={beginDrag('start')}
                          {...dragHandlers}
                          aria-label="Drag clip start"
                          title="Drag to change start"
                        >
                          <Icon name="minus" size={12} />
                        </button>
                        <button
                          className="relative z-20 flex h-6 w-6 shrink-0 cursor-ew-resize items-center justify-center rounded-full border border-white bg-white/85 before:absolute before:-inset-x-3 before:-inset-y-3 before:content-['']"
                          onPointerDown={beginDrag('end')}
                          {...dragHandlers}
                          aria-label="Drag clip end"
                          title="Drag to change end"
                        >
                          <Icon name="plus" size={12} />
                        </button>
                      </>
                    ) : null}
                  </div>
                );
              })}
            </div>

            {/* Mirrors the expanded text-property rows in the label column. */}
            <div className="hidden shrink-0 [@media(min-height:820px)]:block">
              <div className="h-7 border-b border-[var(--divider)]" />
              <div className="h-6 border-b border-[var(--divider)]" />
            </div>

            {/* Audio waveform fills the remaining track space. */}
            <div className="relative min-h-9 flex-1 overflow-hidden bg-white/[0.04]">
              <div className="absolute inset-0 flex items-center gap-[2px] px-1">
                {WAVEFORM.map((height, i) => (
                  <span key={i} className="flex-1 rounded-full bg-white/70" style={{ height: `${height}%` }} />
                ))}
              </div>
            </div>

            {/* Playhead spans ruler + lanes; label flips side near the end. */}
            <div
              className="pointer-events-none absolute inset-y-0 z-10 w-0.5 bg-white shadow-[0_0_10px_rgba(255,255,255,0.6)]"
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
      </div>
    </section>
  );
}
