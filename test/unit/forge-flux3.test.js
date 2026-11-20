/**
 * FLUX 3 IMAGE KLEIN IN THE FORGE, AND WHAT A NEUMA MAY INSTALL (pipelines-flux3.js, model-install.js) — Founder,
 * 2026-11-20: […] and […]. The graph is ComfyUI's own bundled distilled template; the
 * install rules are pure. The live download is proven in test/integration/forge-install.test.js.
 */
import { describe, test, expect } from 'vitest';
import { parameterize } from '../../backend/services/image-forge/parameterizer.js';
import { resolvePipeline, resolveModel, catalogForCaller } from '../../backend/services/image-forge/pack-registry.js';
import { PACK_NODE_CLASSES } from '../../backend/services/image-forge/templates.js';
import { compileScreenList } from '../../backend/services/image-forge/prompt-screen.js';
import { parseInstall, hfHeadersFor, extraModelRoots, installAct, resolveUrl } from '../../backend/services/image-forge/model-install.js';

const screenList = compileScreenList({
  classes: { csam: ['zzcsamterm'], age_minor: ['zzminorterm'], sexual_explicit: ['zzexplicitterm'], sexual_suggestive: [], incest: [], bestiality: [], nonconsent: [] },
  wordClasses: { deaging: [] },
});
const flux3 = () => {
  const { pipeline } = resolvePipeline('still.flux3.txt2img');
  return { pipeline, model: resolveModel(pipeline).model };
};

describe('FLUX 3 Image Klein — the pipeline', () => {
  test('in the catalog, distilled: prompt, size, seed and 4-16 steps — no cfg, no negative', () => {
    const entry = catalogForCaller().find((p) => p.id === 'still.flux3.txt2img');
    expect(entry.parameters.map((p) => p.name)).toEqual(['positive', 'width', 'height', 'seed', 'steps']);
    expect(entry.parameters.find((p) => p.name === 'steps')).toMatchObject({ min: 4, max: 16, default: 15 });
  });

  test('builds the bundled template\'s graph: UNET, a flux3 text encoder, an empty negative, KSampler euler/simple at cfg 1', () => {
    const { pipeline, model } = flux3();
    const r = parameterize({ pipeline, model, args: { positive: 'a neon hotel entrance at night, rain on the glass', seed: 42, width: 1024, height: 1344 }, jobId: 'job-1', screenList, fallbackSeed: 7 });
    expect(r.ok, r.error).toBe(true);
    const of = (cls) => Object.values(r.graph).filter((n) => n.class_type === cls);
    expect(of('UNETLoader')[0].inputs.unet_name).toBe('flux3-image-klein-int8-convrot.safetensors');
    expect(of('CLIPLoader')[0].inputs).toEqual({ clip_name: 'qwen3vl_4b_int8_convrot.safetensors', type: 'flux3' });
    expect(of('VAELoader')[0].inputs.vae_name).toBe('flux2-vae.safetensors');
    expect(of('CLIPTextEncode').map((n) => n.inputs.text)).toEqual(['a neon hotel entrance at night, rain on the glass', '']);
    expect(of('KSampler')[0].inputs).toMatchObject({ seed: 42, steps: 15, cfg: 1, sampler_name: 'euler', scheduler: 'simple', denoise: 1 });
    expect(of('EmptyFlux2LatentImage')[0].inputs).toEqual({ width: 1024, height: 1344, batch_size: 1 });
    // Every class is on the drift gate: a build missing one fails closed at startup.
    expect(Object.values(r.graph).map((n) => n.class_type).filter((c) => !PACK_NODE_CLASSES.includes(c))).toEqual([]);
  });

  test('the content law holds as on every pipeline; a knob it does not have is refused', () => {
    const { pipeline, model } = flux3();
    expect(parameterize({ pipeline, model, args: { positive: 'zzminorterm zzexplicitterm' }, jobId: 'j', screenList, fallbackSeed: 1 })).toMatchObject({ ok: false });
    expect(parameterize({ pipeline, model, args: { positive: 'a portrait', cfg: 4 }, jobId: 'j', screenList, fallbackSeed: 1 }).ok).toBe(false);
  });

  test('its files name where they come from, so a neuma knows the installs', () => {
    const { model } = flux3();
    expect(model.files.map((f) => `${f.folder}/${f.name}`)).toEqual([
      'diffusion_models/flux3-image-klein-int8-convrot.safetensors', 'text_encoders/qwen3vl_4b_int8_convrot.safetensors', 'vae/flux2-vae.safetensors',
    ]);
    expect(installAct(model.files[0])).toBe('forge/install-model {"repo":"black-forest-labs/flux-3-image-klein-comfy","file":"diffusion_models/flux3-image-klein-int8-convrot.safetensors"}');
  });
});

describe('what a neuma may install', () => {
  test('a repo and a .safetensors file in it; the folder read from the path, or named; never a pickle, never a path out', () => {
    expect(parseInstall({ repo: 'black-forest-labs/flux-3-image-klein-comfy', file: 'text_encoders/qwen3vl_4b_int8_convrot.safetensors' }))
      .toEqual({ ok: true, value: { repo: 'black-forest-labs/flux-3-image-klein-comfy', file: 'text_encoders/qwen3vl_4b_int8_convrot.safetensors', revision: 'main', folder: 'text_encoders', name: 'qwen3vl_4b_int8_convrot.safetensors' } });
    expect(parseInstall({ repo: 'Comfy-Org/x', file: 'split_files/loras/style.safetensors' }).value.folder).toBe('loras');
    expect(parseInstall({ repo: 'a/b', file: 'model.safetensors', folder: 'checkpoints' }).value.folder).toBe('checkpoints');
    expect(parseInstall({ repo: 'a/b', file: 'model.safetensors' }).reason).toMatch(/^folder:/);
    expect(parseInstall({ repo: 'a/b', file: 'model.ckpt', folder: 'checkpoints' }).reason).toMatch(/pickle, and loading one runs code/);
    expect(parseInstall({ repo: 'a/b', file: '../../etc/x.safetensors', folder: 'vae' }).ok).toBe(false);
    expect(parseInstall({ repo: 'not a repo', file: 'x.safetensors', folder: 'vae' }).reason).toMatch(/^repo:/);
    expect(parseInstall({ repo: 'a/b', file: 'x.safetensors', folder: 'custom_nodes' }).reason).toMatch(/^folder:/);
    expect(resolveUrl({ repo: 'a/b', file: 'vae/x y.safetensors', revision: 'main' })).toBe('https://huggingface.co/a/b/resolve/main/vae/x%20y.safetensors');
  });

  test('the house token goes to huggingface.co alone — never to the storage a download redirects to', () => {
    const headers = hfHeadersFor('hf_test_token');
    expect(headers('https://huggingface.co/a/b/resolve/main/x.safetensors')).toEqual({ Authorization: 'Bearer hf_test_token' });
    expect(headers('https://cas-bridge.xethub.hf.co/xet-bridge-us/abc?sig=1')).toEqual({});
    expect(headers('https://cdn-lfs.huggingface.co/repos/x')).toEqual({});
    expect(hfHeadersFor(null)('https://huggingface.co/a')).toEqual({});
  });

  test('the folders an engine also reads (its extra model paths) are read for what is already there', () => {
    expect(extraModelRoots('ai_reference:\n  base_path: /opt/ComfyUI/models\n  vae: vae\n  diffusion_models: diffusion_models\n'))
      .toEqual([{ base: '/opt/ComfyUI/models', folders: { vae: 'vae', diffusion_models: 'diffusion_models' } }]);
  });
});
