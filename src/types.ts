export type Word = {
  text: string;
  start: number;
  end: number;
};

export type Transcript = {
  fileId: string;
  language?: string;
  words: Word[];
  durationSec: number;
};

export type AudioSegment = {
  index: number;
  offsetSec: number;
  durationSec: number;
  blob: Blob;
  mime: string;
};

export type Window = {
  id: number;
  start: number;
  end: number;
  text: string;
  prefilterScore: number;
};

export type CropPath =
  | { mode: 'static'; x: number; y: number; w: number; h: number }
  | {
      mode: 'tracked';
      keyframes: { t: number; x: number; y: number; w: number; h: number }[];
    };

export type CaptionStyleId = 'bold-pop' | 'minimal' | 'karaoke';

export type Clip = {
  id: string;
  start: number;
  end: number;
  title: string;
  hook: string;
  score: number;
  crop: CropPath;
  captionsEnabled: boolean;
  captionStyle: CaptionStyleId;
  words: Word[];
};

export type FileId = string;

export type FileMeta = {
  fileId: FileId;
  name: string;
  size: number;
  durationSec: number;
  width: number;
  height: number;
  hasAudio: boolean;
  audioCodec: string | null;
  videoCodec: string | null;
  canDecodeVideo: boolean;
  canDecodeAudio: boolean;
};

export type SegmentPlan = {
  index: number;
  offsetSec: number;
  durationSec: number;
};

export type Progress = {
  phase: string;
  done: number;
  total: number;
  percent: number;
  etaSec?: number;
};

export type ProjectState = {
  fileId: FileId;
  name: string;
  durationSec: number;
  clips: Clip[];
  updatedAt: number;
};

export type Capabilities = {
  videoEncoder: boolean;
  videoDecoder: boolean;
  audioEncoder: boolean;
  audioDecoder: boolean;
  opfs: boolean;
  wakeLock: boolean;
  shareFiles: boolean;
  offscreenCanvas: boolean;
  mediabunny: boolean;
  ffmpegFallback: boolean;
  isMobile: boolean;
  isDesktop: boolean;
  missing: string[];
};
