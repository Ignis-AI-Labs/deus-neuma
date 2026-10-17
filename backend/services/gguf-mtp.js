/**
 * Does this GGUF carry multi-token-prediction heads? The serving model's MTP
 * layers draft several tokens per step (--spec-type draft-mtp): measured on
 * this rig 2026-09-25, qwen3.8-27B Q8 went from ~38 to ~57–73 tok/s at the
 * production slot flags, output unchanged in kind. The flag on a model WITHOUT
 * the heads fails the launch, so the fact is read from the file's own
 * metadata (`<arch>.nextn_predict_layers`), never guessed from a filename.
 *
 * The metadata sits ahead of the tensor data but after the tokenizer tables
 * (~11 MB into this model), so the read is bounded, and anything unparsed or
 * past the bound answers 0: unknown never turns MTP on.
 */
import fs from 'node:fs/promises';

const METADATA_READ_MAX = 64 * 1024 * 1024;
const KEY_SUFFIX = '.nextn_predict_layers';
// GGUF value types → fixed byte width (8 string, 9 array are variable).
const FIXED_WIDTH = Object.freeze({ 0: 1, 1: 1, 2: 2, 3: 2, 4: 4, 5: 4, 6: 4, 7: 1, 10: 8, 11: 8, 12: 8 });

/**
 * Pure — the nextn layer count from a GGUF header buffer, or 0 when the key
 * is absent, the buffer is not GGUF, or the metadata runs past the buffer.
 * @param {Buffer} buf
 * @returns {number}
 */
export const nextnLayersFromGguf = (buf) => {
  if (!Buffer.isBuffer(buf) || buf.length < 24 || buf.toString('latin1', 0, 4) !== 'GGUF') return 0;
  let at = 24; // magic u32, version u32, tensor_count u64, kv_count u64
  const kvCount = Number(buf.readBigUInt64LE(16));
  const need = (n) => { if (at + n > buf.length) throw new RangeError('past buffer'); };
  const str = () => {
    need(8); const len = Number(buf.readBigUInt64LE(at)); at += 8;
    need(len); const s = buf.toString('utf8', at, at + len); at += len; return s;
  };
  const skip = (type) => {
    if (type === 8) { str(); return; }
    if (type === 9) {
      need(12); const inner = buf.readUInt32LE(at); const count = Number(buf.readBigUInt64LE(at + 4)); at += 12;
      if (inner in FIXED_WIDTH) { need(FIXED_WIDTH[inner] * count); at += FIXED_WIDTH[inner] * count; return; }
      for (let i = 0; i < count; i += 1) skip(inner);
      return;
    }
    if (!(type in FIXED_WIDTH)) throw new TypeError(`unknown gguf type ${type}`);
    need(FIXED_WIDTH[type]); at += FIXED_WIDTH[type];
  };
  try {
    for (let i = 0; i < kvCount; i += 1) {
      const key = str();
      need(4); const type = buf.readUInt32LE(at); at += 4;
      if (key.endsWith(KEY_SUFFIX) && (type === 4 || type === 5)) {
        need(4); return type === 4 ? buf.readUInt32LE(at) : Math.max(0, buf.readInt32LE(at));
      }
      skip(type);
    }
  } catch {
    return 0;
  }
  return 0;
};

/**
 * Impure — read the bounded header of the model file and answer whether it
 * carries MTP heads. Any read failure answers false.
 * @param {string} modelPath
 * @returns {Promise<boolean>}
 */
export const modelHasMtpHeads = async (modelPath) => {
  let handle;
  try {
    handle = await fs.open(modelPath, 'r');
    const buf = Buffer.alloc(METADATA_READ_MAX);
    const { bytesRead } = await handle.read(buf, 0, METADATA_READ_MAX, 0);
    return nextnLayersFromGguf(buf.subarray(0, bytesRead)) > 0;
  } catch {
    return false;
  } finally {
    await handle?.close();
  }
};
