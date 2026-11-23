import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { CropBox } from './CropBox';
import { Icon, type IconName } from './Icon';
import { RENDER } from '../config';
import { isEditableTarget } from '../lib/keyboard';
import { centeredCrop, cropAtTime, cropToPixels, normalizeCrop } from '../lib/render/crop';
import { drawCaptions } from '../lib/render/captions';
import { clipSpeed } from '../lib/render/clipOptions';
import type { CaptionStyleId, Clip, FileMeta, Word } from '../types';

type Props = {
  clip: Clip;
  meta: FileMeta;
  objectUrl: string;
  transcriptWords: Word[];
  onUpdate: (patch: Partial<Clip>) => void;
  onTimeChange: (time: number) => void;
  /** Lets the timeline playhead seek the real video element. */
  registerSeek?: (fn: ((time: number) => void) | null) => void;
  onCutAtFrame: () => void;
  canCut: boolean;
};

const PREVIEW_WIDTH = 540;
const PREVIEW_HEIGHT = 960;
const TICKS = 12;

type VideoBox = { left: number; top: number; width: number; height: number };
type RailDrag = { pointerId: number; startY: number; startTop: number };

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
/** Every seek lands on a real frame boundary so the cut point is unambiguous. */
const frameTime = (time: number): number => Math.round(time * RENDER.frameRate) / RENDER.frameRate;

/** Only tools that change the actual edit are shown — no decorative buttons. */
type ToolId = 'crop' | 'text';
const TOOLS: { id: ToolId; icon: IconName; label: string }[] = [
  { id: 'crop', icon: 'crop', label: 'Crop' },
  { id: 'text', icon: 'text', label: 'Text' },
];

const STYLE_COLORS: Record<CaptionStyleId, string> = {
  'bold-pop': '#ffffff',
  karaoke: '#ffe27a',
  minimal: '#ff6b35',
};

