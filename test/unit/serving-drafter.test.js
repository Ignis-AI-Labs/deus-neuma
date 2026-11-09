/**
 * The DFlash2 launch gate: a drafter beside the model AND a replay-capable
 * engine, else today's MTP/none launch unchanged. Real files on a real
 * filesystem, and the real llama.cpp builds on this rig where present —
 * no mocks anywhere in the path.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DFLASH_DRAFT_N_MAX, drafterFor, engineSupportsReplay, isDrafterFile, speculativePlan,
} from '../../backend/services/serving-drafter.js';
import {
  resolveServingLaunchConfig, servingChildEnvironment, servingLaunchArguments,
} from '../../backend/services/serving-launch-config.js';
import { groupModels } from '../../backend/services/model-catalog.js';
import { estimatedExtraMiB } from '../../backend/services/serving-fit.js';

const DRAFTER = 'Qwen3.8-27B-DFlash2-Q8_0.gguf';
let dir;
const write = (name, body = 'x') => {
  const file = path.join(dir, name);
  fs.writeFileSync(file, body);
  return file;
};
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serving-drafter-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe('isDrafterFile', () => {
  it('names DFlash drafter GGUFs only', () => {
    expect(isDrafterFile(DRAFTER)).toBe(true);
    expect(isDrafterFile('qwen3.8-27b-dflash.GGUF')).toBe(true);
    expect(isDrafterFile('qwen3.8-27B-Neuma-T3-Q6_K.gguf')).toBe(false);
    expect(isDrafterFile('mmproj-Qwen3.8-27B-BF16.gguf')).toBe(false);
    expect(isDrafterFile('dflash-notes.json')).toBe(false);
    expect(isDrafterFile(null)).toBe(false);
  });
});

describe('speculativePlan', () => {
  it('chooses DFlash only with both a drafter and a replay-capable engine', () => {
    expect(speculativePlan({ mtp: true, drafter: '/m/d.gguf', replay: true }))
      .toEqual({ kind: 'dflash', drafter: '/m/d.gguf', rsReplay: true });
    expect(speculativePlan({ mtp: true, drafter: '/m/d.gguf', replay: false }))
      .toEqual({ kind: 'mtp', drafter: null, rsReplay: false });
    expect(speculativePlan({ mtp: false, drafter: '/m/d.gguf', replay: false }))
      .toEqual({ kind: 'none', drafter: null, rsReplay: false });
  });
  it('rides replay on MTP when the engine has it, and keeps plain launches plain', () => {
    expect(speculativePlan({ mtp: true, replay: true })).toEqual({ kind: 'mtp', drafter: null, rsReplay: true });
    expect(speculativePlan({ mtp: true })).toEqual({ kind: 'mtp', drafter: null, rsReplay: false });
    expect(speculativePlan({})).toEqual({ kind: 'none', drafter: null, rsReplay: false });
  });
});

describe('drafterFor (real directory)', () => {
  it('finds the one drafter beside the model', async () => {
    const model = write('qwen3.8-27B-Neuma-T3-Q6_K.gguf');
    const drafter = write(DRAFTER);
    write('mmproj-Qwen3.8-27B-BF16.gguf');
    expect(await drafterFor(model)).toBe(drafter);
  });
  it('answers null for none, two (ambiguous), an empty file, or a relative path', async () => {
    const model = write('model.gguf');
    expect(await drafterFor(model)).toBeNull();
    write(DRAFTER, '');
    expect(await drafterFor(model)).toBeNull();
    write(DRAFTER, 'x');
    write('Other-DFlash-Q4_K_M.gguf');
    expect(await drafterFor(model)).toBeNull();
    expect(await drafterFor('model.gguf')).toBeNull();
  });
});

describe('engineSupportsReplay (real files)', () => {
  it('reads the marker from the libllama beside the server, through its symlinks', async () => {
    const bin = write('llama-server', 'ELF server');
    write('libllama.so.0.9.0', 'abc LLAMA_RS_REPLAY def');
    fs.symlinkSync('libllama.so.0.9.0', path.join(dir, 'libllama.so.0'));
    fs.symlinkSync('libllama.so.0', path.join(dir, 'libllama.so'));
    expect(await engineSupportsReplay(bin)).toBe(true);
  });
  it('answers false for a libllama without it, and reads a static binary itself', async () => {
    const bin = write('llama-server', 'static LLAMA_RS_REPLAY');
    write('libllama.so.0.8.0', 'no marker here');
    expect(await engineSupportsReplay(bin)).toBe(false);
    fs.rmSync(path.join(dir, 'libllama.so.0.8.0'));
    expect(await engineSupportsReplay(bin)).toBe(true);
    expect(await engineSupportsReplay(path.join(dir, 'missing'))).toBe(false);
    expect(await engineSupportsReplay('llama-server')).toBe(false);
  });
  const pr = '/opt/llama.cpp-pr31669/build-cuda/bin/llama-server';
  const pre = '/opt/llama.cpp-speed/build-cuda/bin/llama-server';
  it.skipIf(!fs.existsSync(pr) || !fs.existsSync(pre))('tells the real rig builds apart', async () => {
    expect(await engineSupportsReplay(pr)).toBe(true);
    expect(await engineSupportsReplay(pre)).toBe(false);
  });
});

describe('servingLaunchArguments — the drafter slot', () => {
  const cfg = resolveServingLaunchConfig({ LLAMA_SERVER_MODEL: '/m/model.gguf' });
  it('launches DFlash2 with the drafter, taking precedence over MTP', () => {
    const args = servingLaunchArguments(cfg, { mtp: true, drafter: '/m/d-DFlash2.gguf' });
    const at = args.indexOf('--spec-type');
    expect(args.slice(at, at + 6)).toEqual(['--spec-type', 'draft-dflash', '-md', '/m/d-DFlash2.gguf',
      '--spec-draft-n-max', String(DFLASH_DRAFT_N_MAX)]);
    expect(args).not.toContain('draft-mtp');
  });
  it('keeps the MTP and plain launches exactly as before', () => {
    expect(servingLaunchArguments(cfg, { mtp: true })).toEqual(servingLaunchArguments(cfg, { mtp: true, drafter: null }));
    expect(servingLaunchArguments(cfg)).not.toContain('--spec-type');
  });
  it('refuses a drafter path that is not canonical and absolute', () => {
    expect(() => servingLaunchArguments(cfg, { drafter: 'd.gguf' })).toThrow(/canonical absolute path/);
    expect(() => servingLaunchArguments(cfg, { drafter: '/m/../d.gguf' })).toThrow(/canonical absolute path/);
  });
});

describe('servingChildEnvironment — the replay switch', () => {
  const uuid = 'GPU-01234567-89AB-CDEF-0123-456789ABCDEF';
  const gpuBinding = {
    schemaVersion: 1, gpuUuid: uuid, cudaVisibleDevices: uuid, nvidiaVisibleDevices: uuid,
    deviceDescriptorsSha256: 'a'.repeat(64), gpuBindingSha256: 'b'.repeat(64),
  };
  const base = { disableCudaGraphs: true, disableCudaFusion: true, gpuBinding };
  it('carries LLAMA_RS_REPLAY as 1 or 0, exactly', () => {
    expect(servingChildEnvironment({ ...base, rsReplay: true }).LLAMA_RS_REPLAY).toBe('1');
    expect(servingChildEnvironment({ ...base, rsReplay: false }).LLAMA_RS_REPLAY).toBe('0');
  });
  it('refuses a launch that does not state the replay choice', () => {
    expect(() => servingChildEnvironment(base)).toThrow();
    expect(() => servingChildEnvironment({ ...base, rsReplay: 'yes' })).toThrow(/boolean/);
  });
});

describe('the drafter is never a catalog model, and its VRAM is counted', () => {
  it('groups the model and skips the drafter and the projector', () => {
    const models = groupModels([
      { relPath: 'neuma/t3/qwen3.8-27B-Neuma-T3-Q6_K.gguf', absPath: '/r/neuma/t3/qwen3.8-27B-Neuma-T3-Q6_K.gguf', sizeBytes: 10 },
      { relPath: `neuma/t3/${DRAFTER}`, absPath: `/r/neuma/t3/${DRAFTER}`, sizeBytes: 5 },
      { relPath: 'neuma/t3/mmproj-Qwen3.8-27B-BF16.gguf', absPath: '/r/neuma/t3/mmproj-Qwen3.8-27B-BF16.gguf', sizeBytes: 3 },
    ]);
    expect(models.map((m) => m.name)).toEqual(['qwen3.8-27B-Neuma-T3-Q6_K']);
  });
  it('adds the drafter and its draft context to the fit estimate', () => {
    expect(estimatedExtraMiB({ mmprojMiB: 900, drafterMiB: 1962 })).toBe(256 + 900 + 256 + 1962 + 2048);
    expect(estimatedExtraMiB({ mmprojMiB: 900, mtp: true })).toBe(256 + 900 + 256 + 3328);
  });
});
