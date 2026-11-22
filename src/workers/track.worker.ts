/// <reference lib="webworker" />
import { isCancelled, toFriendlyError } from '../lib/errors';
import { trackFace } from '../lib/track/faceTrack';
import type { TrackRequest, WorkerResponse } from './messages';

const scope = self as unknown as DedicatedWorkerGlobalScope;
const controllers = new Map<number, AbortController>();

scope.onmessage = async (event: MessageEvent<TrackRequest>) => {
  const request = event.data;
  if (request.type === 'cancel') {
    controllers.get(request.id)?.abort();
    return;
  }
  const controller = new AbortController();
  controllers.set(request.id, controller);
  try {
    const result = await trackFace(request.file, request.start, request.end, controller.signal, (percent) =>
      scope.postMessage({ type: 'progress', id: request.id, percent, phase: 'Tracking face' } satisfies WorkerResponse),
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
