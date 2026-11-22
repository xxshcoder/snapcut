import { CanvasSink } from 'mediabunny';
import { TRACKING } from '../../config';
import { createInput } from '../fileSource';
import { centeredCrop, normalizeCrop, type Rect } from '../render/crop';
import type { CropPath } from '../../types';

export type FaceSample = { t: number; x: number; y: number; w: number; h: number; score: number };
export type TrackResult = { crop: CropPath; facesFound: number; notice?: string };

/** Moving-average smoothing to remove per-frame jitter. */
export function smoothSamples(samples: FaceSample[], windowSize = TRACKING.smoothingWindow): FaceSample[] {
  if (samples.length === 0) return [];
  const half = Math.max(0, Math.floor(windowSize / 2));
  return samples.map((sample, index) => {
    const from = Math.max(0, index - half);
    const to = Math.min(samples.length, index + half + 1);
    const group = samples.slice(from, to);
    const average = (key: keyof FaceSample) => group.reduce((sum, item) => sum + item[key], 0) / group.length;
    return {
      t: sample.t,
      x: average('x'),
      y: average('y'),
      w: average('w'),
      h: average('h'),
      score: sample.score,
    };
  });
}

export function samplesToCrop(samples: FaceSample[], sourceW: number, sourceH: number): CropPath {
  if (samples.length === 0) return { mode: 'static', ...centeredCrop(sourceW, sourceH) };
  return {
    mode: 'tracked',
    keyframes: samples.map((sample) => {
      const rect: Rect = {
        x: sample.x - sample.w * 0.35,
        y: sample.y - sample.h * 0.45,
        w: sample.w * 1.7,
        h: sample.h * 1.9,
      };
      const fitted = normalizeCrop(rect, sourceW, sourceH);
      return { t: sample.t, ...fitted };
    }),
  };
}

/** Sample a clip at 2 fps and follow the largest detected face. */
export async function trackFace(
  file: File,
  start: number,
  end: number,
  signal?: AbortSignal,
  onProgress?: (percent: number) => void,
): Promise<TrackResult> {
  const input = createInput(file);
  try {
    const videoTrack = await input.getPrimaryVideoTrack();
    if (!videoTrack) return { crop: { mode: 'static', ...centeredCrop(1, 1) }, facesFound: 0, notice: 'No video track.' };
    const displayW = await videoTrack.getDisplayWidth();
    const displayH = await videoTrack.getDisplayHeight();
    const fallback: TrackResult = {
      crop: { mode: 'static', ...centeredCrop(displayW, displayH) },
      facesFound: 0,
      notice: 'Face tracking unavailable; using a centred crop.',
    };

    let detector: { detect: (image: unknown) => { detections: { boundingBox: { originX: number; originY: number; width: number; height: number }; score?: number }[] }; close: () => void };
    try {
      const vision = await import('@mediapipe/tasks-vision');
      const fileset = await vision.FilesetResolver.forVisionTasks(TRACKING.wasmUrl);
      const created = await vision.FaceDetector.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: TRACKING.modelUrl, delegate: 'CPU' },
        runningMode: 'IMAGE',
        minDetectionConfidence: 0.5,
      });
      detector = created as unknown as typeof detector;
    } catch {
      return fallback;
    }

    const lowW = TRACKING.lowResWidth;
    const lowH = Math.max(1, Math.round((lowW * displayH) / displayW));
    const sink = new CanvasSink(videoTrack, { width: lowW, height: lowH, fit: 'fill', poolSize: 1 });
    const count = Math.max(1, Math.floor((end - start) * TRACKING.sampleFps));
    const timestamps = Array.from({ length: count }, (_, i) => start + i / TRACKING.sampleFps);
    const samples: FaceSample[] = [];

    try {
      const iterator = sink.canvasesAtTimestamps(timestamps);
      for await (const wrapped of iterator) {
        if (signal?.aborted || !wrapped) break;
        const { canvas, timestamp } = wrapped;
        const result = detector.detect(canvas);
        const face = result.detections
          .slice()
          .sort((a, b) => b.boundingBox.width * b.boundingBox.height - a.boundingBox.width * a.boundingBox.height)[0];
        if (face) {
          const box = face.boundingBox;
          samples.push({
            t: timestamp,
            x: box.originX / lowW + box.width / lowW / 2,
            y: box.originY / lowH + box.height / lowH / 2,
            w: box.width / lowW,
            h: box.height / lowH,
            score: face.score ?? 1,
          });
        }
        onProgress?.((samples.length / Math.max(1, count)) * 100);
      }
      await iterator.return?.();
    } finally {
      detector.close();
    }

    if (samples.length === 0) return fallback;
    const smoothed = smoothSamples(samples);
    return { crop: samplesToCrop(smoothed, displayW, displayH), facesFound: samples.length };
  } finally {
    input.dispose();
  }
}
