export type OutputChunk = { data: Uint8Array<ArrayBufferLike>; position: number };

export type OutputSink = {
  name: string;
  writable: WritableStream<OutputChunk>;
  finish: () => Promise<Blob>;
  cleanup: () => Promise<void>;
  usesOpfs: boolean;
};

/** Assemble out-of-order chunks at byte offsets (StreamTarget contract). */
export function writeChunkAt(
  target: Uint8Array<ArrayBuffer>,
  position: number,
  data: Uint8Array<ArrayBufferLike>,
): Uint8Array<ArrayBuffer> {
  const needed = position + data.length;
  if (needed <= target.length) {
    target.set(data, position);
    return target;
  }
  const grown = new Uint8Array(new ArrayBuffer(Math.max(needed, target.length * 2)));
  grown.set(target);
  grown.set(data, position);
  return grown;
}

function memorySink(name: string): OutputSink {
  let bytes: Uint8Array<ArrayBuffer> = new Uint8Array(new ArrayBuffer(0));
  return {
    name,
    usesOpfs: false,
    writable: new WritableStream<OutputChunk>({
      write(chunk) {
        bytes = writeChunkAt(bytes, chunk.position, chunk.data);
      },
    }),
    finish: async () => new Blob([bytes.slice()], { type: 'video/mp4' }),
    cleanup: async () => undefined,
  };
}

export async function createOutputSink(name: string): Promise<OutputSink> {
  if (typeof navigator === 'undefined' || typeof navigator.storage?.getDirectory !== 'function') {
    return memorySink(name);
  }
  try {
    const root = await navigator.storage.getDirectory();
    const handle = await root.getFileHandle(name, { create: true });
    const writer = await handle.createWritable();
    const writable = new WritableStream<OutputChunk>({
      write: async (chunk) => {
        const data = new Uint8Array(chunk.data);
        await writer.write({ type: 'write', position: chunk.position, data });
      },
      close: async () => writer.close(),
      abort: async () => writer.abort(),
    });
    return {
      name,
      usesOpfs: true,
      writable,
      finish: async () => handle.getFile(),
      cleanup: async () => {
        try {
          await root.removeEntry(name);
        } catch {
          // File may already have been removed; ignore.
        }
      },
    };
  } catch {
    return memorySink(name);
  }
}

export async function clearOutputDirectory(): Promise<void> {
  if (typeof navigator === 'undefined' || typeof navigator.storage?.getDirectory !== 'function') return;
  try {
    const root = await navigator.storage.getDirectory();
    const withEntries = root as FileSystemDirectoryHandle & {
      entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
    };
    for await (const [name] of withEntries.entries()) {
      if (name.startsWith('clip-') && name.endsWith('.mp4')) await root.removeEntry(name);
    }
  } catch {
    // OPFS unavailable; nothing to clean.
  }
}
