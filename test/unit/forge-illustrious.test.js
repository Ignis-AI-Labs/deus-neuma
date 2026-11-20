/**
 * THE ILLUSTRIOUS CHARACTER PIPELINES (pipelines-illustrious.js) — Design note, 2026-11-20, after a Sophie Zero render came out
 * muddy through SDXL Base: […]
 * Every wire of the graph is read here: both samplers take the same positive and negative, the clip skip reaches both
 * encoders, the hires pass starts from the base image and ends in the one saved file, and the recipe is the pipeline's,
 * not the caller's. The live render through a real engine is test/integration/forge-illustrious-live.test.js.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, test, expect } from 'vitest';
import { parameterize } from '../../backend/services/image-forge/parameterizer.js';
import { resolvePipeline, resolveModel, catalogForCaller } from '../../backend/services/image-forge/pack-registry.js';
import { PACK_NODE_CLASSES } from '../../backend/services/image-forge/templates.js';
import { compileScreenList } from '../../backend/services/image-forge/prompt-screen.js';
import { installsWaiting } from '../../backend/services/image-forge/model-install.js';
import { ADULT_FLOOR } from '../../backend/services/image-forge/pipelines-illustrious.js';

const screenList = compileScreenList({
  classes: { csam: ['zzcsamterm'], age_minor: ['zzminorterm'], sexual_explicit: ['zzexplicitterm'], sexual_suggestive: ['zzsuggestiveterm'], incest: [], bestiality: [], nonconsent: [] },
  wordClasses: { deaging: ['zzolderterm'] },
});
const IDS = ['still.wai.txt2img', 'still.deliberate.txt2img', 'still.nova.txt2img', 'still.neuma.txt2img'];
const SOFI = '1girl, solo, mature female, cowboy shot, artificial humanoid, android, smooth pale porcelain skin with a faint iridescent sheen, glowing green bioluminescent veins tracing beneath the skin, white hair, glowing green eyes';
const build = (id, args = {}) => {
  const { pipeline } = resolvePipeline(id);
  const { model } = resolveModel(pipeline);
  return { pipeline, model, r: parameterize({ pipeline, model, args: { positive: SOFI, seed: 1234, ...args }, jobId: 'job-sofi', screenList, fallbackSeed: 7 }) };
};
const nodesOf = (graph, cls) => Object.entries(graph).filter(([, n]) => n.class_type === cls);
const one = (graph, cls) => { const found = nodesOf(graph, cls); expect(found, cls).toHaveLength(1); return found[0]; };

describe('the three character pipelines', () => {
  test('in the catalog with the author\'s ranges: subject, negative, size, seed, steps, cfg — never the sampler', () => {
    const cat = catalogForCaller();
    const want = { 'still.wai.txt2img': [5, 7, 6, 20, 40, 28], 'still.deliberate.txt2img': [5, 8, 5, 20, 50, 30], 'still.nova.txt2img': [4, 6, 5, 20, 30, 28], 'still.neuma.txt2img': [4, 6, 5, 20, 30, 28] };
    for (const id of IDS) {
      const entry = cat.find((p) => p.id === id);
      expect(entry.parameters.map((p) => p.name)).toEqual(['positive', 'negative', 'width', 'height', 'seed', 'steps', 'cfg']);
      const [cmin, cmax, cdef, smin, smax, sdef] = want[id];
      expect(entry.parameters.find((p) => p.name === 'cfg')).toMatchObject({ min: cmin, max: cmax, default: cdef });
      expect(entry.parameters.find((p) => p.name === 'steps')).toMatchObject({ min: smin, max: smax, default: sdef });
    }
    expect(cat.find((p) => p.id === 'still.sdxl.txt2img').description).toMatch(/does not read anime tags/);
  });

  test.each(IDS)('%s — every wire: one positive and one negative into both samplers, the hires pass from the base image to the one saved file', (id) => {
    const { pipeline, model, r } = build(id);
    expect(r.ok, r.error).toBe(true);
    const g = r.graph;
    // Every link names a node that exists, and every class is on the drift gate.
    for (const [nid, node] of Object.entries(g)) {
      expect(PACK_NODE_CLASSES, `${nid} ${node.class_type}`).toContain(node.class_type);
      for (const v of Object.values(node.inputs)) if (Array.isArray(v)) expect(g[v[0]], `${nid} → ${v[0]}`).toBeTruthy();
    }
    const [ckptId, ckpt] = one(g, 'CheckpointLoaderSimple');
    expect(ckpt.inputs.ckpt_name).toBe(model.ckptName);
    // The prompt pair: the author's quality frame around the caller's words; the author's negative, the adult floor.
    const encoders = nodesOf(g, 'CLIPTextEncode');
    expect(encoders).toHaveLength(2);
    const [posId, pos] = encoders.find(([, n]) => n.inputs.text.includes(SOFI));
    const [negId, neg] = encoders.find(([, n]) => !n.inputs.text.includes(SOFI));
    expect(pos.inputs.text).toBe(`${pipeline.recipe.prefix}${SOFI}${pipeline.recipe.suffix}`);
    expect(neg.inputs.text).toBe(`${pipeline.recipe.negative}, ${ADULT_FLOOR}`);
    // Clip skip: when the recipe asks for it, BOTH encoders read the skipped CLIP; otherwise both read the checkpoint's.
    if (pipeline.recipe.clipSkip > 1) {
      const [skipId, skip] = one(g, 'CLIPSetLastLayer');
      expect(skip.inputs).toEqual({ clip: [ckptId, 1], stop_at_clip_layer: -pipeline.recipe.clipSkip });
      expect([pos.inputs.clip, neg.inputs.clip]).toEqual([[skipId, 0], [skipId, 0]]);
    } else {
      expect(nodesOf(g, 'CLIPSetLastLayer')).toHaveLength(0);
      expect([pos.inputs.clip, neg.inputs.clip]).toEqual([[ckptId, 1], [ckptId, 1]]);
    }
    // Two samplers, both on the checkpoint's model, the same positive and negative, the recipe's sampler and seed.
    const samplers = nodesOf(g, 'KSampler');
    expect(samplers).toHaveLength(2);
    for (const [, s] of samplers) {
      expect(s.inputs).toMatchObject({ model: [ckptId, 0], positive: [posId, 0], negative: [negId, 0], seed: 1234, sampler_name: 'euler_ancestral', scheduler: 'normal' });
    }
    const [baseId, base] = samplers.find(([, s]) => s.inputs.denoise === 1);
    const [hiresId, hires] = samplers.find(([, s]) => s.inputs.denoise === 0.4);
    const [latentId, latent] = one(g, 'EmptyLatentImage');
    expect(latent.inputs).toEqual({ width: 832, height: 1216, batch_size: 1 });
    expect(base.inputs.latent_image).toEqual([latentId, 0]);
    expect(base.inputs.steps).toBe(pipeline.slots.steps.default);
    expect(base.inputs.cfg).toBe(pipeline.slots.cfg.default);
    expect(hires.inputs.steps).toBe(20);
    expect(hires.inputs.cfg).toBe(base.inputs.cfg);
    // base latent → decode → model upscale → exactly 1.5x → encode → hires sample → decode → the one save.
    const decodes = nodesOf(g, 'VAEDecode');
    const [baseDecodeId] = decodes.find(([, n]) => n.inputs.samples[0] === baseId);
    const [hiresDecodeId] = decodes.find(([, n]) => n.inputs.samples[0] === hiresId);
    for (const [, d] of decodes) expect(d.inputs.vae).toEqual([ckptId, 2]);
    const [loaderId, loader] = one(g, 'UpscaleModelLoader');
    expect(loader.inputs.model_name).toBe('RealESRGAN_x4plus_anime_6B.safetensors');
    const [upId, up] = one(g, 'ImageUpscaleWithModel');
    expect(up.inputs).toEqual({ upscale_model: [loaderId, 0], image: [baseDecodeId, 0] });
    const [scaleId, scale] = one(g, 'ImageScale');
    expect(scale.inputs).toEqual({ image: [upId, 0], upscale_method: 'lanczos', width: 1248, height: 1824, crop: 'disabled' });
    const [encId, enc] = one(g, 'VAEEncode');
    expect(enc.inputs).toEqual({ pixels: [scaleId, 0], vae: [ckptId, 2] });
    expect(hires.inputs.latent_image).toEqual([encId, 0]);
    const [, save] = one(g, 'SaveImage');
    expect(save.inputs.images).toEqual([hiresDecodeId, 0]);
    expect(save.inputs.filename_prefix).toBe('neuma/job-sofi');
  });

  test('only perfectDeliberate and WAI read the whole CLIP; Hale skips its last layer, as its author asks, and so does ours', () => {
    expect(IDS.map((id) => resolvePipeline(id).pipeline.recipe.clipSkip)).toEqual([1, 1, 2, 2]);
  });

  test('our own model is registered by its file and SHA-256, and reads prompts on Hale\'s recipe whole (its text encoders are Hale\'s)', () => {
    const { pipeline, model } = build('still.neuma.txt2img');
    expect(model).toMatchObject({ id: 'deusneuma-character-xl', ckptName: 'deusneuma_characterXL_v0.1.safetensors', sha256: 'ff509539c562deb227311c8947273283b2f0caecce3b7139d0a6fcdacc7db501' });
    const hale = resolvePipeline('still.nova.txt2img').pipeline.recipe;
    expect(pipeline.recipe).toEqual(hale);
    expect(pipeline.files.map((f) => f.name)).toEqual(['deusneuma_characterXL_v0.1.safetensors', 'RealESRGAN_x4plus_anime_6B.safetensors']);
    expect(pipeline.description).toMatch(/Images made with it are yours, including for commercial use/);
  });

  test('the caller sizes, seeds and tunes inside the author\'s range; the sampler, clip skip and hires pass are not knobs', () => {
    const sized = build('still.wai.txt2img', { width: 1024, height: 1024, cfg: 12, steps: 99 });
    expect(sized.r.ok, sized.r.error).toBe(true);
    expect(one(sized.r.graph, 'ImageScale')[1].inputs).toMatchObject({ width: 1536, height: 1536 });
    const [, base] = nodesOf(sized.r.graph, 'KSampler').find(([, s]) => s.inputs.denoise === 1);
    expect([base.inputs.cfg, base.inputs.steps]).toEqual([7, 40]);
    for (const knob of [{ samplerName: 'euler' }, { scheduler: 'karras' }, { clipSkip: 1 }, { denoise: 0.9 }, { width: 640 }]) {
      expect(build('still.nova.txt2img', knob).r.ok, JSON.stringify(knob)).toBe(false);
    }
  });

  test('the caller\'s negative joins the author\'s and the adult floor — it cannot replace them', () => {
    const { pipeline, r } = build('still.wai.txt2img', { negative: 'extra fingers' });
    const texts = nodesOf(r.graph, 'CLIPTextEncode').map(([, n]) => n.inputs.text);
    expect(texts).toContain(`${pipeline.recipe.negative}, ${ADULT_FLOOR}, extra fingers`);
  });

  test('the content law judges the caller\'s words before any frame is added — a minor with anything sexual is refused', () => {
    for (const id of IDS) {
      expect(build(id, { positive: 'zzminorterm, zzsuggestiveterm' }).r).toMatchObject({ ok: false, refusalClass: 'minor_sexual' });
      expect(build(id, { positive: 'zzcsamterm' }).r).toMatchObject({ ok: false, refusalClass: 'csam' });
      // Steering away from adulthood in the negative while asking for something sexual is the same line, from the other side.
      expect(build(id, { positive: 'zzsuggestiveterm', negative: 'zzolderterm' }).r).toMatchObject({ ok: false, refusalClass: 'minor_sexual' });
      expect(build(id, { positive: `${SOFI}, zzsuggestiveterm` }).r.ok).toBe(true);
    }
  });
});

describe('the prompting rules, locked in (Design note, 2026-11-20', () => {
  // Metidar's own prompt, the one the swap proof reproduced pixel for pixel.
  const METIDAR = 'masterpiece, best quality, highres, 8k, detailed_eyes, sharp lineart, 1girl, full body, android, white hair';

  test('the quality tags are the pipeline\'s: a caller\'s copies are set aside — weighted or not — and the receipt names each one', () => {
    const { pipeline, r } = build('still.wai.txt2img', { positive: `(masterpiece:1.2), ${METIDAR}, Absurdres, UHD`, negative: 'worst quality, extra arms, Sketch, child' });
    expect(r.ok, r.error).toBe(true);
    const texts = nodesOf(r.graph, 'CLIPTextEncode').map(([, n]) => n.inputs.text);
    expect(texts).toContain(`${pipeline.recipe.prefix}detailed_eyes, sharp lineart, 1girl, full body, android, white hair`);
    expect(texts).toContain(`${pipeline.recipe.negative}, ${ADULT_FLOOR}, extra arms`);
    expect(r.values.note).toBe('The pipeline writes its own quality tags and negative frame, so it set aside yours: (masterpiece:1.2), masterpiece, best quality, highres, 8k, Absurdres, UHD, worst quality (negative), Sketch (negative), child (negative).');
  });

  test('Hale\'s own frame counts as its own: its date and lighting tags are not doubled either', () => {
    const { pipeline, r } = build('still.nova.txt2img', { positive: 'newest, 1girl, solo, volumetric lighting' });
    expect(nodesOf(r.graph, 'CLIPTextEncode').map(([, n]) => n.inputs.text)).toContain(`${pipeline.recipe.prefix}1girl, solo${pipeline.recipe.suffix}`);
  });

  test('a prompt with nothing to set aside goes through byte for byte, with no note', () => {
    const { r } = build('still.deliberate.txt2img');
    expect(r.values.note).toBeUndefined();
  });

  test('a prompt of quality tags alone has no subject and is refused, saying why', () => {
    expect(build('still.wai.txt2img', { positive: 'masterpiece, best quality, 8k' }).r).toMatchObject({ ok: false, error: expect.stringMatching(/needs a subject/) });
  });

  test('every listing carries the rules proven on it: framing, material, colour, length, one change at a time', () => {
    for (const id of IDS) {
      const { description } = catalogForCaller().find((p) => p.id === id);
      for (const rule of ['"cowboy shot"', 'armor, plate, chainmail, metal turn the whole body to metal', 'Every colour you name shows up', 'about 30 tags', 'keep the seed and change one thing', 'never age words — the content law refuses them anywhere, even in a negative', '"ball joints" drew a ball', 'Tie it to the part ("thin gold bones")', 'One region per render']) expect(description, `${id}: ${rule}`).toContain(rule);
    }
  });
});

describe('what the engine must hold', () => {
  test('each pipeline names its checkpoint and the upscaler; a missing one is said before any render, a present one is not', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir() === '/tmp' ? '/var/tmp' : os.tmpdir(), 'forge-illustrious-'));
    try {
      const { pipeline, model } = build('still.nova.txt2img');
      expect(pipeline.files.map((f) => `${f.folder}/${f.name}`)).toEqual(['checkpoints/novaAnimeXL_ilV190.safetensors', 'upscale_models/RealESRGAN_x4plus_anime_6B.safetensors']);
      const cfg = { modelsDir: path.join(root, 'models'), extraModelPaths: path.join(root, 'extra.yaml') };
      const none = await installsWaiting(model, cfg, pipeline);
      expect(none.missing.map((f) => f.name)).toEqual(['novaAnimeXL_ilV190.safetensors', 'RealESRGAN_x4plus_anime_6B.safetensors']);
      expect(none.words).toMatch(/checkpoints\/novaAnimeXL_ilV190\.safetensors \(no install is named; ask your operator\)/);
      // The checkpoint in the operator's library (an extra model path), the upscaler in the engine's own folder.
      await fs.mkdir(path.join(root, 'library', 'checkpoints'), { recursive: true });
      await fs.writeFile(path.join(root, 'library', 'checkpoints', 'novaAnimeXL_ilV190.safetensors'), 'x');
      await fs.writeFile(cfg.extraModelPaths, `lib:\n  base_path: ${path.join(root, 'library')}\n  checkpoints: checkpoints\n`);
      expect((await installsWaiting(model, cfg, pipeline)).missing.map((f) => f.name)).toEqual(['RealESRGAN_x4plus_anime_6B.safetensors']);
      await fs.mkdir(path.join(cfg.modelsDir, 'upscale_models'), { recursive: true });
      await fs.writeFile(path.join(cfg.modelsDir, 'upscale_models', 'RealESRGAN_x4plus_anime_6B.safetensors'), 'x');
      expect(await installsWaiting(model, cfg, pipeline)).toBeNull();
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
