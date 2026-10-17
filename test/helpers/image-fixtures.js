// image-fixtures.js — REAL image bytes for the vision path's tests.
//
// A valid solid-color PNG built from primitives (no fixture files, no
// fakery: zlib deflate + CRC32 per the PNG spec). The vision integration
// test shows this to the actual substrate and asks what color it sees.

import { deflateSync } from 'zlib';

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

const chunk = (type, data) => {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), body.length + 4);
  return out;
};

// pure — the PNG container around w×h truecolor scanlines (filter byte + RGB per row).
const encodePng = (w, h, raw) => {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // color type: truecolor
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
};

/**
 * A w×h solid-color PNG. Pure.
 * @param {[number, number, number]} rgb
 * @param {number} [w]
 * @param {number} [h]
 * @returns {Buffer}
 */
export const solidPng = (rgb, w = 32, h = 32) => {
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, Buffer.from(rgb))]);
  return encodePng(w, h, Buffer.concat(Array.from({ length: h }, () => row)));
};

/**
 * A w×h truecolor PNG whose pixel (x, y) is rgbAt(x, y) — for pictures whose
 * content only sight can read (the vision-proof digits). Pure.
 * @param {number} w
 * @param {number} h
 * @param {(x: number, y: number) => [number, number, number]} rgbAt
 * @returns {Buffer}
 */
export const pixelPng = (w, h, rgbAt) => encodePng(w, h, Buffer.concat(Array.from({ length: h }, (_, y) =>
  Buffer.from([0, ...Array.from({ length: w }, (__, x) => rgbAt(x, y)).flat()]))));

/** A solid-color PNG as an image/png data URI. Pure. */
export const solidPngDataUri = (rgb, w = 32, h = 32) =>
  `data:image/png;base64,${solidPng(rgb, w, h).toString('base64')}`;
