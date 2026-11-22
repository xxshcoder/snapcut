import { FFMPEG_CORE_BASE } from '../../config';
import { cropToPixels } from './crop';
import type { RenderProfile, RenderResult } from './renderClip';
import type { Clip } from '../../types';

export type FfmpegRenderResult = RenderResult & { captionsSkipped: boolean };

/**
 * Desktop-only fallback for unsupported WebCodecs/codecs. ffmpeg.wasm is loaded
 * lazily and the source is mounted with WORKERFS, so it is never fully buffered.
 */
export async function renderWithFfmpeg(
  file: File,
  clip: Clip,
  profile: RenderProfile,
  source: { width: number; height: number },
  onProgress?: (percent: number) => void,
): Promise<FfmpegRenderResult> {
  const [{ FFmpeg, FFFSType }, { toBlobURL }] = await Promise.all([
    import('@ffmpeg/ffmpeg'),
    import('@ffmpeg/util'),
  ]);
  const ffmpeg = new FFmpeg();
  ffmpeg.on('progress', ({ progress }) => onProgress?.(Math.max(0, Math.min(100, progress * 100))));
  await ffmpeg.load({
    coreURL: await toBlobURL(`${FFMPEG_CORE_BASE}/ffmpeg-core.js`, 'text/javascript'),
    wasmURL: await toBlobURL(`${FFMPEG_CORE_BASE}/ffmpeg-core.wasm`, 'application/wasm'),
  });

  try {
    await ffmpeg.mount(FFFSType.WORKERFS, { files: [file] }, '/input');
    const rect = cropToPixels(clip.crop, source.width, source.height, clip.start);
    const x = Math.round(rect.left / 2) * 2;
    const y = Math.round(rect.top / 2) * 2;
    const w = Math.max(2, Math.round(rect.width / 2) * 2);
    const h = Math.max(2, Math.round(rect.height / 2) * 2);
    const filter = `crop=${w}:${h}:${x}:${y},scale=${profile.width}:${profile.height}`;
    const exitCode = await ffmpeg.exec([
      '-ss', clip.start.toFixed(3),
      '-i', `/input/${file.name}`,
      '-t', (clip.end - clip.start).toFixed(3),
      '-vf', filter,
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-crf', '23',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-b:a', `${Math.round(profile.audioBitrateBps / 1000)}k`,
      '-movflags', '+faststart',
      '-y',
      'out.mp4',
    ]);
    if (exitCode !== 0) throw new Error(`ffmpeg exited with code ${exitCode}.`);
    const data = await ffmpeg.readFile('out.mp4');
    const bytes = data instanceof Uint8Array ? data : new TextEncoder().encode(String(data));
    onProgress?.(100);
    return {
      blob: new Blob([bytes.slice()], { type: 'video/mp4' }),
      width: profile.width,
      height: profile.height,
      usedCodec: 'avc (ffmpeg.wasm)',
      captionsSkipped: clip.captionsEnabled,
      cleanup: async () => undefined,
    };
  } finally {
    await ffmpeg.unmount('/input').catch(() => undefined);
    ffmpeg.terminate();
  }
}
