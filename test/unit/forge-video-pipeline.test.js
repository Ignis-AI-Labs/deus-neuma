/**
 * The video pipeline (pipelines-video.js → parameterizer → templates-video.js) — the
 * real registry and the real parameterizer, called with real inputs. No mocks (RULE 0).
 * The graph itself is proven on a live engine by a separate render proof.
 */
import { describe, test, expect } from 'vitest';
import { resolvePipeline, resolveModel, PACK_MODELS } from '../../backend/services/image-forge/pack-registry.js';
import { parameterize } from '../../backend/services/image-forge/parameterizer.js';
import { compileScreenList } from '../../backend/services/image-forge/prompt-screen.js';
import { validateGraphAgainstObjectInfo } from '../../backend/services/image-forge/templates.js';

// The real screen, compiled from an empty law (a refused prompt is the screen's own suite).
const EMPTY_LAW = compileScreenList({
  classes: {
    csam: [], age_minor: [], sexual_explicit: [], sexual_suggestive: [],
    incest: [], bestiality: [], nonconsent: [],
  },
});
const pipeline = resolvePipeline('video.ltx.i2v').pipeline;
const model = resolveModel(pipeline).model;
const run = (args, extra = {}) => parameterize({
  pipeline, model, args, jobId: '7b0c6d1e-5b6a-4a71-9d6f-2a0d4e9c1f00', screenList: EMPTY_LAW, fallbackSeed: 9,
  sourceImageName: 'job.png', ...extra,
});
const node = (graph, type) => Object.values(graph).filter((n) => n.class_type === type);

describe('video.ltx.i2v — registered', () => {
  test('a video pipeline on a hashed model, needing a source image and the measured VRAM', () => {
    expect(pipeline.kind).toBe('video');
    expect(pipeline.requiresSourceImage).toBe(true);
    expect(pipeline.needGB).toBe(7);
    expect(PACK_MODELS['ltx-2.5-22b-distilled'].sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.values(PACK_MODELS['ltx-2.5-22b-distilled'].companions).every((c) => /^[0-9a-f]{64}$/.test(c.sha256))).toBe(true);
  });
});

describe('parameterize — the video branch', () => {
  test('defaults: 5 s landscape at 24 fps — a half-res first pass, 121 frames, the source loaded', () => {
    const r = run({ positive: 'the wind moves her hair' });
    expect(r.ok).toBe(true);
    const [latent] = node(r.graph, 'EmptyLTXVLatentVideo');
    expect(latent.inputs).toMatchObject({ width: 640, height: 360, length: 121 });
    expect(node(r.graph, 'LoadImage')[0].inputs.image).toBe('job.png');
    expect(node(r.graph, 'CLIPTextEncode').map((n) => n.inputs.text)).toContain('the wind moves her hair');
    expect(node(r.graph, 'SaveVideo')).toHaveLength(1);
    // LTX-2.5's own parts: the distilled transformer, the Gemma-4 encoder, a VAE for video and one for audio.
    expect(node(r.graph, 'UNETLoader')[0].inputs.unet_name).toBe(PACK_MODELS['ltx-2.5-22b-distilled'].unetName);
    expect(node(r.graph, 'VAELoader')).toHaveLength(2);
    expect(node(r.graph, 'LTXVDualCFGGuider')).toHaveLength(2);
  });

  test('portrait is the vertical canvas; seconds sets the length', () => {
    const r = run({ positive: 'a slow push-in', aspect: 'portrait', seconds: 10 });
    expect(node(r.graph, 'EmptyLTXVLatentVideo')[0].inputs).toMatchObject({ width: 360, height: 640, length: 241 });
    expect(r.values).toMatchObject({ width: 720, height: 1280, seconds: 10 });
  });

  test('a caller seed reaches the sampler; none falls back to the server-minted one', () => {
    expect(node(run({ positive: 'x', seed: 4242 }).graph, 'RandomNoise').map((n) => n.inputs.noise_seed)).toContain(4242);
    expect(node(run({ positive: 'x' }).graph, 'RandomNoise').map((n) => n.inputs.noise_seed)).toContain(9);
  });

  test('an over-long clip is clamped to the measured 10 s (numbers clamp, by the slot law)', () => {
    expect(node(run({ positive: 'x', seconds: 30 }).graph, 'EmptyLTXVLatentVideo')[0].inputs.length).toBe(241);
  });

  test('refused, never guessed: no source, unknown aspect, unknown knob', () => {
    expect(run({ positive: 'x' }, { sourceImageName: null }).ok).toBe(false);
    expect(run({ positive: 'x', aspect: 'square' }).ok).toBe(false);
    expect(run({ positive: 'x', steps: 50 }).ok).toBe(false);
  });
});

