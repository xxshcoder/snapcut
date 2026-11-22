/**
 * Minimal MP4 metadata reader for the e2e smoke test. It reads the movie
 * duration from `mvhd` and the video dimensions from `tkhd` (or `stsd`), so the
 * test can verify the downloaded file itself instead of trusting the UI.
 */

export type Mp4Metadata = { durationSec: number; width: number; height: number };

type Box = { type: string; payloadStart: number; payloadEnd: number };

const VISUAL_SAMPLE_ENTRIES = /^(avc1|avc3|hev1|hvc1|vp09|av01)$/;

function assertRange(bytes: Uint8Array, offset: number, length: number): void {
  if (offset < 0 || length < 0 || offset + length > bytes.length) {
    throw new Error('MP4 box extends beyond the file');
  }
}

function u16(bytes: Uint8Array, offset: number): number {
  assertRange(bytes, offset, 2);
  return ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0);
}

function u32(bytes: Uint8Array, offset: number): number {
  assertRange(bytes, offset, 4);
  return (
    ((bytes[offset] ?? 0) * 0x1000000) +
    ((bytes[offset + 1] ?? 0) * 0x10000) +
    ((bytes[offset + 2] ?? 0) * 0x100) +
    (bytes[offset + 3] ?? 0)
  );
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  assertRange(bytes, start, end - start);
  return String.fromCharCode(...bytes.subarray(start, end));
}

function dataView(bytes: Uint8Array, start: number, length: number): DataView {
  assertRange(bytes, start, length);
  return new DataView(bytes.buffer, bytes.byteOffset + start, length);
}

function readBoxes(bytes: Uint8Array, start: number, end: number): Box[] {
  assertRange(bytes, start, 0);
  if (end > bytes.length) throw new Error('MP4 box extends beyond the file');

  const boxes: Box[] = [];
  let offset = start;
  while (offset + 8 <= end) {
    const size32 = u32(bytes, offset);
    const type = ascii(bytes, offset + 4, offset + 8);
    let headerSize = 8;
    let size = size32;

    if (size32 === 1) {
      headerSize = 16;
      const largeSize = dataView(bytes, offset + 8, 8).getBigUint64(0);
      size = Number(largeSize);
      if (!Number.isSafeInteger(size)) throw new Error(`MP4 box ${type} has an unsupported size`);
    } else if (size32 === 0) {
      size = end - offset;
    }

    if (size < headerSize || offset + size > end) break;
    boxes.push({ type, payloadStart: offset + headerSize, payloadEnd: offset + size });
    offset += size;
  }
  return boxes;
}

function descendants(bytes: Uint8Array, parent: Box): Box[] {
  const result: Box[] = [];
  for (const child of readBoxes(bytes, parent.payloadStart, parent.payloadEnd)) {
    result.push(child, ...descendants(bytes, child));
  }
  return result;
}

export function parseMp4Metadata(bytes: Uint8Array): Mp4Metadata {
  const moov = readBoxes(bytes, 0, bytes.length).find((box) => box.type === 'moov');
  if (!moov) throw new Error('Exported MP4 has no moov box');

  const boxes = descendants(bytes, moov);
  const mvhd = boxes.find((box) => box.type === 'mvhd');
  if (!mvhd) throw new Error('Exported MP4 has no mvhd box');

  const mvhdLength = mvhd.payloadEnd - mvhd.payloadStart;
  if (mvhdLength < 1) throw new Error('Exported MP4 mvhd box is empty');
  const view = dataView(bytes, mvhd.payloadStart, mvhdLength);
  const version = view.getUint8(0);

  let timescale: number;
  let rawDuration: number;
  if (version === 1) {
    if (mvhdLength < 32) throw new Error('Exported MP4 mvhd box is truncated');
    timescale = view.getUint32(20);
    rawDuration = Number(view.getBigUint64(24));
  } else {
    if (mvhdLength < 20) throw new Error('Exported MP4 mvhd box is truncated');
    timescale = view.getUint32(12);
    rawDuration = view.getUint32(16);
  }
  if (timescale <= 0 || !Number.isFinite(rawDuration)) {
    throw new Error('Exported MP4 has an invalid duration');
  }

  let width = 0;
  let height = 0;
  for (const trak of boxes.filter((box) => box.type === 'trak')) {
    const trakBoxes = descendants(bytes, trak);
    const hdlr = trakBoxes.find((box) => box.type === 'hdlr');
    if (!hdlr || hdlr.payloadEnd - hdlr.payloadStart < 12) continue;
    if (ascii(bytes, hdlr.payloadStart + 8, hdlr.payloadStart + 12) !== 'vide') continue;

    const tkhd = trakBoxes.find((box) => box.type === 'tkhd');
    if (tkhd && tkhd.payloadEnd - tkhd.payloadStart >= 8) {
      width = u32(bytes, tkhd.payloadEnd - 8) / 0x10000;
      height = u32(bytes, tkhd.payloadEnd - 4) / 0x10000;
    }

    if (!width || !height) {
      const stsd = trakBoxes.find((box) => box.type === 'stsd');
      if (stsd && stsd.payloadEnd - stsd.payloadStart >= 8) {
        for (const entry of readBoxes(bytes, stsd.payloadStart + 8, stsd.payloadEnd)) {
          if (!VISUAL_SAMPLE_ENTRIES.test(entry.type)) continue;
          if (entry.payloadEnd - entry.payloadStart < 28) continue;
          width = u16(bytes, entry.payloadStart + 24);
          height = u16(bytes, entry.payloadStart + 26);
          break;
        }
      }
    }
    if (width && height) break;
  }

  if (!width || !height) throw new Error('Exported MP4 has no readable video dimensions');
  return { durationSec: rawDuration / timescale, width, height };
}
