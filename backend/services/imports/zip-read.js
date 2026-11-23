// zip-read — the entries of a .zip (a Claude or ChatGPT data export), read in place: no unpacking,
// no new dependency, nothing written. Stored and deflated entries, zip64 included (a big export can
// pass 4 GB with its images). Only the entries asked for are read, and one larger than the caller's
// limit is refused by name rather than half-read. impure (file reads)
import fs from 'node:fs/promises';
import zlib from 'node:zlib';
import { promisify } from 'node:util';

const inflateRaw = promisify(zlib.inflateRaw);

const SIG = Object.freeze({ eocd: 0x06054b50, z64Locator: 0x07064b50, z64Eocd: 0x06064b50, central: 0x02014b50, local: 0x04034b50 });
const TAIL_MAX = 22 + 65_535; // the end record and the longest comment it may carry
const MAX32 = 0xffffffff;

// impure — `len` bytes from `pos`
const readAt = async (fh, pos, len) => {
  const buf = Buffer.alloc(len);
  const { bytesRead } = await fh.read(buf, 0, len, pos);
  return buf.subarray(0, bytesRead);
};

// impure — where the central directory is and how many entries it holds
const directoryOf = async (fh, size) => {
  const tailLen = Math.min(size, TAIL_MAX);
  const tail = await readAt(fh, size - tailLen, tailLen);
  const at = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (at < 0) throw new Error('not a zip file');
  const plain = { count: tail.readUInt16LE(at + 10), size: tail.readUInt32LE(at + 12), offset: tail.readUInt32LE(at + 16) };
  if (plain.offset !== MAX32 && plain.count !== 0xffff) return plain;
  const loc = at - 20;
  if (loc < 0 || tail.readUInt32LE(loc) !== SIG.z64Locator) throw new Error('the zip says it is zip64 but has no zip64 record');
  const z = await readAt(fh, Number(tail.readBigUInt64LE(loc + 8)), 56);
  if (z.readUInt32LE(0) !== SIG.z64Eocd) throw new Error('the zip64 record is damaged');
  return { count: Number(z.readBigUInt64LE(32)), size: Number(z.readBigUInt64LE(40)), offset: Number(z.readBigUInt64LE(48)) };
};

/** The entries of a central directory. Pure. */
const parseDirectory = (cd, count) => {
  const entries = [];
  let p = 0;
  for (let i = 0; i < count; i += 1) {
    if (p + 46 > cd.length || cd.readUInt32LE(p) !== SIG.central) throw new Error('the zip directory is damaged');
    const nameLen = cd.readUInt16LE(p + 28);
    const extraEnd = p + 46 + nameLen + cd.readUInt16LE(p + 30);
    const entry = {
      name: cd.toString('utf8', p + 46, p + 46 + nameLen),
      method: cd.readUInt16LE(p + 10),
      compSize: cd.readUInt32LE(p + 20),
      size: cd.readUInt32LE(p + 24),
      offset: cd.readUInt32LE(p + 42),
    };
    // zip64: the real sizes and offset ride in extra field 0x0001, in this order, only where maxed out
    for (let e = p + 46 + nameLen; e + 4 <= extraEnd; e += 4 + cd.readUInt16LE(e + 2)) {
      if (cd.readUInt16LE(e) !== 0x0001) continue;
      let q = e + 4;
      for (const key of ['size', 'compSize', 'offset']) {
        if (entry[key] === MAX32) { entry[key] = Number(cd.readBigUInt64LE(q)); q += 8; }
      }
    }
    entries.push(entry);
    p = extraEnd + cd.readUInt16LE(p + 32);
  }
  return entries;
};

/**
 * Open a zip for reading. Close it when done. impure
 * @param {string} file
 * @returns {Promise<{entries: Array<{name: string, size: number}>, read: (name: string, max: number) => Promise<Buffer>, close: () => Promise<void>}>}
 */
export const openZip = async (file) => {
  const fh = await fs.open(file, 'r');
  try {
    const { size } = await fh.stat();
    const dir = await directoryOf(fh, size);
    const entries = parseDirectory(await readAt(fh, dir.offset, dir.size), dir.count);
    const byName = new Map(entries.map((e) => [e.name, e]));
    const read = async (name, max) => {
      const entry = byName.get(name);
      if (!entry) throw new Error(`${name} is not in the zip`);
      if (entry.size > max) throw new Error(`${name} is ${entry.size.toLocaleString('en-US')} bytes, more than the ${max.toLocaleString('en-US')} this import reads`);
      const local = await readAt(fh, entry.offset, 30);
      if (local.readUInt32LE(0) !== SIG.local) throw new Error(`${name}: the zip entry is damaged`);
      const start = entry.offset + 30 + local.readUInt16LE(26) + local.readUInt16LE(28);
      const raw = await readAt(fh, start, entry.compSize);
      if (entry.method === 0) return raw;
      if (entry.method === 8) return inflateRaw(raw);
      throw new Error(`${name} is packed in a way this import does not read (method ${entry.method})`);
    };
    return { entries: entries.map(({ name, size: n }) => ({ name, size: n })), read, close: () => fh.close() };
  } catch (error) {
    await fh.close();
    throw error;
  }
};
