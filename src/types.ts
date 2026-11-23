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

/** One decoded video frame for the timeline filmstrip. */
export type FilmstripFrame = {
  timeSec: number;
  url: string;
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

/** All fields are optional so projects saved before these controls existed still load. */
export type CaptionLayoutOptions = {
  /** Font-size multiplier around the style default. */
  fontSize?: number;
  /** Vertical centre as a fraction of the frame height. */
  position?: number;
  /** Force a backing box for styles that normally draw none. */
  background?: boolean;
  /** Outline-width multiplier around the style default. */
  outline?: number;
};

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
  /** Linear gain applied to exported audio; 1 is unchanged. */
  volume?: number;
  muted?: boolean;
  fadeInSec?: number;
  fadeOutSec?: number;
  /** Output-time multiplier: 2 means half the duration. */
  speed?: number;
  captionLayout?: CaptionLayoutOptions;
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
