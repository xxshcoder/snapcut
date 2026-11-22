/// <reference lib="webworker" />
import { isCancelled, toFriendlyError } from '../lib/errors';
import { renderClip } from '../lib/render/renderClip';
import type { RenderRequest, RenderWorkerResult, WorkerResponse } from './messages';

const scope = self as unknown as DedicatedWorkerGlobalScope;
const controllers = new Map<number, AbortController>();
const cleanups = new Map<number, () => Promise<void>>();

function post(message: WorkerResponse): void {
  scope.postMessage(message);
}

scope.onmessage = async (event: MessageEvent<RenderRequest>) => {
  const request = event.data;
  if (request.type === 'cancel') {
    controllers.get(request.id)?.abort();
    const cleanup = cleanups.get(request.id);
    if (cleanup) {
      cleanups.delete(request.id);
      await cleanup().catch(() => undefined);
    }
    return;
  }
  if (request.type === 'cleanup') {
    const cleanup = cleanups.get(request.id);
    if (cleanup) {
      cleanups.delete(request.id);
      await cleanup().catch(() => undefined);
    }
    return;
  }

  const controller = new AbortController();
  controllers.set(request.id, controller);
  try {
    const result = await renderClip(request.file, request.clip, {
      profile: request.profile,
      signal: controller.signal,
      onProgress: (percent) => post({ type: 'progress', id: request.id, percent, phase: 'Rendering' }),
    });
    cleanups.set(request.id, result.cleanup);
    const transferable: RenderWorkerResult = {
      blob: result.blob,
      width: result.width,
      height: result.height,
      usedCodec: result.usedCodec,
    };
    post({ type: 'done', id: request.id, result: transferable });
  } catch (error) {
    if (isCancelled(error)) return;
    const friendly = toFriendlyError(error);
    post({ type: 'error', id: request.id, message: friendly.message, code: friendly.code });
  } finally {
    controllers.delete(request.id);
  }
};
