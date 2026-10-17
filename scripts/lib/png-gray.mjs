/**
 * Minimal 8-bit greyscale PNG encoder.
 *
 * The aura proof has to be LOOKED at, and looking needs a file. LINE & CYCLE is
 * monochrome at rest, so greyscale is not a shortcut — it is the register the
 * design language already speaks. Two chunks, one filter mode, node:zlib for
 * the deflate: no dependency earns its place here (AGENTS.md RULE 4).
 */

import { deflateSync } from 'node:zlib';

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

const crc32 = (buf) => {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

const chunk = (type, data) => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
};

/**
 * Encode a greyscale raster as a PNG. Pure.
 * @param {Uint8Array} pixels - `width * height` bytes, row-major, 0 = black
 * @param {number} width
 * @param {number} height
 * @returns {Buffer}
 */
export const encodeGrayPNG = (pixels, width, height) => {
  if (pixels.length !== width * height) {
    throw new Error(`expected ${width * height} pixels, received ${pixels.length}`);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 0;  // colour type: greyscale
  // 10..12 = compression, filter, interlace — all zero, the only modes we emit

  const raw = Buffer.alloc((width + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width + 1)] = 0; // filter: none
    Buffer.from(pixels.buffer, pixels.byteOffset + y * width, width)
      .copy(raw, y * (width + 1) + 1);
  }

  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
};
