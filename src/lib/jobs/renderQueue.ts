import {
  CancelledError,
  SnapcutError,
  UnsupportedCodecError,
  isCancelled,
  toFriendlyError,
} from '../errors';
import { exportBlob, safeFilename } from '../export/save';
import { renderWithFfmpeg } from '../render/fallbackFfmpeg';
import { pickRenderProfile } from '../render/profile';
import { clearOutputDirectory } from '../storage/opfs';
import { createRenderWorker } from '../workers/client';
import type { RenderWorkerResult } from '../../workers/messages';
import type { Capabilities, Clip, FileMeta } from '../../types';

export type RenderQueueUpdate = (clipId: string, percent: number, phase: string) => void;

export type RenderedClip = {
  clipId: string;
  filename: string;
  blob: Blob;
  width: number;
  height: number;
  usedCodec: string;
  captionsSkipped: boolean;
};

/** Transient problems are worth one retry; configuration/user errors are not. */
export function isTransientRenderError(error: unknown): boolean {
  if (isCancelled(error) || error instanceof UnsupportedCodecError) return false;
  if (error instanceof SnapcutError) {
    return error.code === 'network' || error.code === 'rate_limited' || error.code === 'api';
  }
  return error instanceof Error;
}

/** Render and export clips strictly one at a time; dispose each worker between clips. */
export async function renderQueue(
  file: File,
  meta: FileMeta,
  clips: Clip[],
  caps: Capabilities | null,
  options: {
    signal?: AbortSignal;
    onProgress?: RenderQueueUpdate;
    preferShare?: boolean;
    onExported?: (result: RenderedClip) => void;
  } = {},
): Promise<RenderedClip[]> {
  const profile = pickRenderProfile(caps);
  const results: RenderedClip[] = [];

  try {
    for (const clip of clips) {
      if (options.signal?.aborted) throw new CancelledError();
      options.onProgress?.(clip.id, 0, 'Preparing');
      let worker = createRenderWorker();
      let id: number | null = null;
      let cleanupSent = true;
      try {
        let rendered: RenderWorkerResult | null = null;
        let captionsSkipped = false;

        // One retry for transient render failures; UnsupportedCodecError falls back once instead.
        for (let attempt = 0; attempt <= 1; attempt++) {
          if (options.signal?.aborted) throw new CancelledError();
          id = Math.floor(Math.random() * 2 ** 30) + 1;
          cleanupSent = false;
          try {
            rendered = await worker.run<RenderWorkerResult>(
              { file, clip, profile },
              {
                id,
                signal: options.signal,
                onProgress: (percent, phase) => options.onProgress?.(clip.id, percent, phase),
              },
            );
            break;
          } catch (error) {
            if (isCancelled(error) || options.signal?.aborted) throw new CancelledError();
            if (caps?.isDesktop && error instanceof UnsupportedCodecError) {
              options.onProgress?.(clip.id, 0, 'Using ffmpeg fallback');
              const fallback = await renderWithFfmpeg(file, clip, profile, meta, (percent) =>
                options.onProgress?.(clip.id, percent, 'Using ffmpeg fallback'),
              );
              rendered = {
                blob: fallback.blob,
                width: fallback.width,
                height: fallback.height,
                usedCodec: fallback.usedCodec,
              };
              captionsSkipped = fallback.captionsSkipped;
              break;
            }
            if (attempt === 0 && isTransientRenderError(error)) {
              options.onProgress?.(clip.id, 0, 'Retrying render');
              // Start a fresh worker so the retry cannot inherit a broken encoder state.
              worker.dispose();
              worker = createRenderWorker();
              id = null;
              cleanupSent = true;
              continue;
            }
            throw error;
          }
        }

        if (!rendered) continue;
        const filename = `${safeFilename(meta.name)}-clip-${Math.round(clip.start)}-${Math.round(clip.end)}.mp4`;
        options.onProgress?.(clip.id, 100, 'Exporting');
        await exportBlob(rendered.blob, filename, options.preferShare ?? caps?.shareFiles ?? false);
        const result: RenderedClip = {
          clipId: clip.id,
          filename,
          blob: rendered.blob,
          width: rendered.width,
          height: rendered.height,
          usedCodec: rendered.usedCodec,
          captionsSkipped,
        };
        results.push(result);
        options.onExported?.(result);
      } finally {
        // Ask the worker to drop its OPFS handle while it is still alive.
        if (id !== null && !cleanupSent) worker.cleanup(id);
        worker.dispose();
      }
    }
    return results;
  } finally {
    // The worker may have been terminated before it handled `cleanup`; make sure
    // no partial OPFS output is left behind after an export (or cancellation).
    await clearOutputDirectory().catch(() => undefined);
  }
}

export function renderErrorMessage(error: unknown): string {
  return toFriendlyError(error).message;
}
