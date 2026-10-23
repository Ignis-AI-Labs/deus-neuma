// video-duration.js — how long an MP4 or QuickTime video runs, read from its
// movie header (`moov` → `mvhd`: timescale and duration, ISO/IEC 14496-12
// §8.2.2), so a channel with a length limit (TikTok: the account's
// max_video_post_duration_sec) refuses a too-long video before any byte is
// sent. Only box headers and the one header box are read, never the media.
// A file whose length cannot be read this way (WebM, a broken box) answers
// null: the platform's own check then has the last word.

import fs from 'fs/promises';

const MAX_BOXES = 4096;

/**
 * Seconds from an `mvhd` box's payload (after its 8-byte box header). Pure.
 * @param {Buffer} payload
 * @returns {number|null}
 */
export const mvhdSeconds = (payload) => {
  if (!payload || payload.length < 20) return null;
  const version = payload[0];
  // v0: creation(4) modification(4) timescale(4) duration(4); v1: 8, 8, 4, 8.
  if (version === 1 && payload.length < 32) return null;
  const timescale = version === 1 ? payload.readUInt32BE(20) : payload.readUInt32BE(12);
  const duration = version === 1 ? Number(payload.readBigUInt64BE(24)) : payload.readUInt32BE(16);
  return timescale > 0 ? duration / timescale : null;
};

// impure — the box at `offset`: {type, start of payload, end}, or null.
const readBoxHeader = async (handle, offset, limit) => {
  if (offset + 8 > limit) return null;
  const head = Buffer.alloc(16);
  const { bytesRead } = await handle.read(head, 0, 16, offset);
  if (bytesRead < 8) return null;
  const size32 = head.readUInt32BE(0);
  const type = head.subarray(4, 8).toString('latin1');
  if (size32 === 1) {
    if (bytesRead < 16) return null;
    const size = Number(head.readBigUInt64BE(8));
    return size >= 16 ? { type, payload: offset + 16, end: offset + size } : null;
  }
  const end = size32 === 0 ? limit : offset + size32;
  return size32 === 0 || size32 >= 8 ? { type, payload: offset + 8, end } : null;
};

// impure — the first box of `type` among siblings in [from, limit).
const findBox = async (handle, type, from, limit) => {
  let offset = from;
  for (let i = 0; i < MAX_BOXES; i += 1) {
    const box = await readBoxHeader(handle, offset, limit);
    if (!box || box.end > limit) return null;
    if (box.type === type) return box;
    offset = box.end;
  }
  return null;
};

/**
 * The video's length in seconds, or null when it cannot be read. impure — disk.
 * @param {string} absPath
 * @param {number} size - the file's size
 * @returns {Promise<number|null>}
 */
export const readVideoSeconds = async (absPath, size) => {
  const handle = await fs.open(absPath, 'r');
  try {
    const moov = await findBox(handle, 'moov', 0, size);
    const mvhd = moov ? await findBox(handle, 'mvhd', moov.payload, moov.end) : null;
    if (!mvhd) return null;
    const length = Math.min(mvhd.end - mvhd.payload, 128);
    const payload = Buffer.alloc(length);
    const { bytesRead } = await handle.read(payload, 0, length, mvhd.payload);
    return mvhdSeconds(payload.subarray(0, bytesRead));
  } finally {
    await handle.close();
  }
};
