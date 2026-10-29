/**
 * THE PORTRAIT — the plate a being is actually seen as, and the two laws that
 * were measured into it on 2026-08-27.
 *
 * Founder: […] That makes the portrait the plate worth pinning hardest, and the
 * two facts below were BOTH learned from renders rather than reasoning — which
 * is exactly the kind of fact that gets refactored away by someone who only has
 * the code in front of them.
 *
 *   1. THE PHOTOREAL REGISTER IS SHELVED, and its machinery is deliberately
 *      NOT deleted — restoring it must stay a two-entry change.
 *   2. THE PORTRAIT NAMES EXACTLY ONE CROP TAG. `portrait, upper body` conflict,
 *      and every model broke the tie toward a torso frame.
 *
 * Real registry, real parameterizer, real graphs — no mock (RULE 0).
 */
import { describe, test, expect } from 'vitest';
import { parameterize } from '../../backend/services/image-forge/parameterizer.js';
import { resolvePipeline, resolveModel, PACK_MODELS } from '../../backend/services/image-forge/pack-registry.js';
import { compileScreenList } from '../../backend/services/image-forge/prompt-screen.js';
import { PACK_NODE_CLASSES, buildZImage } from '../../backend/services/image-forge/templates.js';

const EMPTY_LAW = compileScreenList({
  classes: {
    csam: [], age_minor: [], sexual_explicit: [], sexual_suggestive: [],
    incest: [], bestiality: [], nonconsent: [],
  },
});

const build = (id, args = { positive: 'a 21 year old woman, rich brown skin' }) => {
  const { ok, pipeline, error } = resolvePipeline(id);
  if (!ok) throw new Error(error);
  const m = resolveModel(pipeline);
  if (!m.ok) throw new Error(m.error);
  return parameterize({
    pipeline, model: m.model, args, jobId: 'test', screenList: EMPTY_LAW, fallbackSeed: 7,
  });
};

const PFP_IDS = ['form.anime.pfp', 'form.illustrative.pfp'];

