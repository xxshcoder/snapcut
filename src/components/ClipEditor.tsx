import { useEffect, useRef, useState } from 'react';
import { CaptionStylePicker } from './CaptionStylePicker';
import { CropBox } from './CropBox';
import { TrimBar } from './TrimBar';
import { drawCaptions } from '../lib/render/captions';
import { cropToPixels } from '../lib/render/crop';
import type { CaptionStyleId, Clip, FileMeta, Progress, Word } from '../types';

type Props = {
  clip: Clip;
  meta: FileMeta;
  objectUrl: string;
  transcriptWords: Word[];
  trackProgress?: Progress;
  onUpdate: (patch: Partial<Clip>) => void;
  onWordChange: (index: number, text: string) => void;
  onTrack: () => void;
};

const PREVIEW_WIDTH = 540;
const PREVIEW_HEIGHT = 960;

export function ClipEditor({
  clip,
  meta,
  objectUrl,
  transcriptWords,
  trackProgress,
  onUpdate,
  onWordChange,
  onTrack,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<number | null>(null);
  const [showWords, setShowWords] = useState(false);
  const [playhead, setPlayhead] = useState(clip.start);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const seekToStart = (): void => {
      if (!Number.isFinite(video.duration)) return;
      video.currentTime = Math.min(clip.start, Math.max(0, video.duration - 0.1));
      setPlayhead(video.currentTime);
      void video.play().catch(() => undefined);
    };
    if (video.readyState >= 1) seekToStart();
    else video.addEventListener('loadedmetadata', seekToStart, { once: true });
    const onTimeUpdate = (): void => {
      if (!Number.isFinite(video.duration)) return;
      setPlayhead(video.currentTime);
      if (video.currentTime >= clip.end - 0.05 || video.currentTime < clip.start - 0.2) {
        video.currentTime = clip.start;
        setPlayhead(clip.start);
      }
    };
    video.addEventListener('timeupdate', onTimeUpdate);
    return () => {
      video.removeEventListener('loadedmetadata', seekToStart);
      video.removeEventListener('timeupdate', onTimeUpdate);
    };
  }, [clip.start, clip.end, objectUrl]);

  // The export preview draws through cropToPixels + drawCaptions, the same two
  // pure functions used by the render worker, so WYSIWYG stays aligned with MP4.
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
          // A frame may not be decodable yet; the next animation frame retries.
        }
      }
      if (clip.captionsEnabled) {
        drawCaptions(
          ctx,
          clip.words,
          Math.max(0, video.currentTime - clip.start),
          PREVIEW_WIDTH,
          PREVIEW_HEIGHT,
          clip.captionStyle,
        );
      }
      frameRef.current = requestAnimationFrame(draw);
    };
    frameRef.current = requestAnimationFrame(draw);
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, [clip.captionsEnabled, clip.captionStyle, clip.crop, clip.words, clip.start, meta.width, meta.height]);

  const aspect = meta.width > 0 && meta.height > 0 ? `${meta.width} / ${meta.height}` : '16 / 9';

  return (
    <section className="panel p-3" aria-label={`Edit ${clip.title}`}>
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(180px,280px)]">
        <div className="mx-auto w-full max-w-[560px]">
          <div className="relative mx-auto w-full overflow-hidden rounded-lg bg-black" style={{ aspectRatio: aspect }}>
            <video
              ref={videoRef}
              src={objectUrl}
              className="absolute inset-0 h-full w-full object-contain"
              playsInline
              muted
              controls
              aria-label="Source video preview"
            />
            <CropBox
              crop={clip.crop}
              sourceWidth={meta.width}
              sourceHeight={meta.height}
              time={playhead}
              onChange={(crop) => onUpdate({ crop })}
            />
          </div>
          <p className="muted mt-1 text-center text-xs">Drag the framed box to reframe. Use + / − or pinch to zoom.</p>
        </div>

        <div className="mx-auto w-full max-w-[280px]">
          <p className="muted mb-1 text-center text-xs font-semibold uppercase tracking-wide">9:16 export preview</p>
          <canvas
            ref={previewRef}
            width={PREVIEW_WIDTH}
            height={PREVIEW_HEIGHT}
            className="mx-auto block w-full overflow-hidden rounded-lg bg-black shadow-lg"
            aria-label="Export preview with crop and captions"
          />
          <p className="muted mt-1 text-center text-xs">Captions and framing here match the rendered file.</p>
        </div>
      </div>

      <div className="mt-4 space-y-4">
        <TrimBar
          start={clip.start}
          end={clip.end}
          duration={meta.durationSec}
          words={transcriptWords}
          onChange={(start, end) => onUpdate({ start, end, words: clip.words })}
        />

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs font-semibold">
            Title
            <input
              className="field mt-1 text-sm font-normal"
              value={clip.title}
              maxLength={80}
              onChange={(event) => onUpdate({ title: event.target.value })}
            />
          </label>
          <label className="text-xs font-semibold">
            Hook
            <textarea
              className="field mt-1 text-sm font-normal"
              rows={2}
              value={clip.hook}
              maxLength={300}
              onChange={(event) => onUpdate({ hook: event.target.value })}
            />
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-5 w-5 accent-[var(--accent)]"
              checked={clip.captionsEnabled}
              onChange={(event) => onUpdate({ captionsEnabled: event.target.checked })}
            />
            Burn in captions
          </label>
          <button className="btn" onClick={onTrack} disabled={trackProgress !== undefined}>
            Auto-follow speaker
          </button>
          {trackProgress ? <span className="muted text-xs">{trackProgress.phase} {trackProgress.percent}%</span> : null}
        </div>

        <CaptionStylePicker
          value={clip.captionStyle}
          onChange={(style: CaptionStyleId) => onUpdate({ captionStyle: style })}
        />

        <div>
          <button className="btn w-full sm:w-auto" onClick={() => setShowWords(!showWords)} aria-expanded={showWords}>
            {showWords ? 'Hide' : 'Edit'} caption words ({clip.words.length})
          </button>
          {showWords ? (
            <div className="mt-2 grid max-h-64 gap-2 overflow-y-auto sm:grid-cols-2">
              {clip.words.map((word, index) => (
                <label key={`${word.start}-${index}`} className="text-xs">
                  <span className="muted ml-1">{word.start.toFixed(1)}s</span>
                  <input
                    className="field mt-1 text-sm"
                    value={word.text}
                    onChange={(event) => onWordChange(index, event.target.value)}
                  />
                </label>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
