import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

function crc32(buf) {
  let crc = 0xffffffff;
  for (const byte of buf) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}

function makePng(size) {
  const row = Buffer.alloc(size * 4 + 1);
  for (let x = 0; x < size; x++) {
    const i = x * 4 + 1;
    const inset = size * 0.18;
    const inside = x > inset && x < size - inset;
    row[i] = inside ? 244 : 11;
    row[i + 1] = inside ? 77 : 11;
    row[i + 2] = inside ? 255 : 18;
    row[i + 3] = 255;
  }
  const raw = Buffer.concat(Array.from({ length: size }, () => row));
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const dir = join(process.cwd(), 'public', 'icons');
mkdirSync(dir, { recursive: true });
for (const size of [192, 512]) writeFileSync(join(dir, `icon-${size}.png`), makePng(size));
console.log('Generated placeholder PWA icons.');
