import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearOutputDirectory, createOutputSink, writeChunkAt, type OutputChunk } from '../src/lib/storage/opfs';

const encoder = new TextEncoder();

function stubNavigator(value: Record<string, unknown> | undefined): void {
  vi.stubGlobal('navigator', value);
}

function createFakeOpfs() {
  const writes: { position: number; text: string }[] = [];
  const removed: string[] = [];
  let closed = false;
  let aborted = false;

  const fileHandle = {
    createWritable: async () => ({
      write: async (chunk: { position: number; data: Uint8Array }) => {
        writes.push({ position: chunk.position, text: new TextDecoder().decode(chunk.data) });
      },
      close: async () => {
        closed = true;
      },
      abort: async () => {
        aborted = true;
      },
    }),
    getFile: async () => new Blob(['opfs bytes'], { type: 'video/mp4' }),
  };

  const root = {
    getFileHandle: async () => fileHandle,
    removeEntry: async (name: string) => {
      removed.push(name);
    },
    entries: async function* (): AsyncGenerator<[string, unknown]> {
      yield ['clip-1.mp4', {}];
      yield ['notes.txt', {}];
    },
  };

  stubNavigator({ storage: { getDirectory: async () => root } });
  return { writes, removed, isClosed: () => closed, isAborted: () => aborted };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('writeChunkAt', () => {
  it('writes in place when the chunk fits in the target', () => {
    const target = new Uint8Array(8);

    const result = writeChunkAt(target, 2, new Uint8Array([1, 2]));

    expect(result).toBe(target);
    expect(Array.from(result)).toEqual([0, 0, 1, 2, 0, 0, 0, 0]);
  });

  it('grows the buffer and preserves earlier writes', () => {
    const target = new Uint8Array([1, 2, 3, 4]);

    const result = writeChunkAt(target, 6, new Uint8Array([9, 8, 7]));

    expect(result.length).toBeGreaterThanOrEqual(9);
    expect(Array.from(result.slice(0, 4))).toEqual([1, 2, 3, 4]);
    expect(Array.from(result.slice(6, 9))).toEqual([9, 8, 7]);
  });

  it('overwrites only the requested range', () => {
    const target = new Uint8Array([1, 2, 3, 4, 5]);

    expect(Array.from(writeChunkAt(target, 1, new Uint8Array([9])))).toEqual([1, 9, 3, 4, 5]);
  });
});

describe('createOutputSink fallback', () => {
  it('uses an in-memory sink when navigator is absent', async () => {
    stubNavigator(undefined);

    const sink = await createOutputSink('clip-memory.mp4');
    expect(sink.usesOpfs).toBe(false);
    expect(sink.name).toBe('clip-memory.mp4');

    const writer = sink.writable.getWriter();
    const chunks: OutputChunk[] = [
      { position: 6, data: encoder.encode('world') },
      { position: 0, data: encoder.encode('hello ') },
    ];
    for (const chunk of chunks) await writer.write(chunk);
    await writer.close();

    const blob = await sink.finish();
    expect(blob.type).toBe('video/mp4');
    expect(await blob.text()).toBe('hello world');
    await expect(sink.cleanup()).resolves.toBeUndefined();
  });

  it('falls back when storage or getDirectory is unavailable', async () => {
    stubNavigator({ storage: {} });
    expect((await createOutputSink('a.mp4')).usesOpfs).toBe(false);

    stubNavigator({
      storage: {
        getDirectory: async () => {
          throw new Error('OPFS disabled');
        },
      },
    });
    expect((await createOutputSink('b.mp4')).usesOpfs).toBe(false);
  });
});

describe('createOutputSink with OPFS', () => {
  it('writes chunks at byte offsets, closes, returns the file and cleans up', async () => {
    const opfs = createFakeOpfs();

    const sink = await createOutputSink('clip-opfs.mp4');

    expect(sink.usesOpfs).toBe(true);
    const writer = sink.writable.getWriter();
    await writer.write({ position: 12, data: encoder.encode('payload') });
    expect(opfs.writes).toEqual([{ position: 12, text: 'payload' }]);
    await writer.close();
    expect(opfs.isClosed()).toBe(true);

    expect(await (await sink.finish()).text()).toBe('opfs bytes');
    await sink.cleanup();
    expect(opfs.removed).toEqual(['clip-opfs.mp4']);
  });

  it('forwards aborts to the OPFS writer', async () => {
    const opfs = createFakeOpfs();

    const sink = await createOutputSink('clip-abort.mp4');
    const writer = sink.writable.getWriter();
    await writer.abort();

    expect(opfs.isAborted()).toBe(true);
  });
});

describe('clearOutputDirectory', () => {
  it('removes only completed clip files', async () => {
    const opfs = createFakeOpfs();

    await clearOutputDirectory();

    expect(opfs.removed).toEqual(['clip-1.mp4']);
  });

  it('is a no-op without OPFS or when OPFS fails', async () => {
    stubNavigator(undefined);
    await expect(clearOutputDirectory()).resolves.toBeUndefined();

    stubNavigator({ storage: {} });
    await expect(clearOutputDirectory()).resolves.toBeUndefined();

    stubNavigator({
      storage: {
        getDirectory: async () => {
          throw new Error('OPFS disabled');
        },
      },
    });
    await expect(clearOutputDirectory()).resolves.toBeUndefined();
  });
});
