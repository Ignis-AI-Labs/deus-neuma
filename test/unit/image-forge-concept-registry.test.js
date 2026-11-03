import { describe, test, expect } from 'vitest';
import { resolvePipeline, resolveModel, catalogForCaller } from '../../backend/services/image-forge/pack-registry.js';
import { parameterize } from '../../backend/services/image-forge/parameterizer.js';
import { compileScreenList } from '../../backend/services/image-forge/prompt-screen.js';

const screenList = compileScreenList({
  classes: {
    csam: [], age_minor: [], sexual_explicit: [], sexual_suggestive: [],
    incest: [], bestiality: [], nonconsent: [],
  },
  wordClasses: { deaging: [] },
});

const build = (id, args = {}, source = false) => {
  const { pipeline } = resolvePipeline(id);
  const { model } = resolveModel(pipeline);
  return parameterize({
    pipeline, model,
    args: { positive: 'an adult knight with black hair and cyan circuitry', ...args },
    jobId: 'concept-proof', screenList, fallbackSeed: 42,
    ...(source ? { sourceImageName: 'approved-knight.png', sourceLineage: 'approved character concept' } : {}),
  });
};

describe('game pixel-concept registry', () => {
  test('all four named capabilities resolve to the attested incumbent model', () => {
    for (const id of ['concept.pixel.character', 'concept.pixel.turnaround', 'concept.pixel.view', 'concept.pixel.weapon']) {
      const { pipeline } = resolvePipeline(id);
      expect(pipeline.kind).toBe('concept');
      expect(resolveModel(pipeline).model.ckptName).toBe('bismuthIllustrious_v80.safetensors');
    }
  });

  test('the caller catalog exposes the four recipes without file names or hashes', () => {
    const concepts = catalogForCaller().filter((p) => p.id.startsWith('concept.pixel.'));
    expect(concepts).toHaveLength(4);
    expect(JSON.stringify(concepts)).not.toContain('safetensors');
    expect(concepts.find((p) => p.id === 'concept.pixel.turnaround').requiresSourceImage).toBe(true);
    expect(concepts.find((p) => p.id === 'concept.pixel.weapon').requiresSourceImage).toBe(false);
  });
});

describe('game pixel-concept graphs', () => {
  test('character preserves the approved reference recipe', () => {
    const r = build('concept.pixel.character');
    expect(r.ok).toBe(true);
    expect(r.graph['4'].inputs.ckpt_name).toBe('bismuthIllustrious_v80.safetensors');
    expect(r.graph['20'].inputs).toMatchObject({
      lora_name: 'Dungeon_Squad_IllustriousV5.safetensors', strength_model: 1, strength_clip: 1,
    });
    expect(r.graph['5'].inputs).toMatchObject({ width: 832, height: 1216 });
    expect(r.graph['3'].inputs).toMatchObject({
      seed: 42, steps: 30, cfg: 7, sampler_name: 'dpmpp_2m', scheduler: 'karras', denoise: 1,
    });
    expect(r.graph['10']).toBeUndefined();
    expect(r.graph['6'].inputs.text).toContain('highly detailed pixel art');
  });

  test('weapon uses the same base with a lighter character-LoRA influence', () => {
    const r = build('concept.pixel.weapon', { positive: 'a long black-iron sword with a cyan fuller' });
    expect(r.ok).toBe(true);
    expect(r.graph['5'].inputs).toMatchObject({ width: 832, height: 832 });
    expect(r.graph['20'].inputs.strength_model).toBe(0.35);
    expect(r.graph['6'].inputs.text).toContain('exactly one weapon');
    expect(r.graph['7'].inputs.text).toContain('multiple weapons');
  });

  test('turnaround refuses to run without its approved source', () => {
    const r = build('concept.pixel.turnaround');
    expect(r.ok).toBe(false);
    expect(r.error).toContain('needs a source image');
  });

  test('turnaround combines the reference, pinned sheet canvas and three-view pose plate', () => {
    const r = build('concept.pixel.turnaround', { seed: 77 }, true);
    expect(r.ok).toBe(true);
    expect(r.graph['10']).toEqual({ class_type: 'LoadImage', inputs: { image: 'approved-knight.png' } });
    expect(r.graph['12'].inputs).toMatchObject({ width: 1216, height: 832, crop: 'disabled' });
    expect(r.graph['11'].inputs.pixels).toEqual(['12', 0]);
    expect(r.graph['3'].inputs).toMatchObject({ latent_image: ['11', 0], denoise: 0.95, seed: 77 });
    expect(r.graph['20'].inputs.strength_model).toBe(0.75);
    expect(r.graph['30'].inputs.control_net_name).toBe('xinsir_controlnet_openpose_sdxl.safetensors');
    expect(r.graph['31'].inputs.image).toBe('pose_turnaround_ref.png');
    expect(r.graph['32'].inputs.strength).toBe(1.2);
    expect(r.values.width).toBe(1216);
    expect(r.values.height).toBe(832);
  });

  test('single-view revisions expose a bounded denoise control', () => {
    const r = build('concept.pixel.view', { denoise: 0.45 }, true);
    expect(r.ok).toBe(true);
    expect(r.graph['3'].inputs.denoise).toBe(0.45);
    expect(r.graph['12'].inputs).toMatchObject({ width: 832, height: 1216 });
  });
});
