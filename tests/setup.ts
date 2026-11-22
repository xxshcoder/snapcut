import { beforeAll } from 'vitest';
import 'fake-indexeddb/auto';

beforeAll(() => {
  // jsdom/node do not provide crypto.subtle in every test environment.
  if (!globalThis.crypto?.subtle) {
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: {
        subtle: {
          digest: async (_algorithm: string, data: ArrayBufferView) => {
            const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
            let hash = 2166136261;
            for (const byte of bytes) hash = Math.imul(hash ^ byte, 16777619);
            const out = new Uint8Array(32);
            new DataView(out.buffer).setUint32(0, hash >>> 0);
            return out.buffer;
          },
        },
      },
    });
  }
});
