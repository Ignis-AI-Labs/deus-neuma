import { describe, test, expect } from 'vitest';
import {
  PIPELINES, PACK_MODELS, PACK_MODEL_PATCHES, ENGINE_PIN, DEFAULT_PIPELINE_ID,
  resolvePipeline, resolveModel, resolvePatch, catalogForCaller,
} from '../../backend/services/image-forge/pack-registry.js';

// The registry is the fail-closed door onto the template path: the manifest is
// this frozen module, so an unknown id can never resolve by touching disk.

describe('resolvePipeline', () => {
  test('resolves a declared pipeline by id', () => {
    const r = resolvePipeline('still.sdxl.txt2img');
    expect(r.ok).toBe(true);
    expect(r.pipeline.id).toBe('still.sdxl.txt2img');
  });

  test('an absent id falls to the default rather than refusing', () => {
    for (const id of [undefined, null, '']) {
      const r = resolvePipeline(id);
      expect(r.ok).toBe(true);
      expect(r.pipeline.id).toBe(DEFAULT_PIPELINE_ID);
    }
  });

  test('an unknown id fails closed and names what IS available', () => {
    const r = resolvePipeline('still.sdxl.nope');
    expect(r.ok).toBe(false);
    expect(r.error).toContain("unknown pipeline 'still.sdxl.nope'");
    expect(r.error).toContain('still.sdxl.txt2img');
  });

  // Object.prototype keys must not resolve as pipelines — a caller naming
  // 'constructor' or '__proto__' would otherwise reach an inherited value.
  test('inherited Object keys do not resolve', () => {
    for (const id of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      expect(resolvePipeline(id).ok).toBe(false);
    }
  });
});

describe('resolveModel', () => {
  test('resolves the model a pipeline names', () => {
    const { pipeline } = resolvePipeline('still.sdxl.txt2img');
    const r = resolveModel(pipeline);
    expect(r.ok).toBe(true);
    expect(r.model.ckptName).toBe('sd_xl_base_1.0.safetensors');
  });

  test('a pipeline naming an unregistered model refuses — mounts are not visibility', () => {
    const r = resolveModel({ id: 'fake', modelId: 'not-in-the-registry' });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('unregistered model');
  });

  test('every declared pipeline resolves to a registered model', () => {
    for (const pipeline of Object.values(PIPELINES)) {
      expect(resolveModel(pipeline).ok).toBe(true);
    }
  });
});

describe('the manifest itself', () => {
  test('the engine pin is a full 40-char SHA, not an abbreviation', () => {
    expect(ENGINE_PIN.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(ENGINE_PIN.tag).toBe('v0.41.0');
  });

  test('every registered model carries a full sha256 — no hollow attestations', () => {
    for (const model of Object.values(PACK_MODELS)) {
      expect(model.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(model.bytes).toBeGreaterThan(0);
    }
  });

  // Every caller word is screened, always. It is REQUIRED unless the pipeline
  // owns its own prompt (`instruction` — the team portrait's house look), where
  // the caller's text is optional direction, not the whole picture.
  test('every pipeline declares a screened positive slot, required unless it owns an instruction', () => {
    for (const p of Object.values(PIPELINES)) {
      expect(p.slots.positive.screened).toBe(true);
      expect(p.slots.positive.required).toBe(!p.instruction);
    }
  });

  test('the manifest is frozen — no runtime widening of what is callable', () => {
    expect(Object.isFrozen(PIPELINES)).toBe(true);
    expect(Object.isFrozen(PACK_MODELS)).toBe(true);
    expect(() => { PIPELINES.injected = {}; }).toThrow();
  });

  // klein is distilled: guidance is pinned inside the graph and the negative
  // is zeroed, so neither is offered — a knob that does nothing is a lie.
  test('the klein pipelines offer no cfg or negative and keep steps tiny', () => {
    for (const id of ['still.klein.txt2img', 'still.klein.edit', 'portrait.team']) {
      const s = PIPELINES[id].slots;
      expect(s.cfg).toBeUndefined();
      expect(s.negative).toBeUndefined();
      expect(s.steps.max).toBeLessThanOrEqual(8);
    }
  });

  test('schnell is retired — neither its pipeline nor its model is callable', () => {
    expect(PIPELINES['still.schnell.txt2img']).toBeUndefined();
    expect(PACK_MODELS['flux1-schnell-fp8']).toBeUndefined();
  });

  test('the team portrait owns its look: pinned 4:5 canvas, house instruction, optional direction', () => {
    const p = PIPELINES['portrait.team'];
    expect(p.fixed).toEqual({ width: 896, height: 1120 });
    expect(p.requiresSourceImage).toBe(true);
    expect(p.instruction).toContain('near-black backdrop');
    expect(p.slots.positive.required).toBe(false);
    expect(p.slots.positive.screened).toBe(true);
    // Brand law: no coloured light in the house look.
    expect(p.instruction).not.toMatch(/\b(cool|cyan|blue)\b/i);
  });

  test('every pipeline that names a model patch resolves it; others resolve to none', () => {
    for (const p of Object.values(PIPELINES)) {
      const r = resolvePatch(p);
      expect(r.ok).toBe(true);
      if (p.patchId) expect(PACK_MODEL_PATCHES[p.patchId]).toBe(r.patch);
      else expect(r.patch).toBeNull();
    }
  });

  test('an unregistered model patch refuses rather than reaching for disk', () => {
    const r = resolvePatch({ id: 'x', patchId: 'not-a-patch' });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('not-a-patch');
  });
});

describe('catalogForCaller', () => {
  test('describes every pipeline with its parameters', () => {
    const catalog = catalogForCaller();
    expect(catalog).toHaveLength(Object.keys(PIPELINES).length);
    const sdxl = catalog.find((p) => p.id === 'still.sdxl.txt2img');
    expect(sdxl.parameters.find((x) => x.name === 'positive').required).toBe(true);
    expect(sdxl.parameters.find((x) => x.name === 'width').allowed).toContain(1024);
    expect(sdxl.parameters.find((x) => x.name === 'steps')).toMatchObject({ min: 1, max: 60 });
  });

  test('leaks no file paths, hashes, or engine internals to the caller', () => {
    const serialized = JSON.stringify(catalogForCaller());
    expect(serialized).not.toContain('safetensors');
    expect(serialized).not.toContain(PACK_MODELS['sdxl-base-1.0'].sha256);
    expect(serialized).not.toContain('CheckpointLoaderSimple');
    expect(serialized).not.toContain(ENGINE_PIN.sha);
  });

  test('flags the pipeline that needs a source image', () => {
    const catalog = catalogForCaller();
    expect(catalog.find((p) => p.id === 'still.sdxl.img2img').requiresSourceImage).toBe(true);
    expect(catalog.find((p) => p.id === 'still.sdxl.txt2img').requiresSourceImage).toBe(false);
  });
});
