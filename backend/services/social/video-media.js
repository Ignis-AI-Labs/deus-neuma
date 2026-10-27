/**
 * Video media — the video counterpart of x-media.js's image checks, for the
 * channels whose post IS a video (YouTube).
 *
 * The same doctrine as stills: a file is a video because its MAGIC BYTES say
 * so, never because of its name, and the type handed to the platform is the
 * sniffed one. Unlike a still, a video is never read whole here: only its
 * head is sniffed, and the uploader streams the rest from disk in chunks.
 */

import fs from 'fs/promises';
import path from 'path';

/** YouTube's own ceiling for one upload (videos.insert: 256GB). */
export const VIDEO_MAX_BYTES = 256 * 1024 * 1024 * 1024;

const HEAD_BYTES = 64;

/**
 * Identify a video container by its header. MP4 and QuickTime carry an
 * `ftyp` box at byte 4; WebM and Matroska open with the EBML magic. Pure.
 * @param {Buffer} buf - at least the first 12 bytes of the file
 * @returns {string|null} a MIME type, or null when these bytes are no video we send
 */
export const sniffVideoType = (buf) => {
  if (!buf || buf.length < 12) return null;
  if (buf.subarray(4, 8).toString('latin1') === 'ftyp') {
    return buf.subarray(8, 12).toString('latin1') === 'qt  ' ? 'video/quicktime' : 'video/mp4';
  }
  if (buf[0] === 0x1A && buf[1] === 0x45 && buf[2] === 0xDF && buf[3] === 0xA3) return 'video/webm';
  return null;
};

/**
 * Check one staged video on disk: a regular, non-empty file within YouTube's
 * ceiling whose head sniffs as a video. The path must already be authorised
 * by the caller (media-source.js). Reads only the head.
 *
 * impure (disk)
 * @param {string} absPath
 * @returns {Promise<{ok: true, path: string, size: number, contentType: string, filename: string}
 *   |{ok: false, detail: string}>}
 */
export const readVideoHead = async (absPath) => {
  let stat;
  try {
    stat = await fs.stat(absPath);
  } catch {
    return { ok: false, detail: `the video file is gone: ${absPath}` };
  }
  if (!stat.isFile()) return { ok: false, detail: `not a regular file: ${absPath}` };
  if (stat.size === 0) return { ok: false, detail: `the video file is empty: ${absPath}` };
  if (stat.size > VIDEO_MAX_BYTES) {
    return { ok: false, detail: `the video is ${Math.round(stat.size / 1024 ** 3)}GB; YouTube takes at most 256GB in one upload` };
  }
  const handle = await fs.open(absPath, 'r');
  let head;
  try {
    const buf = Buffer.alloc(HEAD_BYTES);
    const { bytesRead } = await handle.read(buf, 0, HEAD_BYTES, 0);
    head = buf.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
  const contentType = sniffVideoType(head);
  if (!contentType) {
    return { ok: false, detail: `these bytes are not an MP4, MOV or WebM video, whatever the name says (${path.basename(absPath)})` };
  }
  return { ok: true, path: absPath, size: stat.size, contentType, filename: path.basename(absPath) };
};