function clock(value: number): string {
  const total = Math.max(0, Math.floor(value));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

export function PreviewPane({
  clip,
  meta,
  objectUrl,
  transcriptWords,
  onUpdate,
  onTimeChange,
  registerSeek,
  onCutAtFrame,
  canCut,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<number | null>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const railDragRef = useRef<RailDrag | null>(null);
  const [railTop, setRailTop] = useState<number | null>(null);
  const [activeTool, setActiveTool] = useState<ToolId>('text');
  const [playhead, setPlayhead] = useState(clip.start);
  const [playing, setPlaying] = useState(false);
  const speed = clipSpeed(clip);
  const [audition, setAudition] = useState(false);
  const [expandedExport, setExpandedExport] = useState(false);
  const [videoBox, setVideoBox] = useState<VideoBox>({ left: 0, top: 0, width: 0, height: 0 });
  const timeChangeRef = useRef(onTimeChange);
  const togglePlayRef = useRef<() => void>(() => undefined);
  const seekByRef = useRef<(delta: number) => void>(() => undefined);
  const seekToRef = useRef<(time: number) => void>(() => undefined);
  useEffect(() => {
    timeChangeRef.current = onTimeChange;
  }, [onTimeChange]);

  // Seek into the clip on load and loop within the selected range.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const seek = (): void => {
      if (!Number.isFinite(video.duration)) return;
      video.currentTime = Math.min(clip.start, Math.max(0, video.duration - 0.1));
      setPlayhead(video.currentTime);
      timeChangeRef.current(video.currentTime);
    };
    if (video.readyState >= 1) seek();
    else video.addEventListener('loadedmetadata', seek, { once: true });
    const onTime = (): void => {
      if (!Number.isFinite(video.duration)) return;
      setPlayhead(video.currentTime);
      timeChangeRef.current(video.currentTime);
      if (video.currentTime >= clip.end - 0.05 || video.currentTime < clip.start - 0.2) {
        video.currentTime = clip.start;
        setPlayhead(clip.start);
        timeChangeRef.current(clip.start);
      }
    };
    const onPlay = (): void => setPlaying(true);
    const onPause = (): void => setPlaying(false);
    video.addEventListener('timeupdate', onTime);
    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    return () => {
      video.removeEventListener('loadedmetadata', seek);
      video.removeEventListener('timeupdate', onTime);
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
    };
  }, [clip.start, clip.end, objectUrl]);

  // The speed control is part of the clip, so preview and export never disagree.
  useEffect(() => {
    const video = videoRef.current;
    if (video) video.playbackRate = speed;
  }, [speed]);

  // `volume` is not a React DOM attribute; set it on the element directly.
  useEffect(() => {
    const video = videoRef.current;
    if (video) video.volume = Math.min(1, Math.max(0, clip.volume ?? 1));
  }, [clip.volume]);

  // Measure the displayed video rectangle so the crop overlay stays aligned.
  useEffect(() => {
    const surface = surfaceRef.current;
    const video = videoRef.current;
    if (!surface || !video) return;
    const measure = (): void => {
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      if (!vw || !vh) return;
      const bounds = surface.getBoundingClientRect();
      const scale = Math.min(bounds.width / vw, bounds.height / vh);
      const width = vw * scale;
      const height = vh * scale;
      setVideoBox({
        left: (bounds.width - width) / 2,
        top: (bounds.height - height) / 2,
        width,
        height,
      });
    };
    measure();
    video.addEventListener('loadedmetadata', measure);
    video.addEventListener('resize', measure);
    const observer = new ResizeObserver(measure);
    observer.observe(surface);
    return () => {
      video.removeEventListener('loadedmetadata', measure);
      video.removeEventListener('resize', measure);
      observer.disconnect();
    };
  }, [objectUrl, meta.width, meta.height]);

  // Draw the real cropped + captioned frame through the same pure functions as the renderer.
  useEffect(() => {
    const video = videoRef.current;
    const canvas = previewRef.current;
    if (!video || !canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const draw = (): void => {
      const sourceW = video.videoWidth || meta.width;
      const sourceH = video.videoHeight || meta.height;
      ctx.clearRect(0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT);
      if (sourceW > 0 && sourceH > 0 && video.readyState >= 2) {
        const crop = cropToPixels(clip.crop, sourceW, sourceH, video.currentTime);
        try {
          ctx.drawImage(video, crop.left, crop.top, crop.width, crop.height, 0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT);
        } catch {
          // A frame may not be decodable yet; the next frame retries.
        }
      }
      if (clip.captionsEnabled) {
        drawCaptions(
          ctx,
          clip.words,
          video.currentTime,
          PREVIEW_WIDTH,
          PREVIEW_HEIGHT,
          clip.captionStyle,
          clip.captionLayout,
        );
      }
      frameRef.current = requestAnimationFrame(draw);
    };
    frameRef.current = requestAnimationFrame(draw);
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, [clip.captionsEnabled, clip.captionStyle, clip.captionLayout, clip.crop, clip.words, meta.width, meta.height]);

  const togglePlay = useCallback((): void => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) void video.play().catch(() => undefined);
    else video.pause();
  }, []);

  const seekBy = useCallback(
    (delta: number): void => {
      const video = videoRef.current;
      if (!video) return;
      video.currentTime = frameTime(clamp(video.currentTime + delta, clip.start, clip.end));
      setPlayhead(video.currentTime);
      timeChangeRef.current(video.currentTime);
    },
    [clip.start, clip.end],
  );

  const seekTo = useCallback(
    (time: number): void => {
      const video = videoRef.current;
      if (!video) return;
      video.currentTime = frameTime(clamp(time, clip.start, clip.end));
      setPlayhead(video.currentTime);
      timeChangeRef.current(video.currentTime);
    },
    [clip.start, clip.end],
  );

  useEffect(() => {
    togglePlayRef.current = togglePlay;
    seekByRef.current = seekBy;
    seekToRef.current = seekTo;
  }, [togglePlay, seekBy, seekTo]);

  useEffect(() => {
    registerSeek?.(seekTo);
    return () => registerSeek?.(null);
  }, [registerSeek, seekTo]);

  // Playback shortcuts mirror the visible rail; they never steal keystrokes from fields.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (isEditableTarget(event.target)) return;
      const video = videoRef.current;
      if (!video) return;
      const key = event.key.toLowerCase();
      if (event.code === 'Space') {
        event.preventDefault();
        togglePlayRef.current();
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        seekByRef.current(event.shiftKey ? -1 : -1 / RENDER.frameRate);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        seekByRef.current(event.shiftKey ? 1 : 1 / RENDER.frameRate);
      } else if (key === 'j') {
        event.preventDefault();
        seekByRef.current(-1);
      } else if (key === 'k') {
        event.preventDefault();
        video.pause();
      } else if (key === 'l') {
        event.preventDefault();
        if (video.paused) void video.play().catch(() => undefined);
      } else if (key === 'f') {
        event.preventDefault();
        if (document.fullscreenElement) {
          void document.exitFullscreen().catch(() => undefined);
        } else if (sectionRef.current) {
          void sectionRef.current.requestFullscreen().catch(() => undefined);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const cycleSpeed = (): void => {
    const next = speed === 1 ? 1.25 : speed === 1.25 ? 1.5 : speed === 1.5 ? 0.75 : 1;
    onUpdate({ speed: next });
    if (videoRef.current) videoRef.current.playbackRate = next;
  };

  const toggleFullscreen = (): void => {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
    } else if (sectionRef.current) {
      void sectionRef.current.requestFullscreen().catch(() => undefined);
    }
  };

  const centerCrop = (): void => {
    onUpdate({ crop: { mode: 'static', ...centeredCrop(meta.width, meta.height) } });
    setActiveTool('crop');
  };

  /** Zoom the crop around its centre; every result stays a valid 9:16 rect. */
  const zoomCrop = (factor: number): void => {
    const rect = cropAtTime(clip.crop, playhead);
    const w = clamp(rect.w * factor, 0.05, 1);
    const h = clamp(rect.h * factor, 0.05, 1);
    onUpdate({
      crop: {
        mode: 'static',
        ...normalizeCrop(
          { x: rect.x + (rect.w - w) / 2, y: rect.y + (rect.h - h) / 2, w, h },
          meta.width,
          meta.height,
        ),
      },
    });
    setActiveTool('crop');
  };

  const selectTool = (id: ToolId): void => {
    if (id === 'text' && !clip.captionsEnabled) onUpdate({ captionsEnabled: true });
    setActiveTool(id);
  };

  /** The rail can be slid vertically to get it out of the way of the preview. */
  const onRailGripDown = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    const rail = railRef.current?.getBoundingClientRect();
    const surface = surfaceRef.current?.getBoundingClientRect();
    if (!rail || !surface) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    railDragRef.current = { pointerId: event.pointerId, startY: event.clientY, startTop: rail.top - surface.top };
  };
  const onRailGripMove = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    const drag = railDragRef.current;
    const surface = surfaceRef.current?.getBoundingClientRect();
    const rail = railRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !surface || !rail) return;
    const maxTop = Math.max(8, surface.height - rail.offsetHeight - 8);
    setRailTop(clamp(drag.startTop + event.clientY - drag.startY, 8, maxTop));
  };
  const onRailGripUp = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    const drag = railDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    railDragRef.current = null;
  };

  const railActions: { icon: IconName; label: string; onClick: () => void; active?: boolean }[] = [
    { icon: 'target', label: 'Center crop', onClick: centerCrop },
    { icon: 'plus', label: 'Zoom in', onClick: () => zoomCrop(0.85) },
    { icon: 'minus', label: 'Zoom out', onClick: () => zoomCrop(1 / 0.85) },
    {
      icon: 'cc',
      label: clip.captionsEnabled ? 'Hide captions' : 'Show captions',
      onClick: () => onUpdate({ captionsEnabled: !clip.captionsEnabled }),
      active: clip.captionsEnabled,
    },
  ];

  // Anchored near the top so the rail never collides with the playback bar.
  const railStyle: CSSProperties = { top: railTop ?? 12 };

  const range = Math.max(0.001, clip.end - clip.start);
  const frameNumber = Math.round(playhead * RENDER.frameRate);
  const currentTick = Math.round(((playhead - clip.start) / range) * (TICKS - 1));
  const activeWord = transcriptWords.find((word) => playhead >= word.start && playhead <= word.end);
  const overlayText = clip.captionsEnabled ? (activeWord?.text ?? clip.words[0]?.text ?? 'Sa') : 'Sa';

  return (
    <section ref={sectionRef} className="panel relative flex min-h-0 flex-1 flex-col overflow-hidden" aria-label="Video preview">
      <div ref={surfaceRef} className="relative min-h-0 flex-1 overflow-hidden bg-black">
        <video
          ref={videoRef}
          src={objectUrl}
          className="absolute inset-0 h-full w-full object-contain"
          playsInline
          muted={!audition || clip.muted === true}
          aria-label="Source video preview"
          onClick={togglePlay}
        />

        {/* 9:16 export preview inset — WYSIWYG of the final output, expandable for real inspection. */}
        <div
          className={
            expandedExport
              ? 'absolute inset-4 z-30 flex flex-col items-center justify-center gap-2 rounded-2xl border border-white/20 bg-black/92 p-3 shadow-2xl backdrop-blur'
              : 'absolute left-4 top-4 z-10 w-[74px] overflow-hidden rounded-xl border-2 border-white/50 bg-black shadow-[0_8px_24px_rgba(0,0,0,0.55)] ring-1 ring-black/40'
          }
        >
          <canvas
            ref={previewRef}
            width={PREVIEW_WIDTH}
            height={PREVIEW_HEIGHT}
            className={expandedExport ? 'block max-h-[calc(100%-2rem)] w-auto max-w-full rounded-lg' : 'block h-full w-full'}
            aria-label="Export preview with crop and captions"
          />
          <span className="absolute bottom-0 left-0 right-0 bg-black/70 py-0.5 text-center text-[9px] font-bold tracking-wider text-white">
            9:16
          </span>
          <button
            className="icon-btn absolute right-1 top-1 h-6 w-6 border-transparent bg-black/70 text-[10px]"
            onClick={() => setExpandedExport(!expandedExport)}
            aria-label={expandedExport ? 'Collapse export preview' : 'Expand export preview'}
            title={expandedExport ? 'Collapse export preview' : 'Inspect the exact 9:16 export'}
          >
            <Icon name={expandedExport ? 'close' : 'expand'} size={14} />
          </button>
        </div>

        {/* Crop overlay — only while the crop tool is active */}
        {activeTool === 'crop' ? (
          <CropBox
            crop={clip.crop}
            sourceWidth={meta.width}
            sourceHeight={meta.height}
            time={playhead}
            bounds={videoBox}
            onChange={(crop) => onUpdate({ crop })}
          />
        ) : null}

        {/* Text overlay with selection frame — matches the reference selected state */}
        {activeTool === 'text' && clip.captionsEnabled ? (
          <div className="pointer-events-none absolute left-[8%] top-[28%] z-10 select-none">
            <div className="relative inline-block">
              <div className="rounded-3xl bg-white/15 px-8 py-4">
                <span
                  className="font-overlay text-[clamp(48px,8vw,140px)] leading-none"
                  style={{ color: STYLE_COLORS[clip.captionStyle], textShadow: '0 2px 12px rgba(0,0,0,0.35)' }}
                >
                  {overlayText}
                </span>
                <span
                  className="font-overlay ml-1 text-[clamp(48px,8vw,140px)] leading-none"
                  style={{ color: STYLE_COLORS[clip.captionStyle] }}
                >
                  |
                </span>
              </div>
              {/* Selection frame */}
              <div className="pointer-events-none absolute inset-0 border-t-2 border-l-2 border-r-2 border-white/90" />
              <span className="absolute -left-1 -top-1 h-3 w-3 bg-white" />
              <span className="absolute -bottom-1 -right-1 h-3 w-3 bg-white" />
              <span className="absolute -bottom-2 -left-2 text-white"><Icon name="expand" size={16} /></span>
              {/* Delete overlay */}
              <button
                className="icon-btn pointer-events-auto absolute -right-5 -top-12 h-14 w-14 bg-[#161a33]"
                onClick={() => onUpdate({ captionsEnabled: false })}
                aria-label="Remove text overlay"
                title="Remove caption overlay"
              >
                <Icon name="trash" size={22} />
              </button>
            </div>

            {/* Caption style bar — each swatch switches the real caption preset. */}
            <div className="pointer-events-auto mt-3 flex w-fit items-center gap-2 rounded-full bg-black/55 px-3 py-2 backdrop-blur">
              <span className="text-[10px] font-bold uppercase tracking-wider text-white/70">Style</span>
              {(['bold-pop', 'karaoke', 'minimal'] as const).map((style) => (
                <button
                  key={style}
                  className={`h-6 w-6 rounded-full border-2 transition-transform hover:scale-110 ${
                    clip.captionStyle === style ? 'ring-2 ring-white ring-offset-2 ring-offset-[#161a33]' : ''
                  }`}
                  style={{
                    background: STYLE_COLORS[style],
                    borderColor: clip.captionStyle === style ? '#ffffff' : '#8a90b0',
                  }}
                  onClick={() => onUpdate({ captionStyle: style })}
                  aria-label={`Caption style ${style}`}
                  title={style}
                />
              ))}
            </div>
          </div>
        ) : null}

        {/* Floating tool rail: scrollable, and draggable by its grip. */}
        <div
          ref={railRef}
          className="absolute right-3 z-20 flex max-h-[calc(100%-104px)] w-[60px] flex-col overflow-hidden rounded-3xl border border-white/10 bg-black/50 p-1.5 shadow-xl backdrop-blur-md"
          style={railStyle}
        >
          <button
            className="flex h-5 shrink-0 touch-none items-center justify-center rounded-full text-white/60 hover:bg-white/10 hover:text-white"
            onPointerDown={onRailGripDown}
            onPointerMove={onRailGripMove}
            onPointerUp={onRailGripUp}
            onPointerCancel={onRailGripUp}
            aria-label="Move toolbar"
            title="Drag to move toolbar"
          >
            <span className="h-1 w-6 rounded-full bg-current" />
          </button>
          <div className="tool-scroll min-h-0 flex-1 space-y-1 overflow-x-hidden overflow-y-auto py-1">
            {TOOLS.map((tool) => (
              <button
                key={tool.id}
                className={`mx-auto flex h-11 w-11 items-center justify-center rounded-2xl border-2 transition-colors ${
                  activeTool === tool.id
                    ? 'border-white bg-white/20 text-white'
                    : 'border-transparent text-white/80 hover:bg-white/10'
                }`}
                onClick={() => selectTool(tool.id)}
                aria-pressed={activeTool === tool.id}
                aria-label={tool.label}
                title={tool.label}
              >
                <Icon name={tool.icon} size={20} />
              </button>
            ))}
            <span className="mx-auto my-1 block h-px w-7 bg-white/20" />
            {railActions.map((action) => (
              <button
                key={action.label}
                className={`mx-auto flex h-11 w-11 items-center justify-center rounded-2xl border-2 transition-colors ${
                  action.active ? 'border-white/70 bg-white/15 text-white' : 'border-transparent text-white/80 hover:bg-white/10'
                }`}
                onClick={action.onClick}
                aria-label={action.label}
                title={action.label}
              >
                <Icon name={action.icon} size={20} />
              </button>
            ))}
          </div>
        </div>

        {/* Playback bar — the main control surface, kept on one tidy row. */}
        <div className="absolute inset-x-3 bottom-3 z-20 rounded-[26px] border border-white/10 bg-black/65 px-3 py-2.5 shadow-2xl backdrop-blur-xl sm:px-4">
          <div className="flex items-center gap-1.5 sm:gap-2">
            <div className="flex shrink-0 items-center gap-0.5 sm:gap-1">
              <button
                className="icon-btn h-10 w-10 min-w-10 border-transparent"
                onClick={() => seekBy(-15)}
                aria-label="Back 15 seconds"
                title="Back 15 seconds"
              >
                <Icon name="back" size={18} />
              </button>
              <button
                className="icon-btn hidden h-9 w-9 min-w-9 border-transparent sm:flex"
                onClick={() => seekBy(-1 / RENDER.frameRate)}
                aria-label="Previous frame"
                title="Previous frame (←)"
              >
                <Icon name="frameBack" size={17} />
              </button>
              <button
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-white shadow-lg shadow-black/40 transition-transform hover:scale-105 active:scale-95"
                onClick={togglePlay}
                aria-label={playing ? 'Pause' : 'Play'}
                title={playing ? 'Pause' : 'Play'}
              >
                <Icon name={playing ? 'pause' : 'play'} size={24} />
              </button>
              <button
                className="icon-btn hidden h-9 w-9 min-w-9 border-transparent sm:flex"
                onClick={() => seekBy(1 / RENDER.frameRate)}
                aria-label="Next frame"
                title="Next frame (→)"
              >
                <Icon name="frameForward" size={17} />
              </button>
              <button
                className="icon-btn h-10 w-10 min-w-10 border-transparent"
                onClick={() => seekBy(15)}
                aria-label="Forward 15 seconds"
                title="Forward 15 seconds"
              >
                <Icon name="forward" size={18} />
              </button>
            </div>

            <button
              className="icon-btn h-9 w-9 min-w-9 shrink-0 border-transparent"
              onClick={() => setAudition(!audition)}
              aria-label={audition ? 'Mute preview' : 'Audition audio'}
              title={audition ? 'Mute preview audio' : `Listen at ${Math.round((clip.volume ?? 1) * 100)}%`}
            >
              <Icon name={audition && !clip.muted ? 'volume' : 'volumeOff'} size={17} />
            </button>

            <button
              className="shrink-0 rounded-full border border-white/15 bg-white/5 px-2 py-1 text-[11px] font-bold tabular-nums text-white/80 transition-colors hover:bg-white/15"
              onClick={cycleSpeed}
              aria-label="Playback speed"
              title={`Clip speed ${speed}× — also changes the exported duration`}
            >
              {speed}×
            </button>

            <button
              className="icon-btn h-9 w-9 min-w-9 shrink-0 border-transparent"
              onClick={onCutAtFrame}
              disabled={!canCut}
              aria-label="Cut at frame"
              title={`Split exactly at frame ${frameNumber} (X)`}
            >
              <Icon name="scissors" size={17} />
            </button>

            {/* Scrub strip: fewer, wider ticks with unique labels; ends mark the clip in/out. */}
            <div className="flex min-w-0 flex-1 items-end gap-[2px] px-1">
              {Array.from({ length: TICKS }, (_, index) => {
                const tickTime = frameTime(clip.start + (index / (TICKS - 1)) * range);
                const played = tickTime <= playhead;
                const current = index === currentTick;
                const edge = index === 0 || index === TICKS - 1;
                return (
                  <button
                    key={index}
                    className="flex min-w-0 flex-1 flex-col items-center justify-end py-1"
                    onClick={() => seekTo(tickTime)}
                    aria-label={`Seek to ${tickTime.toFixed(1)}s`}
                    title={`${tickTime.toFixed(1)}s`}
                  >
                    <span
                      className={`w-full rounded-full transition-all ${
                        played ? 'bg-[var(--accent)]' : 'bg-white/20'
                      } ${current ? 'h-4' : 'h-2'} ${edge ? 'ring-1 ring-white/70' : ''}`}
                    />
                  </button>
                );
              })}
            </div>

            <div className="shrink-0 rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-semibold tabular-nums text-white">
              <span className="text-[var(--accent)]">F{String(frameNumber).padStart(5, '0')}</span>{' '}
              {clock(playhead)} <span className="text-white/50">/ {clock(clip.end - clip.start)}</span>
            </div>

            <button
              className="icon-btn hidden h-9 w-9 min-w-9 shrink-0 border-transparent sm:flex"
              onClick={toggleFullscreen}
              aria-label="Fullscreen preview"
              title="Fullscreen preview (F)"
            >
              <Icon name="fullscreen" size={17} />
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
