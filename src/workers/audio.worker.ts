/// <reference lib="webworker" />
import { extractAudio } from '../lib/audio/extractAudio';
import { toFriendlyError, isCancelled } from '../lib/errors';
import type { AudioWorkerResult, WorkerRequest, WorkerResponse } from './messages';

const scope = self as unknown as DedicatedWorkerGlobalScope;
let cancelled = false;

function post(message: WorkerResponse): void {
  scope.postMessage(message);
}

scope.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  if (request.type === 'cancel') {
    cancelled = true;
    return;
  }
  cancelled = false;
  let phase = 'Extracting audio';
  try {
    const result = await extractAudio(request.file, {
      signal: { get aborted() { return cancelled; } } as unknown as AbortSignal,
      onCodec: (codec) => {
        // Surface the chosen format in the progress phase before extraction finishes.
        phase = codec === 'opus' ? 'Extracting audio (Opus/Ogg)' : 'Extracting audio (AAC/MP4)';
        post({ type: 'progress', id: request.id, percent: 0, phase });
      },
      onProgress: (done, total) => post({ type: 'progress', id: request.id, percent: total ? (done / total) * 100 : 0, phase }),
    });
    if (cancelled) return;
    const audioResult: AudioWorkerResult = {
      segments: result.segments.map((s) => ({
        index: s.index,
        offsetSec: s.offsetSec,
        durationSec: s.durationSec,
        blob: s.blob,
        mime: s.mime,
      })),
      codec: result.codec,
    };
    post({ type: 'done', id: request.id, result: audioResult });
  } catch (error) {
    if (isCancelled(error) || cancelled) return;
    const friendly = toFriendlyError(error);
    post({ type: 'error', id: request.id, message: friendly.message, code: friendly.code });
  }
};
