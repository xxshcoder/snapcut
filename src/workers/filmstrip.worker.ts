/// <reference lib="webworker" />
import { isCancelled, toFriendlyError } from '../lib/errors';
import { extractFilmstrip } from '../lib/track/filmstrip';
import type { FilmstripRequest, WorkerResponse } from './messages';

const scope = self as unknown as DedicatedWorkerGlobalScope;
const controllers = new Map<number, AbortController>();

scope.onmessage = async (event: MessageEvent<FilmstripRequest>) => {
  const request = event.data;
  if (request.type === 'cancel') {
    controllers.get(request.id)?.abort();
    return;
  }
  const controller = new AbortController();
  controllers.set(request.id, controller);
  try {
    const result = await extractFilmstrip(
      request.file,
      request.start,
      request.end,
      request.count,
      controller.signal,
      (percent) =>
        scope.postMessage({ type: 'progress', id: request.id, percent, phase: 'Decoding frames' } satisfies WorkerResponse),
    );
    scope.postMessage({ type: 'done', id: request.id, result } satisfies WorkerResponse);
  } catch (error) {
    if (isCancelled(error)) return;
    const friendly = toFriendlyError(error);
    scope.postMessage({
      type: 'error',
      id: request.id,
      message: friendly.message,
      code: friendly.code,
    } satisfies WorkerResponse);
  } finally {
    controllers.delete(request.id);
  }
};
