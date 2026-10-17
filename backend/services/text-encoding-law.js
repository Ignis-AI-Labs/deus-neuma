/**
 * The text-encoding law — one home for every guard that stops a UTF-8
 * rewrite from destroying bytes it never read (#239 the desk editor's save,
 * #290 the being's MCP write). Extracted from user-files.js when the wall
 * gained its second lane; nothing here knows about roots, routes, or seats —
 * callers own containment.
 */
import fs from 'fs/promises';
import path from 'path';

// Refuse to LOAD files larger than this as text; the write guards examine at
// most this many bytes (exported so tests pin behavior AT the bound, never a
// copied number that drifts).
export const MAX_TEXT_BYTES = 2 * 1024 * 1024;

/** Sniff a leading binary signature (NUL byte) in the first chunk. */
export const looksBinary = (buf) => {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i += 1) if (buf[i] === 0) return true;
  return false;
};

/**
 * TRUE when these bytes cannot survive a UTF-8 decode → encode round trip.
 *
 * `looksBinary` asks […] when the decision it gates is […]. Those two coincide for UTF-16
 * and executables and DIVERGE for every single-byte legacy encoding — Latin-1,
 * Windows-1252, Shift-JIS — which is precisely the set of files most likely to
 * be old, unbacked and irreplaceable (#239). `Buffer.prototype.toString('utf8')`
 * is defined to be lossy: it substitutes U+FFFD rather than failing, and records
 * nothing, so the writer downstream cannot know the string it holds is not the
 * file.
 *
 * This is EXACT, not a heuristic: it re-encodes what it decoded and compares
 * bytes. Bounded by MAX_TEXT_BYTES at every call site.
 * @param {Buffer} buf
 * @returns {boolean}
 */
export const isLossyAsUtf8 = (buf) => !buf.equals(Buffer.from(buf.toString('utf8'), 'utf8'));

/**
 * How many characters a UTF-8 read would silently replace with U+FFFD.
 *
 * A file may legitimately already CONTAIN U+FFFD (the bytes EF BF BD) — those
 * are not damage, so they are subtracted. The result is what the operator would
 * actually lose, which is the only number worth putting on screen.
 * @param {Buffer} buf
 * @returns {number}
 */
export const lossyCharCount = (buf) => {
  let decoded = 0;
  for (const ch of buf.toString('utf8')) if (ch === '�') decoded += 1;
  let literal = 0;
  for (let i = 0; i + 2 < buf.length; i += 1) {
    if (buf[i] === 0xef && buf[i + 1] === 0xbf && buf[i + 2] === 0xbd) literal += 1;
  }
  return Math.max(0, decoded - literal);
};

/**
 * Read at most MAX_TEXT_BYTES from the head of a file (the lossy guard's cost
 * bound — a whole-file read of an arbitrarily large target would make every
 * save O(target size) with no ceiling).
 * @param {string} real - contained real path
 * @param {number} size - the file's stat size
 * @returns {Promise<Buffer>}
 */
// impure
const readHead = async (real, size) => {
  const n = Math.min(size, MAX_TEXT_BYTES);
  const fh = await fs.open(real, 'r');
  try {
    const buf = Buffer.alloc(n);
    const { bytesRead } = await fh.read(buf, 0, n, 0);
    return bytesRead === n ? buf : buf.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
};

/**
 * Drop a trailing multi-byte sequence the prefix bound cut in half (pure).
 * A valid UTF-8 file larger than the bound can land a lead byte exactly at
 * the cut; decoding the orphaned lead yields U+FFFD and the guard would
 * refuse a perfectly writable file. Only a sequence that CANNOT complete
 * inside the prefix is dropped — a genuinely invalid lead (0xC0/0xC1, 0xF5+)
 * stays, and stays refused.
 * @param {Buffer} buf
 * @returns {Buffer}
 */
const utf8CompletePrefix = (buf) => {
  for (let back = 1; back <= 3 && back <= buf.length; back += 1) {
    const b = buf[buf.length - back];
    if ((b & 0xc0) === 0x80) continue; // continuation byte — walk back to its lead
    let need = 1; // ASCII, or an invalid lead — complete either way
    if (b >= 0xc2 && b <= 0xdf) need = 2;
    else if (b >= 0xe0 && b <= 0xef) need = 3;
    else if (b >= 0xf0 && b <= 0xf4) need = 4;
    return need > back ? buf.subarray(0, buf.length - back) : buf;
  }
  return buf;
};

/**
 * The lossy verdict for an existing file's bytes: null when a UTF-8 rewrite
 * is safe, else `{prefixed, count}` — whether only a prefix was examined, and
 * how many characters a rewrite would destroy (a lower bound when prefixed).
 * The ONE judgment behind every encoding guard.
 * @param {string} real - resolved path (caller owns containment)
 * @param {number} size - the file's stat size
 * @returns {Promise<{prefixed: boolean, count: number}|null>}
 */
// impure
export const lossyVerdict = async (real, size) => {
  const prefixed = size > MAX_TEXT_BYTES;
  const head = await readHead(real, size);
  const prior = prefixed ? utf8CompletePrefix(head) : head;
  if (looksBinary(prior) || !isLossyAsUtf8(prior)) return null;
  return { prefixed, count: lossyCharCount(prior) };
};

/**
 * The reason a full-content UTF-8 write onto this path must be refused, or
 * null when it is safe (#290 — the being lane's wall in tool-sandbox.js).
 * A missing, empty, or binary target is safe: a fresh write is not a rewrite,
 * and text-over-binary is a deliberate replacement. NO root containment here —
 * the caller (the tool sandbox) has already confined the path; the desk lane
 * uses user-files.js `writeFile`, which contains first.
 * @param {string} targetPath - absolute, already-confined path
 * @returns {Promise<string|null>} the honest refusal, or null
 */
// impure
export const encodingWallReason = async (targetPath) => {
  if (typeof targetPath !== 'string' || !path.isAbsolute(targetPath)) return null;
  const st = await fs.stat(targetPath).catch(() => null);
  if (!st?.isFile() || st.size === 0) return null;
  const verdict = await lossyVerdict(targetPath, st.size);
  if (!verdict) return null;
  return `${path.basename(targetPath)} is not UTF-8 — writing through this tool would silently destroy `
    + `${verdict.prefixed ? 'at least ' : ''}${verdict.count} character(s) that cannot be re-encoded. `
    + 'The file was left untouched.';
};
