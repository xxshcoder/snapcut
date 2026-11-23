import { CancelledError, SnapcutError, toFriendlyError } from '../errors';
import type { FilmstripRequest, RenderRequest, TrackRequest, WorkerRequest, WorkerResponse } from '../../workers/messages';

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
  onProgress?: (percent: number, phase: string) => void;
  signal?: AbortSignal;
  abortListener?: () => void;
};

/** One worker per job keeps cancellation and resource cleanup simple. */
export class JobWorker<Request extends { id: number; type: 'start' | 'cancel' }> {
  private readonly worker: Worker;
  private readonly pending = new Map<number, Pending>();

  constructor(factory: () => Worker) {
    this.worker = factory();
    this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data;
      const item = this.pending.get(message.id);
      if (!item) return;
      if (message.type === 'progress') {
        item.onProgress?.(message.percent, message.phase);
        return;
      }
      this.pending.delete(message.id);
      if (item.signal) item.signal.removeEventListener('abort', item.abortListener ?? (() => undefined));
      if (message.type === 'error') {
        item.reject(new SnapcutError(
          message.code as SnapcutError['code'],
          message.message,
          'Try another browser or a shorter clip.',
        ));
        return;
      }
      item.resolve(message.result);
    };
    this.worker.onerror = (event) => {
      for (const item of this.pending.values()) item.reject(new Error(event.message || 'Worker failed.'));
      this.pending.clear();
    };
  }

  run<TResult>(
    request: Omit<Request, 'id' | 'type'> & { type?: 'start' },
    options: {
      id?: number;
      signal?: AbortSignal;
      onProgress?: (percent: number, phase: string) => void;
    } = {},
  ): Promise<TResult> {
    const id = options.id ?? Math.floor(Math.random() * 2 ** 30) + 1;
    return new Promise<TResult>((resolve, reject) => {
      if (options.signal?.aborted) {
        reject(new CancelledError());
        return;
      }
      const pending: Pending = { resolve: resolve as (value: unknown) => void, reject, onProgress: options.onProgress, signal: options.signal };
      if (options.signal) {
        pending.abortListener = () => {
          this.worker.postMessage({ type: 'cancel', id });
          this.pending.delete(id);
          reject(new CancelledError());
        };
        options.signal.addEventListener('abort', pending.abortListener, { once: true });
      }
      this.pending.set(id, pending);
      this.worker.postMessage({ ...request, type: 'start', id });
    });
  }

  /** Ask the worker to release an OPFS output after its blob has been exported. */
  cleanup(id: number): void {
    this.worker.postMessage({ type: 'cleanup', id });
  }

  dispose(): void {
    for (const item of this.pending.values()) item.reject(new CancelledError());
    this.pending.clear();
    this.worker.terminate();
  }
}

export function createAudioWorker(): JobWorker<Extract<WorkerRequest, { type: 'start' }>> {
  return new JobWorker(() => new Worker(new URL('../../workers/audio.worker.ts', import.meta.url), { type: 'module' }));
}

export function createRenderWorker(): JobWorker<Extract<RenderRequest, { type: 'start' }>> {
  return new JobWorker(() => new Worker(new URL('../../workers/render.worker.ts', import.meta.url), { type: 'module' }));
}

export function createTrackWorker(): JobWorker<Extract<TrackRequest, { type: 'start' }>> {
  return new JobWorker(() => new Worker(new URL('../../workers/track.worker.ts', import.meta.url), { type: 'module' }));
}

export function createFilmstripWorker(): JobWorker<Extract<FilmstripRequest, { type: 'start' }>> {
  return new JobWorker(() => new Worker(new URL('../../workers/filmstrip.worker.ts', import.meta.url), { type: 'module' }));
}

export function friendlyWorkerError(error: unknown): string {
  return toFriendlyError(error).message;
}
