// gguf-mtp — the MTP-heads fact read from real GGUF bytes, and the launch
// argv it gates. No mocks: the buffers are real GGUF headers built to spec and
// written to real temp files for the impure reader.
import { describe, test, expect } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { nextnLayersFromGguf, modelHasMtpHeads } from '../../backend/services/gguf-mtp.js';
import { MTP_SPECULATIVE_ARGS, servingLaunchArguments, resolveServingLaunchConfig } from '../../backend/services/serving-launch-config.js';

const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
const u64 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
const str = (s) => Buffer.concat([u64(Buffer.byteLength(s)), Buffer.from(s)]);
// A GGUF v3 header: a string kv, a string ARRAY (the tokenizer's shape, which
// the reader must walk past), then the keys under test.
const gguf = (kvs) => Buffer.concat([
  Buffer.from('GGUF'), u32(3), u64(0), u64(kvs.length + 2),
  str('general.architecture'), u32(8), str('qwen35'),
  str('tokenizer.ggml.tokens'), u32(9), u32(8), u64(3), str('a'), str('nextn_predict_layers'), str('c'),
  ...kvs,
]);

describe('nextnLayersFromGguf', () => {
  test('reads the layer count past a string array', () => {
    expect(nextnLayersFromGguf(gguf([Buffer.concat([str('qwen35.nextn_predict_layers'), u32(4), u32(1)])]))).toBe(1);
  });
  test('absent key, a token that merely spells the key, non-GGUF, and truncation all answer 0', () => {
    const plain = gguf([Buffer.concat([str('qwen35.block_count'), u32(4), u32(64)])]);
    expect(nextnLayersFromGguf(plain)).toBe(0);
    expect(nextnLayersFromGguf(Buffer.from('not a gguf file at all, no header'))).toBe(0);
    const withKey = gguf([Buffer.concat([str('qwen35.nextn_predict_layers'), u32(4), u32(1)])]);
    expect(nextnLayersFromGguf(withKey.subarray(0, withKey.length - 6))).toBe(0);
  });
});

describe('modelHasMtpHeads (real files)', () => {
  test('true only for a file carrying the heads; missing files are false', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gguf-mtp-'));
    try {
      const mtp = path.join(dir, 'mtp.gguf');
      const plain = path.join(dir, 'plain.gguf');
      await fs.writeFile(mtp, gguf([Buffer.concat([str('qwen35.nextn_predict_layers'), u32(4), u32(1)])]));
      await fs.writeFile(plain, gguf([]));
      expect(await modelHasMtpHeads(mtp)).toBe(true);
      expect(await modelHasMtpHeads(plain)).toBe(false);
      expect(await modelHasMtpHeads(path.join(dir, 'missing.gguf'))).toBe(false);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe('servingLaunchArguments — the MTP gate', () => {
  const cfg = resolveServingLaunchConfig({ LLAMA_SERVER_MODEL: '/m.gguf' });
  test('the draft flags ride only when the model fact says so', () => {
    expect(servingLaunchArguments(cfg)).not.toContain('--spec-type');
    expect(servingLaunchArguments(cfg, { mtp: false })).not.toContain('--spec-type');
    const args = servingLaunchArguments(cfg, { mtp: true });
    expect(args.slice(-MTP_SPECULATIVE_ARGS.length)).toEqual([...MTP_SPECULATIVE_ARGS]);
    expect(MTP_SPECULATIVE_ARGS).toEqual(['--spec-type', 'draft-mtp', '--spec-draft-n-max', '3']);
  });
});
