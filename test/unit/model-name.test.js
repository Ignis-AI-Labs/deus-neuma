/**
 * displayModelName — a conduit is named by its MODEL, never the disk layout.
 * Pinned on the witnessed shape (full gguf path in the REFINEMENT header).
 */
import { describe, test, expect } from 'vitest';
import { displayModelName } from '../../frontend/utils/model-name.js';

describe('displayModelName', () => {
  test('the witnessed shape: full gguf path → bare model name', () => {
    expect(displayModelName('/home/guardian/.lmstudio/models/unsloth/Qwen3.6-35B-A3B-GGUF/Qwen3.6-35B-A3B-UD-Q4_K_M.gguf'))
      .toBe('Qwen3.6-35B-A3B-UD-Q4_K_M');
  });
  test('sharded path drops the shard suffix', () => {
    expect(displayModelName('/m/gpt-oss-120b-MXFP4-00001-of-00002.gguf')).toBe('gpt-oss-120b-MXFP4');
  });
  test('publisher-prefixed and clean ids pass through readable', () => {
    expect(displayModelName('openai/gpt-oss-120b')).toBe('gpt-oss-120b');
    expect(displayModelName('claude-haiku-4-5-20251001')).toBe('claude-haiku-4-5-20251001');
  });
  test('absent is an honest dash', () => {
    expect(displayModelName(null)).toBe('—');
    expect(displayModelName('')).toBe('—');
  });
  test('a kernel descriptor path is not a name — never "4" (2026-08-19 header)', () => {
    expect(displayModelName('/proc/self/fd/4')).toBe('—');
    expect(displayModelName('/proc/3829226/fd/4')).toBe('—');
    expect(displayModelName('/dev/fd/4')).toBe('—');
  });
});
