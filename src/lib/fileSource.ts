import { ALL_FORMATS, BlobSource, Input } from 'mediabunny';
import { LIMITS } from '../config';
import { InvalidInputError, NoAudioTrackError } from './errors';
import type { FileId, FileMeta } from '../types';

/** Stable id from name + size + lastModified. Never reads file bytes. */
export async function computeFileId(file: File): Promise<FileId> {
  const key = `${file.name}\u0000${file.size}\u0000${file.lastModified}`;
  const data = new TextEncoder().encode(key);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('').slice(0, 24);
}

export function createInput(file: File): Input {
  // BlobSource performs bounded ranged reads. `file.arrayBuffer()` is never used.
  return new Input({ formats: ALL_FORMATS, source: new BlobSource(file, { maxCacheSize: 8 * 1024 * 1024 }) });
}

export async function probeFile(file: File): Promise<FileMeta> {
  const fileId = await computeFileId(file);
  const input = createInput(file);
  try {
    if (!(await input.canRead())) {
      throw new InvalidInputError(`"${file.name}" is not a readable media file.`);
    }
    const durationSec = await input.computeDuration();
    const videoTrack = await input.getPrimaryVideoTrack();
    const audioTrack = await input.getPrimaryAudioTrack();
    if (!videoTrack) throw new InvalidInputError('No video track was found in this file.');
    if (!audioTrack) throw new NoAudioTrackError();

    return {
      fileId,
      name: file.name,
      size: file.size,
      durationSec,
      width: await videoTrack.getDisplayWidth(),
      height: await videoTrack.getDisplayHeight(),
      hasAudio: true,
      audioCodec: await audioTrack.getCodec(),
      videoCodec: await videoTrack.getCodec(),
      canDecodeVideo: await videoTrack.canDecode(),
      canDecodeAudio: await audioTrack.canDecode(),
    };
  } finally {
    input.dispose();
  }
}

export function assertWithinLimits(meta: Pick<FileMeta, 'size' | 'durationSec'>, isMobile: boolean): void {
  const limits = isMobile ? LIMITS.phone : LIMITS.desktop;
  if (meta.size > limits.maxBytes) {
    throw new InvalidInputError(
      `File is too large (${(meta.size / 1e9).toFixed(1)} GB > ${(limits.maxBytes / 1e9).toFixed(0)} GB).`,
    );
  }
  if (meta.durationSec > limits.maxDurationSec) {
    throw new InvalidInputError(
      `Video is too long (${Math.round(meta.durationSec / 60)} min > ${Math.round(limits.maxDurationSec / 60)} min).`,
    );
  }
}
