// serving-cache-ram.test.js — the host prompt cache is OFF (2026-10-13).
//
// Measured on this build with scripts/long-session-bench.mjs (production argv,
// scratch port): with llama.cpp's `--cache-ram` ON, a chat that finished a turn
// was re-seated in another slot and rebuilt from RAM on its next turn — GBs
// copied one chat after another, every chat's first word held until all were
// rebuilt — and `cache_idle_slots` cleared every idle slot at any request's
// start, even when the save failed for size (Founder's 129k chat). OFF, every chat
// keeps its own slot and a warm turn starts in ~0.3–0.5 s. Pure.

import { describe, it, expect } from 'vitest';
import { SERVING_CACHE_RAM_MIB, servingLaunchArguments, resolveServingLaunchConfig } from '../../backend/services/serving-launch-config.js';

describe('the host prompt cache', () => {
  it('is off — 0, never the growing default and never -1 (unlimited)', () => {
    expect(SERVING_CACHE_RAM_MIB).toBe(0);
  });

  it('rides every supervised launch as --cache-ram 0', () => {
    const args = servingLaunchArguments(resolveServingLaunchConfig({
      LLAMA_SERVER_MODEL: '/m.gguf', LLAMA_SERVER_URL: 'http://127.0.0.1:8089', SUBSTRATE_CONTEXT_LENGTH: '4096',
    }));
    const at = args.indexOf('--cache-ram');
    expect(args.slice(at, at + 2)).toEqual(['--cache-ram', '0']);
  });
});
