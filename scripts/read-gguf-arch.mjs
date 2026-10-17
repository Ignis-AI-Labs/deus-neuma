#!/usr/bin/env node
/**
 * read-gguf-arch.mjs — read a GGUF's own architecture metadata from the weights.
 *
 * Why this exists: model behavior facts (KV-cache reuse safety, window, family)
 * must come from the weights, not from a name. The 2026-08-23 finding that
 * qwen3.8 carries `qwen35.ssm.*` — recurrent state, the same class as gemma-4's
 * Gated DeltaNet — was made with this reader, and it overturned a plausible
 * assumption that the substrate was a pure transformer.
 *
 * Reads only the KV header; never loads tensor data.
 *
 * Usage: node scripts/read-gguf-arch.mjs <file.gguf> [...]
 */
import { open } from 'node:fs/promises';

const FIXED = { 0: 1, 1: 1, 2: 2, 3: 2, 4: 4, 5: 4, 6: 4, 7: 1, 10: 8, 11: 8, 12: 8 };
const READ = {
  0: (b, o) => b.readInt8(o), 1: (b, o) => b.readUInt8(o),
  2: (b, o) => b.readInt16LE(o), 3: (b, o) => b.readUInt16LE(o),
  4: (b, o) => b.readInt32LE(o), 5: (b, o) => b.readUInt32LE(o),
  6: (b, o) => b.readFloatLE(o), 7: (b, o) => b.readUInt8(o) !== 0,
  10: (b, o) => b.readBigInt64LE(o), 11: (b, o) => b.readBigUInt64LE(o),
  12: (b, o) => b.readDoubleLE(o),
};

/** A forward-only cursor over the header. The GGUF KV block is strictly sequential. */
const cursor = (buf) => {
  let at = 0;
  const take = (n) => { const s = at; at += n; return buf.subarray(s, at); };
  return {
    at: () => at,
    skip: (n) => { at += n; },
    u32: () => READ[5](take(4), 0),
    u64: () => Number(READ[11](take(8), 0)),
    str: () => { const n = Number(READ[11](take(8), 0)); return take(n).toString('utf8'); },
    fixed: (t) => READ[t](take(FIXED[t]), 0),
  };
};

/** Consume one value of type `t` without materializing it. */
const skipValue = (c, t) => {
  if (t === 8) { c.str(); return; }
  if (t === 9) {
    const et = c.u32(); const n = c.u64();
    if (et === 8) { for (let i = 0; i < n; i += 1) c.str(); }
    else if (et === 9) { for (let i = 0; i < n; i += 1) skipValue(c, 9); }
    else c.skip(FIXED[et] * n);
    return;
  }
  c.skip(FIXED[t]);
};

/** Read one value of type `t`, truncating long arrays to a readable head. */
const readValue = (c, t) => {
  if (t === 8) return c.str();
  if (t === 9) {
    const et = c.u32(); const n = c.u64();
    const head = [];
    for (let i = 0; i < n; i += 1) {
      const v = et === 8 ? c.str() : et === 9 ? (skipValue(c, 9), null) : c.fixed(et);
      if (head.length < 4) head.push(typeof v === 'bigint' ? Number(v) : v);
    }
    return n > 4 ? `[${head.join(', ')}, …${n} total]` : `[${head.join(', ')}]`;
  }
  const v = c.fixed(t);
  return typeof v === 'bigint' ? Number(v) : v;
};

const WANTED = ['general.architecture', 'general.name', '.block_count', '.context_length',
  '.attention.head_count', '.ssm.', '.recurrent', '.linear_attn', '.expert_count'];

/**
 * Every KV pair whose key matches an interesting suffix, plus the arch.
 * The KV block has no declared byte length, and a large tokenizer vocabulary
 * pushes it past any fixed guess (gemma-4's exceeds 8MB), so the window grows
 * and retries rather than reporting a truncated read as a malformed file.
 * Impure (reads the file).
 */
export const readGgufArch = async (path, headerBytes = 8 * 1024 * 1024) => {
  try {
    return await readGgufArchWithin(path, headerBytes);
  } catch (err) {
    if (err?.code !== 'ERR_BUFFER_OUT_OF_BOUNDS' || headerBytes >= 512 * 1024 * 1024) throw err;
    return readGgufArch(path, headerBytes * 4);
  }
};

const readGgufArchWithin = async (path, headerBytes) => {
  const fh = await open(path, 'r');
  try {
    const buf = Buffer.alloc(headerBytes);
    const { bytesRead } = await fh.read(buf, 0, headerBytes, 0);
    const c = cursor(buf.subarray(0, bytesRead));
    const magic = c.u32();
    if (magic !== 0x46554747) throw new Error(`${path}: not a GGUF (magic ${magic.toString(16)})`);
    const version = c.u32();
    const tensorCount = c.u64();
    const kvCount = c.u64();
    const fields = {};
    for (let i = 0; i < kvCount; i += 1) {
      const key = c.str();
      const type = c.u32();
      if (WANTED.some((w) => key.includes(w))) fields[key] = readValue(c, type);
      else skipValue(c, type);
    }
    return { path, version, tensorCount, kvCount, fields };
  } finally {
    await fh.close();
  }
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const paths = process.argv.slice(2);
  if (!paths.length) {
    console.error('usage: node scripts/read-gguf-arch.mjs <file.gguf> [...]');
    process.exit(2);
  }
  for (const p of paths) {
    const r = await readGgufArch(p);
    console.log(`\n${p}\n  gguf v${r.version} · ${r.tensorCount} tensors · ${r.kvCount} kv`);
    for (const [k, v] of Object.entries(r.fields)) console.log(`  ${k.padEnd(46)} = ${v}`);
    // Reported as evidence, never as a verdict. Measured 2026-08-23: qwen35
    // declares ssm.* state keys, while gemma4 — the family where cache-rollback
    // corruption was actually PROVEN — declares none, expressing its layer
    // interleave as a per-layer attention.head_count_kv array instead. So GGUF
    // metadata cannot decide KV-cache reuse safety on its own; only a live
    // corruption run can (see backend/services/kv-cache-policy.js).
    const ssm = Object.keys(r.fields).filter((k) => k.includes('.ssm.'));
    const perLayerKv = Array.isArray(r.fields[`${r.fields['general.architecture']}.attention.head_count_kv`])
      || String(r.fields[`${r.fields['general.architecture']}.attention.head_count_kv`] ?? '').startsWith('[');
    console.log(`  → declared state-space keys: ${ssm.length ? ssm.join(', ') : 'none'}`);
    console.log(`  → per-layer KV head counts:  ${perLayerKv ? 'yes (layers differ)' : 'no (uniform)'}`);
  }
}
