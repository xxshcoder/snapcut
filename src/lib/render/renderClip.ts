import {
  AudioSampleSink,
  AudioSampleSource,
  CanvasSink,
  CanvasSource,
  Mp4OutputFormat,
  Output,
  Quality,
  StreamTarget,
} from 'mediabunny';
import { RENDER } from '../../config';
import { CancelledError, UnsupportedCodecError } from '../errors';
import { createInput } from '../fileSource';
import { createOutputSink, type OutputSink } from '../storage/opfs';
import { drawCaptions, type Canvas2D } from './captions';
import { cropToPixels } from './crop';
import type { Clip } from '../../types';

export type RenderProfile = {
  width: number;
  height: number;
  videoBitrateBps: number;
  audioBitrateBps: number;
};

export type RenderOptions = {
  profile?: RenderProfile;
  signal?: AbortSignal;
  onProgress?: (percent: number) => void;
  sink?: OutputSink;
};

export type RenderResult = {
  blob: Blob;
  width: number;
  height: number;
  usedCodec: string;
  cleanup: () => Promise<void>;
};

/** Walk AVC profiles from best to worst, checking real browser support. */
export async function pickVideoCodec(width: number, height: number): Promise<string> {
  if (typeof VideoEncoder === 'undefined') throw new UnsupportedCodecError('VideoEncoder');
  const candidates = ['avc1.640028', 'avc1.4d401f', 'avc1.42001f', 'avc1.42e01e', 'avc1.42000d'];
  for (const codec of candidates) {
    try {
      const config: VideoEncoderConfig = {
        codec,
        width,
        height,
        bitrate: RENDER.desktop.videoBitrateBps,
        framerate: RENDER.frameRate,
      };
      if ((await VideoEncoder.isConfigSupported(config)).supported) return codec;
    } catch {
      // Try the next profile.
    }
  }
  throw new UnsupportedCodecError('H.264 (AVC)');
}

function makeCanvas(width: number, height: number): { canvas: OffscreenCanvas | HTMLCanvasElement; ctx: Canvas2D } {
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (ctx) return { canvas, ctx };
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new UnsupportedCodecError('Canvas 2D');
  return { canvas, ctx };
}

/** Render a clip to an MP4 written through OPFS (or a memory fallback). */
export async function renderClip(file: File, clip: Clip, options: RenderOptions = {}): Promise<RenderResult> {
  const profile = options.profile ?? RENDER.desktop;
  const usedCodec = await pickVideoCodec(profile.width, profile.height);
  const sink = options.sink ?? (await createOutputSink(`clip-${clip.id}.mp4`));
  const input = createInput(file);
  const { canvas, ctx } = makeCanvas(profile.width, profile.height);

  let output: Output | null = null;
  try {
    const videoTrack = await input.getPrimaryVideoTrack();
    if (!videoTrack || !(await videoTrack.canDecode())) throw new UnsupportedCodecError('source video');
    const sourceW = await videoTrack.getDisplayWidth();
    const sourceH = await videoTrack.getDisplayHeight();
    const audioTrack = await input.getPrimaryAudioTrack();

    const videoSource = new CanvasSource(canvas, {
      codec: 'avc',
      fullCodecString: usedCodec,
      quality: new Quality({ bitrate: profile.videoBitrateBps }),
      keyFrameInterval: 2,
    });
    const audioSource = new AudioSampleSource({
      codec: 'aac',
      quality: new Quality({ bitrate: profile.audioBitrateBps }),
      transform: { numberOfChannels: 2, sampleRate: 48_000 },
    });

    output = new Output({
      format: new Mp4OutputFormat(),
      target: new StreamTarget(sink.writable, { chunked: true, chunkSize: 1 << 18 }),
    });
    output.addVideoTrack(videoSource, { frameRate: RENDER.frameRate });
    if (audioTrack && (await audioTrack.canDecode())) output.addAudioTrack(audioSource);
    await output.start();

    const duration = Math.max(0.01, clip.end - clip.start);

    // Audio first: it has a much smaller footprint than video, so packet buffering stays low.
    if (audioTrack && (await audioTrack.canDecode())) {
      const audioSink = new AudioSampleSink(audioTrack);
      const iterator = audioSink.samples(clip.start, clip.end);
      try {
        for await (const sample of iterator) {
          if (options.signal?.aborted) throw new CancelledError();
          // Compute the offset before setTimestamp(): afterwards the sample's
          // timestamp is already relative to the clip (i.e. close to zero).
          const relative = Math.max(0, sample.timestamp - clip.start);
          sample.setTimestamp(relative);
          await audioSource.add(sample);
          sample.close();
          options.onProgress?.(Math.min(45, (relative / duration) * 45));
        }
      } finally {
        await iterator.return?.();
      }
    }
    audioSource.close();

    const frameSink = new CanvasSink(videoTrack, {
      width: sourceW,
      height: sourceH,
      fit: 'fill',
      poolSize: 2,
    });
    const frames = frameSink.canvases(clip.start, clip.end);
    try {
      for await (const { canvas: frame, timestamp, duration: frameDuration } of frames) {
        if (options.signal?.aborted) throw new CancelledError();
        const crop = cropToPixels(clip.crop, sourceW, sourceH, timestamp);
        ctx.drawImage(
          frame as CanvasImageSource,
          crop.left,
          crop.top,
          crop.width,
          crop.height,
          0,
          0,
          profile.width,
          profile.height,
        );
        const relative = Math.max(0, timestamp - clip.start);
        if (clip.captionsEnabled) {
          drawCaptions(ctx, clip.words, relative, profile.width, profile.height, clip.captionStyle);
        }
        await videoSource.add(relative, frameDuration);
        options.onProgress?.(45 + Math.min(55, (relative / duration) * 55));
      }
    } finally {
      await frames.return?.();
    }
    videoSource.close();
    await output.finalize();
    const blob = await sink.finish();
    options.onProgress?.(100);
    return { blob, width: profile.width, height: profile.height, usedCodec, cleanup: sink.cleanup };
  } catch (error) {
    if (output && output.state === 'started') await output.cancel().catch(() => undefined);
    await sink.cleanup().catch(() => undefined);
    if (error instanceof CancelledError) throw error;
    if (error instanceof UnsupportedCodecError) throw error;
    throw error;
  } finally {
    input.dispose();
  }
}
