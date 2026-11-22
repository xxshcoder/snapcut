import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  run: vi.fn(),
  cleanup: vi.fn(),
  dispose: vi.fn(),
  exportBlob: vi.fn(),
  clearOutput: vi.fn(),
}));

vi.mock('../src/lib/workers/client', () => ({
  createRenderWorker: () => ({ run: mocks.run, cleanup: mocks.cleanup, dispose: mocks.dispose }),
}));
vi.mock('../src/lib/export/save', () => ({
  exportBlob: mocks.exportBlob,
  safeFilename: (name: string) => name.replace(/\W+/g, '-'),
}));
vi.mock('../src/lib/render/fallbackFfmpeg', () => ({ renderWithFfmpeg: vi.fn() }));
vi.mock('../src/lib/storage/opfs', () => ({ clearOutputDirectory: mocks.clearOutput }));
vi.mock('../src/lib/render/profile', () => ({
  pickRenderProfile: () => ({ width: 720, height: 1280, videoBitrateBps: 1, audioBitrateBps: 1 }),
}));

import { renderQueue } from '../src/lib/jobs/renderQueue';
import { CancelledError, NetworkError, UnsupportedCodecError } from '../src/lib/errors';
import type { Clip, FileMeta } from '../src/types';

const file = { name: 'talk.mp4' } as File;
const meta: FileMeta = {
  fileId: 'render-queue-1',
  name: 'talk.mp4',
  size: 1000,
  durationSec: 120,
  width: 1080,
  height: 1920,
  hasAudio: true,
  audioCodec: 'aac',
  videoCodec: 'avc',
  canDecodeVideo: true,
  canDecodeAudio: true,
};
const clip: Clip = {
  id: 'clip-1',
  start: 1,
  end: 21,
  title: 'Clip',
  hook: 'Hook.',
  score: 70,
  crop: { mode: 'static', x: 0, y: 0, w: 1, h: 1 },
  captionsEnabled: false,
  captionStyle: 'bold-pop',
  words: [],
};

function resetMocks(): void {
  mocks.run.mockReset();
  mocks.cleanup.mockReset();
  mocks.dispose.mockReset();
  mocks.exportBlob.mockReset();
  mocks.clearOutput.mockReset();
  mocks.clearOutput.mockResolvedValue(undefined);
  mocks.exportBlob.mockResolvedValue('shared');
  mocks.run.mockResolvedValue({ blob: new Blob(['video']), width: 720, height: 1280, usedCodec: 'avc1' });
}

describe('renderQueue', () => {
  it('retries a transient failure once, exports, and cleans OPFS output', async () => {
    resetMocks();
    mocks.run.mockRejectedValueOnce(new NetworkError());

    const results = await renderQueue(file, meta, [clip], null);

    expect(mocks.run).toHaveBeenCalledTimes(2);
    expect(mocks.exportBlob).toHaveBeenCalledTimes(1);
    expect(mocks.cleanup).toHaveBeenCalledTimes(1);
    expect(mocks.dispose).toHaveBeenCalledTimes(2);
    expect(mocks.clearOutput).toHaveBeenCalledTimes(1);
    expect(results).toHaveLength(1);
  });

  it('throws CancelledError instead of returning partial results and still cleans output', async () => {
    resetMocks();
    const controller = new AbortController();
    mocks.run.mockImplementation(() => {
      controller.abort();
      return Promise.reject(new CancelledError());
    });

    await expect(renderQueue(file, meta, [clip], null, { signal: controller.signal })).rejects.toBeInstanceOf(CancelledError);
    expect(mocks.exportBlob).not.toHaveBeenCalled();
    expect(mocks.clearOutput).toHaveBeenCalledTimes(1);
  });

  it('does not retry a non-transient codec failure', async () => {
    resetMocks();
    mocks.run.mockRejectedValue(new UnsupportedCodecError('avc'));

    await expect(renderQueue(file, meta, [clip], null)).rejects.toBeInstanceOf(UnsupportedCodecError);
    expect(mocks.run).toHaveBeenCalledTimes(1);
    expect(mocks.clearOutput).toHaveBeenCalledTimes(1);
  });
});
