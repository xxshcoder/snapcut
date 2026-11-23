import { CanvasSink } from 'mediabunny';
import { RENDER } from '../../config';
import { createInput } from '../fileSource';

export type FilmstripFrameBlob = { timeSec: number; blob: Blob };

type CanvasLike = HTMLCanvasElement | OffscreenCanvas;

/** Small JPEGs keep the filmstrip cheap to clone out of the worker. */
async function toJpeg(canvas: CanvasLike): Promise<Blob> {
  if ('convertToBlob' in canvas && typeof canvas.convertToBlob === 'function') {
    return canvas.convertToBlob({ type: 'image/jpeg', quality: 0.55 });
  }
  return new Promise<Blob>((resolve, reject) => {
    (canvas as HTMLCanvasElement).toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Could not encode a preview frame.'))),
      'image/jpeg',
      0.55,
    );
  });
}

/** Evenly spaced frame boundaries for a filmstrip, clamped to 2–48 thumbnails. */
export function filmstripTimestamps(
  start: number,
  end: number,
  count = 24,
  frameRate = RENDER.frameRate,
): number[] {
  const steps = Math.max(2, Math.min(48, Math.round(count)));
  const frameStep = 1 / frameRate;
  const span = Math.max(frameStep, end - start);
  return Array.from({ length: steps }, (_, index) => {
    const time = start + (index / (steps - 1)) * span;
    return Math.round(time / frameStep) * frameStep;
  });
}

/**
 * Decode one thumbnail per even frame step across a clip. The source file is read
 * through Mediabunny's BlobSource (bounded ranged reads); it is never uploaded.
 */
export async function extractFilmstrip(
  file: File,
  start: number,
  end: number,
  count = 24,
  signal?: AbortSignal,
  onProgress?: (percent: number) => void,
): Promise<FilmstripFrameBlob[]> {
  const input = createInput(file);
  try {
    const videoTrack = await input.getPrimaryVideoTrack();
    if (!videoTrack) return [];
    const sink = new CanvasSink(videoTrack, { width: 96, height: 54, fit: 'fill', poolSize: 1 });
    const timestamps = filmstripTimestamps(start, end, count);
    const steps = timestamps.length;

    const frames: FilmstripFrameBlob[] = [];
    const iterator = sink.canvasesAtTimestamps(timestamps);
    let handled = 0;
    try {
      for await (const wrapped of iterator) {
        if (signal?.aborted) break;
        handled += 1;
        if (!wrapped) continue;
        const blob = await toJpeg(wrapped.canvas);
        frames.push({ timeSec: wrapped.timestamp, blob });
        onProgress?.((handled / steps) * 100);
      }
    } finally {
      await iterator.return?.();
    }
    return frames;
  } finally {
    input.dispose();
  }
}
