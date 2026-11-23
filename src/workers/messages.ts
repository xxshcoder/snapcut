import type { Clip, CropPath } from '../types';
import type { RenderProfile } from '../lib/render/renderClip';

export type WorkerRequest =
  | { type: 'start'; id: number; file: File }
  | { type: 'cancel'; id: number };

export type RenderRequest =
  | { type: 'start'; id: number; file: File; clip: Clip; profile?: RenderProfile }
  | { type: 'cancel'; id: number }
  | { type: 'cleanup'; id: number };

export type TrackRequest =
  | { type: 'start'; id: number; file: File; start: number; end: number }
  | { type: 'cancel'; id: number };

export type FilmstripRequest =
  | { type: 'start'; id: number; file: File; start: number; end: number; count?: number }
  | { type: 'cancel'; id: number };

export type WorkerResponse =
  | { type: 'progress'; id: number; percent: number; phase: string }
  | { type: 'done'; id: number; result: unknown }
  | { type: 'error'; id: number; message: string; code: string };

export type AudioWorkerResult = {
  segments: { index: number; offsetSec: number; durationSec: number; blob: Blob; mime: string }[];
  codec: string;
};

export type TrackWorkerResult = { crop: CropPath; facesFound: number };

export type FilmstripWorkerResult = { timeSec: number; blob: Blob }[];

/** Functions cannot be structured-cloned, so cleanup is requested separately. */
export type RenderWorkerResult = {
  blob: Blob;
  width: number;
  height: number;
  usedCodec: string;
};
