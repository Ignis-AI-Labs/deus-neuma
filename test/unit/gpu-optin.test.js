// gpu-optin.test.js — the GPU-engine summons gate, both directions, with no
// GPU anywhere near this proof (that is the point of the gate). The open
// side is pin-proven HERE because opening it for real means lighting engines
// on the witness's rig — that leg belongs to an explicit summons
// (RUN_GPU_ENGINE_TESTS=1 in the serial substrate-live lane), never a suite.

import { describe, it, expect, afterEach } from 'vitest';
import { shouldRunGpuEngineTests, gpuSkipNote } from '../helpers/gpu-optin.js';

const prev = process.env.RUN_GPU_ENGINE_TESTS;
afterEach(() => {
  if (prev === undefined) delete process.env.RUN_GPU_ENGINE_TESTS;
  else process.env.RUN_GPU_ENGINE_TESTS = prev;
});

describe('the GPU-engine summons (Xid 79 law: presence is not consent)', () => {
  it('closed by default — unset, empty, "0", "true", anything but the summons', () => {
    delete process.env.RUN_GPU_ENGINE_TESTS;
    expect(shouldRunGpuEngineTests()).toBe(false);
    for (const v of ['', '0', 'true', 'yes', 'on']) {
      process.env.RUN_GPU_ENGINE_TESTS = v;
      expect(shouldRunGpuEngineTests()).toBe(false);
    }
  });

  it('opens on the one explicit summons: RUN_GPU_ENGINE_TESTS=1', () => {
    process.env.RUN_GPU_ENGINE_TESTS = '1';
    expect(shouldRunGpuEngineTests()).toBe(true);
  });

  it('the parked note names the summons, the lane, and the law', () => {
    const note = gpuSkipNote('image-forge job lane');
    expect(note).toContain('image-forge job lane');
    expect(note).toContain('RUN_GPU_ENGINE_TESTS=1');
    expect(note).toContain('substrate-live');
    expect(note).toContain('Xid 79');
  });
});
