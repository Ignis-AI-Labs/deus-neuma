/**
 * The fast engine's plan (managed-engine-plan.js): which machines take llama.cpp, which build, which
 * pinned files, and what the setup will do. Pure functions over real values. The recommendation is
 * the real one (substrate-setup.js), and the pins are checked against the real archives and the
 * house drafter on this rig where they are present. No mocks.
 */
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  DRAFTER, LLAMA_CPP_BUILD, MIN_COMPUTE, T4, engineArchives, engineDoneLine, engineFits, enginePlan, engineVariantFor, filesOf, modelFilesFor, servedMiB,
} from '../../backend/services/managed-engine-plan.js';
import { recommendSubstrate } from '../../backend/services/substrate-setup.js';

const nvidia = (driver, vramGB = 96) => ({ vendor: 'nvidia', name: 'RTX', vramGB, unified: false, driver });
const linux = { platform: 'linux', arch: 'x64' };
const profileOf = (vramGB) => ({ gpu: nvidia('615.71.09', vramGB), memory: { totalGB: 64 }, platform: { os: 'linux' } });
const sha256Of = async (file) => {
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
};

describe('engineVariantFor — which machines take the engine', () => {
  it('gives a CUDA 13 driver the 13.5 build and a 570 driver the 12.8 build', () => {
    expect(engineVariantFor({ ...linux, gpu: nvidia('615.71.09'), computeCap: 12.0 }).id).toBe('cuda-13.5');
    expect(engineVariantFor({ ...linux, gpu: nvidia('580.65.06'), computeCap: 8.9 }).id).toBe('cuda-13.5');
    expect(engineVariantFor({ ...linux, gpu: nvidia('575.51.03'), computeCap: 8.6 }).id).toBe('cuda-12.8');
  });
  it('leaves every other machine to Ollama', () => {
    expect(engineVariantFor({ ...linux, gpu: nvidia('560.35.03'), computeCap: 8.6 })).toBeNull();
    expect(engineVariantFor({ ...linux, gpu: nvidia('615.71.09'), computeCap: 6.1 })).toBeNull();
    expect(engineVariantFor({ ...linux, gpu: nvidia('615.71.09'), computeCap: null })).toBeNull();
    expect(engineVariantFor({ ...linux, gpu: { ...nvidia('615.71.09'), unified: true }, computeCap: 12.1 })).toBeNull();
    expect(engineVariantFor({ ...linux, gpu: { vendor: 'amd', vramGB: 24 }, computeCap: null })).toBeNull();
    expect(engineVariantFor({ platform: 'win32', arch: 'x64', gpu: nvidia('615.71.09'), computeCap: 12.0 })).toBeNull();
    expect(engineVariantFor({ platform: 'linux', arch: 'arm64', gpu: nvidia('615.71.09'), computeCap: 12.0 })).toBeNull();
    expect(engineVariantFor({ ...linux, gpu: null, computeCap: null })).toBeNull();
    expect(MIN_COMPUTE).toBe(7.5);
  });
});