describe('THE PHOTOREAL REGISTER IS SHELVED — not callable, and not deleted either', () => {
  // Design note, 2026-08-27: […] The manifest is the only door, so a shelved
  // register must not resolve — and the machinery underneath it must survive, or
  // restoring the lane becomes a rewrite instead of two manifest entries.
  //
  // ⭐ The ILLUSTRATIVE ids LEFT this list 2026-08-28 — Founder: […] —
  // restored as the ground the non-humanoid neutral exploration runs on.
  test('no shelved pipeline resolves — the manifest is the door', () => {
    for (const id of ['form.real.pfp', 'form.real.turnaround']) {
      const out = resolvePipeline(id);
      expect(out.ok, `${id} is still callable`).toBe(false);
    }
  });

  test('the restored illustrative lane resolves, on the card\'s own settings', () => {
    for (const id of ['form.illustrative.pfp', 'form.illustrative.turnaround']) {
      const out = resolvePipeline(id);
      expect(out.ok, `${id} did not resolve`).toBe(true);
      // The model's card (ruling, 2026-08-28): Euler a or DPM++ 2M Karras,
      // CFG 5-8, steps 20-50. Pinned so a drive-by "tidy" cannot silently
      // reintroduce the settings the card supersedes.
      expect(out.pipeline.slots.samplerName.default).toBe('euler_ancestral');
      expect(out.pipeline.slots.cfg.default).toBeGreaterThanOrEqual(5);
      expect(out.pipeline.slots.cfg.default).toBeLessThanOrEqual(8);
    }
  });

  test('the Z-Image FAMILY survives intact — restoring the lane must not mean rebuilding it', () => {
    // ⚠️ Everything below is unreferenced by any pipeline today, which is exactly
    // what makes it easy to "clean up". It was measured against ComfyUI's own
    // bundled `image_z_image.json` and it is correct; deleting it would throw
    // that away for nothing.
    const m = PACK_MODELS['z-image-bf16'];
    expect(m.family).toBe('zimage');
    expect(m.clipType).toBe('lumina2');          // Z-Image extends Lumina2 in supported_models.py
    expect(m.shift).toBe(3);                     // architecture, not a house knob — so it rides the MODEL
    // A wrong text encoder loads happily and renders garbage, which reads as
    // […] rather than as an error. Null means NOT YET
    // ATTESTED, never TRUSTED.
    for (const hash of [m.sha256, m.companions.clip.sha256, m.companions.vae.sha256]) {
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  test('buildZImage still builds the shape whose two differences are silent to lose', () => {
    const p = {
      positive: 'a', negative: 'b', unetName: 'u.safetensors', clipName: 'c.safetensors',
      clipType: 'lumina2', vaeName: 'v.safetensors', shift: 3, loras: [], width: 1024, height: 1024,
      seed: 1, steps: 25, cfg: 4, samplerName: 'res_multistep', scheduler: 'simple', filenamePrefix: 'neuma/x',
    };
    const g = buildZImage(p);
    // Three loaders, not one: a UNET-only DiT cannot come out of a checkpoint loader.
    expect(Object.values(g).map((n) => n.class_type)).not.toContain('CheckpointLoaderSimple');
    // ⚠️ The two differences from Anima. Drop either and the graph still RENDERS
    // — badly, for a reason no prompt change would ever explain.
    expect(g['5'].class_type).toBe('EmptySD3LatentImage');
    expect(g['42'].class_type).toBe('ModelSamplingAuraFlow');
    // The sampler must read the SHIFTED model, never the raw loader.
    expect(g['3'].inputs.model).toEqual(['42', 0]);
    expect(g['42'].inputs.model).toEqual(['4', 0]);
    expect(buildZImage(p)).toEqual(g);           // pure — same input, same graph
  });

  test('the Z-Image nodes still ride the drift gate — a build lacking them fails closed', () => {
    for (const cls of ['EmptySD3LatentImage', 'ModelSamplingAuraFlow']) {
      expect(PACK_NODE_CLASSES).toContain(cls);
    }
  });
});

describe('THE PORTRAIT NAMES EXACTLY ONE CROP TAG', () => {
  // `portrait` is head-and-shoulders; `upper body` is waist-up. Naming both left
  // each model to break the tie, and every tie-break went toward the torso — so
  // on the one plate whose subject IS the face, the face was a minority of the
  // canvas. The Illustrious guidance says this outright; we had it in the
  // research and shipped the pair anyway until a render forced the issue.
  test('no portrait pipeline names a second crop tag', () => {
    for (const id of PFP_IDS) {
      const positive = build(id).values.positive;
      expect(positive, `${id} still names two crop tags`).not.toMatch(/upper body/);
      expect(positive, `${id} lost its crop tag entirely`).toMatch(/portrait/);
      // `close-up` and `headshot` are the same trap wearing different words.
      expect(positive, `${id} names a conflicting crop tag`).not.toMatch(/close-up|headshot/);
    }
  });

  test('`face focus` stays OUT — it helps two lanes and corrupts a genome trait in the third', () => {
    // MEASURED on the photoreal lane before it was shelved: with `face focus`,
    // Z-Image (prose-native, not danbooru-trained) rewrote the subject's HAIR. A
    // tag that changes a GIVEN trait is not a framing tag, whatever it does for
    // composition elsewhere. The lane is gone; the lesson is not, because the
    // shared scaffold is still shared and the next prose model will do the same.
    for (const id of PFP_IDS) {
      expect(build(id).values.positive, `${id}`).not.toMatch(/face focus/);
    }
  });

  test('the garment survived losing `upper body` — that is why the drop was safe', () => {
    // `upper body` was added to leave room for a collar after the photoreal lane
    // rendered bare shoulders. `portrait` alone held the collar in ALL THREE
    // registers it was measured in, so the hedge cost composition and bought
    // nothing. The garment and the exclusion both stay — they did the work.
    for (const id of PFP_IDS) {
      expect(build(id).values.positive, `${id}`).toMatch(/crew-neck/);
      expect(build(id).values.negative, `${id}`).toMatch(/bare shoulders/);
    }
  });

  test('a TURNAROUND is untouched — it is a full-body plate and never had this conflict', () => {
    for (const id of ['form.anime.turnaround']) {
      expect(build(id).values.positive, `${id}`).toMatch(/full body/);
      expect(build(id).values.positive, `${id}`).not.toMatch(/portrait/);
    }
  });
});

describe('⭐⭐ THE PORTRAIT CROP — the framing the MODEL would not do', () => {
  // Seven wordings and five geometries failed before this existed. It is a
  // deterministic image op precisely BECAUSE the model cannot be asked:
  //   4 danbooru crop tags     → four indistinguishable torso frames
  //   3 prose crop sentences   → three indistinguishable torso frames
  //   5 canvas geometries      → WIDER MADE IT WORSE; more room, further back
  // Anima composes at a fixed subject scale no matter what it is told or given.
  test('the portrait crops and rescales; the turnaround does neither', () => {
    const pfp = build('form.anime.pfp').graph;
    expect(pfp['50'].class_type).toBe('ImageCrop');
    expect(pfp['51'].class_type).toBe('ImageScale');
    // SaveImage must read the RESCALED image. Reading ['8', 0] would save the
    // uncropped render and every assertion above would still pass — the crop
    // would be built, paid for, and silently discarded.
    expect(pfp['9'].inputs.images).toEqual(['51', 0]);

    // A turnaround is a full-body plate; cropping it would destroy the asset.
    const sheet = build('form.anime.turnaround').graph;
    expect(sheet['50']).toBeUndefined();
    expect(sheet['9'].inputs.images).toEqual(['8', 0]);
  });

  test('the crop is centred, anchored at the top, and NEVER cuts the crown', () => {
    // ⚠️ The first attempt used 0.58 and sliced through Keir's crown and chin —
    // Anima's subject scale VARIES BY BODY, so one box cannot be tight for a
    // distant render and safe for a near one. y=0 is why no head can lose its
    // top: the crop cannot start below the top of the frame.
    const c = build('form.anime.pfp').graph['50'].inputs;
    expect(c.y).toBe(0);
    expect(c.width).toBe(c.height);                        // square in, square out
    expect(c.x).toBe(Math.round((1024 - c.width) / 2));    // centred
    // Conservative on purpose: it helps the distant renders and is near a no-op
    // on the near ones. An over-tight crop destroys a face; a loose one leaves
    // headroom. Those costs are not symmetric.
    expect(c.width / 1024).toBeGreaterThanOrEqual(0.7);
    expect(c.width / 1024).toBeLessThan(1);
  });

  test('the output keeps the pipeline\'s pinned square — a crop is invisible downstream', () => {
    const g = build('form.anime.pfp').graph;
    expect(g['51'].inputs.width).toBe(1024);
    expect(g['51'].inputs.height).toBe(1024);
    expect(build('form.anime.pfp').values).toMatchObject({ width: 1024, height: 1024 });
  });

  test('the crop nodes ride the drift gate — core classes only, no custom node', () => {
    // A face-aware crop would need a detection node, and every one of those is a
    // custom node — a supply-chain surface this lane has refused from the start.
    for (const cls of ['ImageCrop', 'ImageScale']) {
      expect(PACK_NODE_CLASSES).toContain(cls);
    }
  });

  test('the crop is the PIPELINE\'s, never a caller\'s', () => {
    // Framing is the pipeline's job exactly like its geometry. If this became a
    // slot, a caller could turn off the only thing making a PFP a portrait.
    const { pipeline } = resolvePipeline('form.anime.pfp');
    expect(pipeline.portraitCrop).toBe(true);
    expect(Object.keys(pipeline.slots)).not.toContain('portraitCrop');
    const refused = build('form.anime.pfp', { positive: 'x', portraitCrop: false });
    expect(refused.ok).toBe(false);
    expect(refused.error).toMatch(/unknown parameter/);
  });
});
