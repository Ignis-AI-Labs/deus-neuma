import { describe, expect, test } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const {
  compositorSwitches,
  nvidiaRenderNode,
} = require(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../electron/gpu-policy.cjs'));

const INTEL = { path: '/dev/dri/renderD128', vendor: '0x8086' };
const NVIDIA = { path: '/dev/dri/renderD129', vendor: '0x10de' };

describe('gpu-policy', () => {
  test('picks the NVIDIA render node when both GPUs are present', () => {
    expect(nvidiaRenderNode([INTEL, NVIDIA])).toBe('/dev/dri/renderD129');
  });

  test('emits render-node-override only for NVIDIA', () => {
    expect(compositorSwitches([INTEL, NVIDIA])).toEqual([
      ['render-node-override', '/dev/dri/renderD129'],
    ]);
  });

  test('emits nothing on Intel-only or empty inventories — never guess', () => {
    expect(compositorSwitches([INTEL])).toEqual([]);
    expect(compositorSwitches([])).toEqual([]);
    expect(nvidiaRenderNode(null)).toBeNull();
  });
});
