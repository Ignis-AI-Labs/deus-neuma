import { describe, test, expect } from 'vitest';
import {
  buildTxt2Img, buildImg2Img, validateGraphAgainstObjectInfo, packClassesPresent, PACK_NODE_CLASSES,
} from '../../backend/services/image-forge/templates.js';

// Pure template shape + the /object_info drift validator. The live drift check
// against the real engine build is in the P2 integration suite (RULE 0); these
// prove the graph structure and the fail-closed validation law.

const params = {
  positive: 'a cyan geometric emblem on black',
  negative: 'blurry, watermark',
  ckptName: 'sd_xl_base_1.0.safetensors',
  width: 1024, height: 1024, seed: 42, steps: 20, cfg: 7,
  samplerName: 'euler', scheduler: 'normal', filenamePrefix: 'forge/job-123',
};

// A minimal /object_info-shaped fixture declaring exactly the pack's classes.
const objectInfoFor = (classes) => Object.fromEntries(classes.map((c) => [c, { input: { required: {}, optional: {} } }]));
const fullObjectInfo = {
  CheckpointLoaderSimple: { input: { required: { ckpt_name: [[]] } } },
  EmptyLatentImage: { input: { required: { width: [], height: [], batch_size: [] } } },
  CLIPTextEncode: { input: { required: { text: [], clip: [] } } },
  KSampler: { input: { required: { model: [], seed: [], steps: [], cfg: [], sampler_name: [], scheduler: [], positive: [], negative: [], latent_image: [], denoise: [] } } },
  VAEDecode: { input: { required: { samples: [], vae: [] } } },
  SaveImage: { input: { required: { images: [], filename_prefix: [] } } },
  LoadImage: { input: { required: { image: [] } } },
  VAEEncode: { input: { required: { pixels: [], vae: [] } } },
};

describe('buildTxt2Img', () => {
  test('emits the authored 7-node graph with prompt text as DATA, not templated JSON', () => {
    const g = buildTxt2Img(params);
    expect(g['4'].class_type).toBe('CheckpointLoaderSimple');
    expect(g['4'].inputs.ckpt_name).toBe('sd_xl_base_1.0.safetensors');
    expect(g['6'].inputs.text).toBe(params.positive); // data, exact
    expect(g['7'].inputs.text).toBe(params.negative);
    expect(g['3'].class_type).toBe('KSampler');
    expect(g['3'].inputs.denoise).toBe(1.0);
    expect(g['3'].inputs.positive).toEqual(['6', 0]);
    expect(g['9'].inputs.filename_prefix).toBe('forge/job-123'); // server-minted
  });

  test('scalar params ride as their own types (numbers stay numbers)', () => {
    const g = buildTxt2Img(params);
    expect(g['5'].inputs.width).toBe(1024);
    expect(g['3'].inputs.seed).toBe(42);
    expect(g['3'].inputs.cfg).toBe(7);
    expect(typeof g['3'].inputs.steps).toBe('number');
  });
});

describe('safePrefix guard (SaveImage path containment, defense-in-depth)', () => {
  test('an escaping filename_prefix is refused before a graph is built', () => {
    expect(() => buildTxt2Img({ ...params, filenamePrefix: '../../etc' })).toThrow(/non-escaping/);
    expect(() => buildTxt2Img({ ...params, filenamePrefix: '/abs/path' })).toThrow(/non-escaping/);
    expect(() => buildTxt2Img({ ...params, filenamePrefix: '' })).toThrow(/non-escaping/);
    expect(() => buildTxt2Img({ ...params, filenamePrefix: 'ok/nested/../up' })).toThrow(/non-escaping/);
  });
  test('a normal server-minted prefix passes', () => {
    expect(buildTxt2Img({ ...params, filenamePrefix: 'forge/job-abc123' })['9'].inputs.filename_prefix).toBe('forge/job-abc123');
  });
});

describe('buildImg2Img', () => {
  test('adds LoadImage → VAEEncode and routes the KSampler off the encoded latent with a denoise slot', () => {
    const g = buildImg2Img({ ...params, imageName: 'input.png', denoise: 0.6 });
    expect(g['10'].class_type).toBe('LoadImage');
    expect(g['10'].inputs.image).toBe('input.png');
    expect(g['11'].class_type).toBe('VAEEncode');
    expect(g['3'].inputs.latent_image).toEqual(['11', 0]);
    expect(g['3'].inputs.denoise).toBe(0.6);
  });
});

describe('validateGraphAgainstObjectInfo — the drift gate (pure, fail-closed)', () => {
  test('a fully-declared build passes the authored graph untouched', () => {
    expect(validateGraphAgainstObjectInfo(buildTxt2Img(params), fullObjectInfo)).toEqual({ ok: true, violations: [] });
    expect(validateGraphAgainstObjectInfo(buildImg2Img({ ...params, imageName: 'i.png', denoise: 0.5 }), fullObjectInfo).ok).toBe(true);
  });

  test('a missing class_type is a named violation', () => {
    const drifted = { ...fullObjectInfo };
    delete drifted.KSampler;
    const r = validateGraphAgainstObjectInfo(buildTxt2Img(params), drifted);
    expect(r.ok).toBe(false);
    expect(r.violations.some((v) => v.includes("class_type 'KSampler'"))).toBe(true);
  });

  test('a renamed input on a present class is a named violation', () => {
    const drifted = { ...fullObjectInfo, KSampler: { input: { required: { model: [], seed: [] /* steps renamed away */ } } } };
    const r = validateGraphAgainstObjectInfo(buildTxt2Img(params), drifted);
    expect(r.ok).toBe(false);
    expect(r.violations.some((v) => v.includes("input 'steps'"))).toBe(true);
  });

  test('empty or unreadable /object_info fails closed — never a silent pass', () => {
    expect(validateGraphAgainstObjectInfo(buildTxt2Img(params), {}).ok).toBe(false);
    expect(validateGraphAgainstObjectInfo(buildTxt2Img(params), null).ok).toBe(false);
    expect(validateGraphAgainstObjectInfo(buildTxt2Img(params), undefined).ok).toBe(false);
  });

  test('a link value counts as its input KEY, not a scalar — links never trip drift', () => {
    // KSampler.model is ['4',0]; the validator checks the key exists, which it does.
    const r = validateGraphAgainstObjectInfo(buildTxt2Img(params), fullObjectInfo);
    expect(r.ok).toBe(true);
  });
});

describe('packClassesPresent — cheap startup gate', () => {
  test('all pack classes present ⇒ ok', () => {
    expect(packClassesPresent(objectInfoFor(PACK_NODE_CLASSES))).toEqual({ ok: true, missing: [] });
  });

  test('a build missing a pack class names exactly what is missing', () => {
    const partial = objectInfoFor(PACK_NODE_CLASSES.filter((c) => c !== 'VAEEncode'));
    const r = packClassesPresent(partial);
    expect(r.ok).toBe(false);
    expect(r.missing).toEqual(['VAEEncode']);
  });

  test('null object_info fails closed with every class listed missing', () => {
    expect(packClassesPresent(null).ok).toBe(false);
    expect(packClassesPresent(null).missing).toEqual([...PACK_NODE_CLASSES]);
  });
});