describe('modelFilesFor — every model a card is recommended has pinned files', () => {
  it('below the 12 GB minimum there is no recommendation to pin', () => {
    expect(recommendSubstrate(profileOf(8)).model).toBeNull();
  });
  it.each([12, 16, 20, 24, 32, 48, 96])('a %i GB card', (vramGB) => {
    const rec = recommendSubstrate(profileOf(vramGB));
    expect(rec.mode).toBe('gpu');
    const files = modelFilesFor(rec);
    expect(files, `${rec.source}:${rec.quant}`).not.toBeNull();
    for (const f of filesOf(files)) {
      expect(f.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(f.size).toBeGreaterThan(100_000_000);
      expect(f.url).toBe(`https://huggingface.co/${f.repo}/resolve/${f.revision}/${encodeURIComponent(f.name)}`);
      expect(f.revision).toMatch(/^[0-9a-f]{40}$/);
    }
    // the drafter rides the cards of 32 GB and up, never a tighter one
    expect(Boolean(files.drafter)).toBe(vramGB >= 32);
  });
  it('knows nothing it was not given', () => {
    expect(modelFilesFor(null)).toBeNull();
    expect(modelFilesFor({ source: 'someone/else', quant: 'Q4_K_M' })).toBeNull();
  });
  const house = '/mnt/data/neuma/drafters/qwen3.8-27b-dflash2/Qwen3.8-27B-DFlash2-Q8_0.gguf';
  it.skipIf(!fs.existsSync(house))('pins the very drafter the house serves', async () => {
    expect(fs.statSync(house).size).toBe(DRAFTER.size);
    expect(await sha256Of(house)).toBe(DRAFTER.sha256);
  });
});

describe('engineArchives — the pinned build', () => {
  it('pins each archive to its release and its SHA-256', () => {
    for (const id of ['cuda-13.5', 'cuda-12.8']) {
      const { engine, runtime } = engineArchives(id);
      for (const a of [engine, runtime]) {
        expect(a.url).toBe(`https://github.com/ggml-org/llama.cpp/releases/download/${LLAMA_CPP_BUILD}/${a.name}`);
        expect(a.name).toContain(LLAMA_CPP_BUILD);
        expect(a.format).toBe('tar.gz');
        expect(a.sha256).toMatch(/^[0-9a-f]{64}$/);
      }
    }
    expect(engineArchives('cuda-11.0')).toBeNull();
  });
  const dir = `/mnt/data/neuma/engine-pin/${LLAMA_CPP_BUILD}`;
  const { engine, runtime } = engineArchives('cuda-13.5');
  it.skipIf(!fs.existsSync(`${dir}/${engine.name}`))('the archives downloaded on this rig hash to the pin', async () => {
    for (const a of [engine, runtime]) {
      expect(fs.statSync(`${dir}/${a.name}`).size).toBe(a.size);
      expect(await sha256Of(`${dir}/${a.name}`)).toBe(a.sha256);
    }
  });
});

describe('engineFits — only a card our launch was measured to fit takes the engine', () => {
  const t4 = (quant) => modelFilesFor({ source: T4, quant });
  // measured 2026-11-09 (fitprobe): what the production launch holds at a 16K pool
  it('sizes a served T4 build by the measured launch, never above the real one by much', () => {
    expect(servedMiB(t4('IQ3_M'))).toBe(Math.ceil(13_032_195_808 / 1048576) + 6260);
    expect(servedMiB(t4('IQ3_M'))).toBeGreaterThanOrEqual(18_672);
    expect(servedMiB(t4('IQ3_M')) - 18_672).toBeLessThan(100);
  });
  it.each([
    ['IQ3_XXS', 12, false], ['IQ3_M', 16, false], ['IQ3_M', 24, true], ['IQ4_XS', 24, false],
    ['IQ4_XS', 32, true], ['Q6_K', 32, false], ['Q6_K', 48, true],
  ])('T4 %s on a %i GB card: %s', (quant, vramGB, fits) => {
    expect(engineFits(t4(quant), { vramGB })).toBe(fits);
  });
  it('a card it does not fit, or an unsized one, gets no engine plan', () => {
    const rec = { model: 'T4', quant: 'IQ3_M', source: T4, mode: 'gpu', sizeGB: 13 };
    const at = (vramGB) => enginePlan({ ...linux, gpu: nvidia('615.71.09', vramGB), computeCap: 12.0, recommendation: rec, installed: false, freeBytes: 500e9 });
    expect(at(16)).toBeNull();
    expect(at(24)).not.toBeNull();
    expect(engineFits(t4('IQ3_M'), { vramGB: null })).toBe(false);
    // a budget below the card (NEUMA_MODEL_BUDGET_GB) is the size the engine must fit
    const capped = enginePlan({ ...linux, gpu: nvidia('615.71.09', 96), computeCap: 12.0, recommendation: { ...rec, budgetGB: 16 }, installed: false, freeBytes: 500e9 });
    expect(capped).toBeNull();
  });
});

describe('enginePlan — what the setup will do', () => {
  const rec = recommendSubstrate(profileOf(48));
  const machine = { ...linux, gpu: nvidia('615.71.09', 48), computeCap: 12.0, recommendation: rec, freeBytes: 500e9 };
  const files = modelFilesFor(rec);

  it('on a fresh machine: the engine, its runtime, the model, its projector, the drafter, an answer', () => {
    const plan = enginePlan({ ...machine, installed: false });
    expect(plan.steps.map((s) => s.id)).toEqual(['download', 'runtime', 'unpack', 'pull', 'projector', 'drafter', 'verify']);
    expect(plan).toMatchObject({ supported: true, engine: 'llama.cpp', build: LLAMA_CPP_BUILD, variant: 'cuda-13.5', server: 'engine-download', enoughDisk: true });
    const { engine, runtime } = engineArchives('cuda-13.5');
    const want = engine.size + runtime.size + filesOf(files).reduce((n, f) => n + f.size, 0);
    expect(plan.downloadBytes).toBe(want);
    expect(plan.needBytes).toBeGreaterThan(want);
    expect(plan.model).toMatchObject({ ref: files.model.name, name: rec.model, quant: rec.quant, ready: false });
  });
  it('downloads only what is missing, and an installer never asks for an answer', () => {
    const plan = enginePlan({ ...machine, installed: true, present: [files.model.name], verify: false });
    expect(plan.steps.map((s) => s.id)).toEqual(['projector', 'drafter']);
    expect(plan.server).toBe('engine-installed');
    const ready = enginePlan({ ...machine, installed: true, present: filesOf(files).map((f) => f.name), verify: false });
    expect(ready.steps).toEqual([]);
    expect(ready.model.ready).toBe(true);
    expect(ready.downloadBytes).toBe(0);
  });
  it('says when the disk is too small, and stands aside for a processor or another machine', () => {
    expect(enginePlan({ ...machine, installed: false, freeBytes: 10e9 }).enoughDisk).toBe(false);
    expect(enginePlan({ ...machine, recommendation: { ...rec, mode: 'cpu' }, installed: false })).toBeNull();
    expect(enginePlan({ ...machine, platform: 'win32', installed: false })).toBeNull();
    expect(enginePlan({ ...machine, recommendation: { model: null, mode: 'gpu' }, installed: false })).toBeNull();
  });
  it('ends on a plain sentence', () => {
    expect(engineDoneLine({ name: 'Qwen3.8-27B (6-bit)', loaded: true })).toBe(`Qwen3.8-27B (6-bit) is ready on llama.cpp ${LLAMA_CPP_BUILD}.`);
    expect(engineDoneLine({ name: 'X', loaded: false })).toMatch(/loads when Deus Neuma first opens/);
  });
});

describe('a recommended model is downloaded only from a pinned revision', () => {
  // every choice a 96 GB card can hold is offered, each with its checked mark
  const all = recommendSubstrate(profileOf(96)).options;
  it('every checked choice with engine files names a real commit', () => {
    for (const c of all.filter((x) => x.checked)) {
      const files = modelFilesFor(c);
      if (files) for (const f of filesOf(files)) expect(f.revision, `${c.model} ${c.quant}`).toMatch(/^[0-9a-f]{40}$/);
    }
  });
  it('no T4 tier is recommended before its upload is pinned', () => {
    const pinned = /^[0-9a-f]{40}$/.test(modelFilesFor({ source: T4, quant: 'IQ3_M' }).model.revision);
    if (!pinned) expect(all.filter((x) => x.source === T4 && x.checked)).toEqual([]);
    expect(all.filter((x) => x.source === T4).map((x) => x.quant).sort()).toEqual(['IQ3_M', 'IQ3_XXS', 'IQ4_XS', 'Q6_K']);
  });
});