describe('validateGraphAgainstObjectInfo — v0.41 nested (dynamic combo) inputs', () => {
  // The shape v0.41.0's /object_info reports for ResizeImageMaskNode (read live, 2026-10-18).
  const objectInfo = {
    ResizeImageMaskNode: {
      input: {
        required: {
          input: ['IMAGE,MASK', {}],
          resize_type: ['COMFY_DYNAMICCOMBO_V3', { options: [
            { key: 'scale dimensions', inputs: { required: { width: ['INT'], height: ['INT'], crop: ['COMBO'] } } },
            { key: 'scale longer dimension', inputs: { required: { longer_size: ['INT'] } } },
          ] }],
          scale_method: [['lanczos', 'area']],
        },
      },
    },
  };
  const graph = (inputs) => ({ 1: { class_type: 'ResizeImageMaskNode', inputs } });

  test('a setting one of the menu\'s options declares is declared', () => {
    expect(validateGraphAgainstObjectInfo(graph({ resize_type: 'scale dimensions', 'resize_type.width': 1280, scale_method: 'lanczos' }), objectInfo).ok).toBe(true);
  });

  test('an invented setting, or a dot under a plain input, is still drift', () => {
    expect(validateGraphAgainstObjectInfo(graph({ 'resize_type.depth': 3 }), objectInfo).ok).toBe(false);
    expect(validateGraphAgainstObjectInfo(graph({ 'scale_method.width': 3 }), objectInfo).ok).toBe(false);
  });
});

describe('the model licence boundary (licenceRefuses)', () => {
  // A real compiled law with terms in it — the screen's own suites test the vocabulary.
  const LAW = compileScreenList({
    classes: {
      csam: [], age_minor: ['child'], sexual_explicit: ['explicit sex'], sexual_suggestive: [],
      incest: [], bestiality: [], nonconsent: [],
    },
  });
  const still = resolvePipeline('still.sdxl.txt2img').pipeline;
  const make = (p, positive) => parameterize({
    pipeline: p, model: resolveModel(p).model, args: { positive }, jobId: '7b0c6d1e-5b6a-4a71-9d6f-2a0d4e9c1f00',
    screenList: LAW, fallbackSeed: 9, sourceImageName: 'job.png', sourceLineage: 'a recorded still',
  });

  test('LTX video refuses what its licence forbids, and names the licence as the boundary', () => {
    expect(make(pipeline, 'two adults, explicit sex')).toMatchObject({ ok: false, refusalClass: 'licence:sexual_explicit' });
  });

  test('a still keeps the platform\'s own rule: adult content is the operator\'s to allow', () => {
    expect(make(still, 'two adults, explicit sex').ok).toBe(true);
  });

  test('the platform\'s law still comes first everywhere: a minor with sexual content is refused as such', () => {
    expect(make(pipeline, 'a child, explicit sex')).toMatchObject({ ok: false, refusalClass: 'minor_sexual' });
    expect(make(still, 'a child, explicit sex')).toMatchObject({ ok: false, refusalClass: 'minor_sexual' });
  });
});

