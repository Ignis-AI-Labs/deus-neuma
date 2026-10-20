/**
 * AI DISCLOSURE — every forge output says, in its own file, that it is
 * AI-generated. The house never hides that its work is AI-made: concealment
 * only costs the craft its standing, and model licences and AI-transparency
 * law (the LTX-2.x licence, the EU AI Act, California's AI Transparency Act)
 * expect the disclosure to travel with the output.
 *
 * The engine still launches with `--disable-metadata`: that keeps a being's
 * prompt and full workflow out of files that get posted. This stamps back ONLY
 * the disclosure — never the prompt.
 *   · PNG: `tEXt` chunks (Software, Comment, Description) after IHDR.
 *   · MP4: container tags (comment, description) by a stream-copy remux — no
 *     re-encode, the pixels and sound are untouched.
 * The IPTC digital-source-type term for generated media, `trainedAlgorithmicMedia`,
 * is named in the text so a reader that knows the vocabulary finds it.
 */
import { execFileSync } from 'child_process';
import { readFileSync, renameSync, rmSync, writeFileSync } from 'fs';
import { crc32 } from 'zlib';
import { createLogger } from '../logger.js';

const log = createLogger('ImageForge.Disclosure');
const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export const SOFTWARE = 'Deus Neuma Image & Video Forge';
export const DISCLOSURE = 'AI-generated content (digital source type: trainedAlgorithmicMedia), made with the Deus Neuma Image & Video Forge.';

// pure — one PNG tEXt chunk (Latin-1 keyword and text, CRC over type + data)
const textChunk = (keyword, text) => {
  const data = Buffer.concat([Buffer.from(keyword, 'latin1'), Buffer.from([0]), Buffer.from(text, 'latin1')]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const type = Buffer.from('tEXt', 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([type, data])) >>> 0);
  return Buffer.concat([length, type, data, crc]);
};

/**
 * The PNG with the disclosure chunks placed right after IHDR. Pure.
 * @param {Buffer} png
 * @returns {Buffer|null} null when the bytes are not a PNG
 */
export const stampPng = (png) => {
  if (!Buffer.isBuffer(png) || png.length < 33 || !png.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  if (png.toString('latin1', 12, 16) !== 'IHDR') return null;
  const afterIhdr = 8 + 12 + png.readUInt32BE(8);
  return Buffer.concat([
    png.subarray(0, afterIhdr),
    textChunk('Software', SOFTWARE),
    textChunk('Comment', DISCLOSURE),
    textChunk('Description', DISCLOSURE),
    png.subarray(afterIhdr),
  ]);
};

// impure — remux an mp4 with the disclosure tags, in place
const stampMp4 = (file) => {
  const tmp = `${file}.disclosed.mp4`;
  try {
    execFileSync(FFMPEG, ['-v', 'error', '-y', '-i', file, '-map', '0', '-c', 'copy',
      '-metadata', `comment=${DISCLOSURE}`, '-metadata', `description=${DISCLOSURE}`,
      '-movflags', '+use_metadata_tags', tmp], { timeout: 60_000 });
    renameSync(tmp, file);
  } finally {
    rmSync(tmp, { force: true });
  }
};

/**
 * Stamp one stored output with its AI disclosure. Impure. Never throws: a file
 * that cannot be stamped is reported (false) and logged, never lost.
 * @param {string} file
 * @param {string} mime
 * @returns {boolean} whether the file now carries the disclosure
 */
export const stampDisclosure = (file, mime) => {
  try {
    if (mime === 'image/png') {
      const stamped = stampPng(readFileSync(file));
      if (!stamped) return false;
      writeFileSync(file, stamped);
      return true;
    }
    if (mime === 'video/mp4') {
      stampMp4(file);
      return true;
    }
    return false;
  } catch (err) {
    log.warn('an output could not carry its AI disclosure', { mime, err: err.message });
    return false;
  }
};