describe('video.wan.i2v — the adult-capable video pipeline (Apache-2.0)', () => {
  const wan = resolvePipeline('video.wan.i2v').pipeline;
  const wanModel = resolveModel(wan).model;
  const runWan = (args, extra = {}) => parameterize({
    pipeline: wan, model: wanModel, args, jobId: '7b0c6d1e-5b6a-4a71-9d6f-2a0d4e9c1f00', screenList: EMPTY_LAW,
    fallbackSeed: 9, sourceImageName: 'job.png', ...extra,
  });

  test('registered on a hashed model, every part hashed, a source image required, no licence boundary', () => {
    expect(wan).toMatchObject({ kind: 'video', template: 'wani2v', requiresSourceImage: true });
    expect(wan.licenceRefuses ?? []).toEqual([]);
    expect(wanModel.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.values(wanModel.companions).every((c) => /^[0-9a-f]{64}$/.test(c.sha256) && c.bytes > 0)).toBe(true);
  });

  test('defaults: 5 s at 16 fps (81 frames), two experts each with its 4-step LoRA, split 0→2 / 2→4', () => {
    const r = runWan({ positive: 'she turns toward the window' });
    expect(r.ok).toBe(true);
    expect(node(r.graph, 'WanImageToVideo')[0].inputs).toMatchObject({ width: 1280, height: 720, length: 81 });
    expect(node(r.graph, 'UNETLoader').map((n) => n.inputs.unet_name).sort()).toEqual([wanModel.highNoiseName, wanModel.lowNoiseName].sort());
    expect(node(r.graph, 'LoraLoaderModelOnly').map((n) => n.inputs.lora_name).sort()).toEqual([wanModel.highLoraName, wanModel.lowLoraName].sort());
    const samplers = node(r.graph, 'KSamplerAdvanced').map((n) => [n.inputs.start_at_step, n.inputs.end_at_step]);
    expect(samplers).toEqual(expect.arrayContaining([[0, 2], [2, 4]]));
    expect(node(r.graph, 'CreateVideo')[0].inputs.fps).toBe(16);
    expect(node(r.graph, 'LoadImage')[0].inputs.image).toBe('job.png');
    expect(node(r.graph, 'CLIPTextEncode').map((n) => n.inputs.text)).toContain('she turns toward the window');
  });

  test('portrait canvas; an over-long clip clamps to the 5 s the model is trained for', () => {
    expect(node(runWan({ positive: 'x', aspect: 'portrait' }).graph, 'WanImageToVideo')[0].inputs).toMatchObject({ width: 720, height: 1280 });
    expect(node(runWan({ positive: 'x', seconds: 10 }).graph, 'WanImageToVideo')[0].inputs.length).toBe(81);
  });

  test('no source image, no clip', () => {
    expect(runWan({ positive: 'x' }, { sourceImageName: null }).ok).toBe(false);
  });

  test('adult content is allowed — and every hard line is still refused', () => {
    const LAW = compileScreenList({
      classes: {
        csam: [], age_minor: ['child'], sexual_explicit: ['explicit sex'], sexual_suggestive: [],
        incest: ['siblings'], bestiality: ['with a dog'], nonconsent: ['forced'],
      },
    });
    const make = (positive) => parameterize({
      pipeline: wan, model: wanModel, args: { positive }, jobId: '7b0c6d1e-5b6a-4a71-9d6f-2a0d4e9c1f00',
      screenList: LAW, fallbackSeed: 9, sourceImageName: 'job.png', sourceLineage: 'a recorded still',
    });
    expect(make('two adults, explicit sex').ok).toBe(true);
    expect(make('a child, explicit sex')).toMatchObject({ ok: false, refusalClass: 'minor_sexual' });
    expect(make('a woman with a dog')).toMatchObject({ ok: false, refusalClass: 'bestiality' });
    expect(make('forced, explicit sex')).toMatchObject({ ok: false, refusalClass: 'nonconsent_sexual' });
    expect(make('siblings, explicit sex')).toMatchObject({ ok: false, refusalClass: 'incest_sexual' });
  });
});
