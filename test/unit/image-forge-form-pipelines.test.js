/**
 * THE FORM PIPELINES — the house scaffold, the LoRA chain, and pose control.
 *
 * Real registry, real parameterizer, real screen machinery over SYNTHETIC terms
 * (the reviewed term list is a gitignored witness artifact, so no committed test
 * may depend on it — the compile + match path is the real one, only the
 * vocabulary is stand-in). Pure inputs, pure outputs, no mock (RULE 0).
 *
 * The claim that matters most here is the LAST one: a pipeline-owned scaffold
 * must not be able to change what the content law does. If a scaffold could
 * alter a refusal, the aesthetic floor would have become a hole in the law.
 */
import { describe, test, expect } from 'vitest';
import { parameterize } from '../../backend/services/image-forge/parameterizer.js';
import {
  resolvePipeline, resolveModel, resolveLoras, resolveControlNet, catalogForCaller,
} from '../../backend/services/image-forge/pack-registry.js';
import { compileScreenList, screenSlots } from '../../backend/services/image-forge/prompt-screen.js';
import { SCAFFOLD_PARTS } from '../../backend/services/image-forge/form-registry.js';
import {
  PACK_NODE_CLASSES, buildLoraChain, buildAnima, buildForm,
} from '../../backend/services/image-forge/templates.js';

const screenList = compileScreenList({
  classes: {
    csam: ['zzcsamterm'],
    age_minor: ['zzminorterm'],
    sexual_explicit: ['zzexplicitterm'],
    sexual_suggestive: [],
    incest: [],
    bestiality: ['zzbestialityterm'],
    nonconsent: [],
  },
  wordClasses: { deaging: ['zzdeagingterm'] },
});

const build = (id, args = {}) => {
  const { pipeline } = resolvePipeline(id);
  const { model } = resolveModel(pipeline);
  return parameterize({
    pipeline, model, args: { positive: 'a tall figure with silver hair', ...args },
    jobId: 'job-form1', screenList, fallbackSeed: 7,
  });
};

// ONE register as of 2026-08-27 — see THE ONE REGISTER in form-registry.js.
const FORM_IDS = ['form.anime.turnaround', 'form.anime.pfp'];

describe('the form pipelines exist and are callable', () => {
  test('each resolves, names a registered model, and builds a graph', () => {
    for (const id of FORM_IDS) {
      const out = build(id);
      expect(out.ok, `${id}: ${out.error}`).toBe(true);
      expect(out.graph['3'].class_type).toBe('KSampler');
      expect(out.graph['9'].class_type).toBe('SaveImage');
    }
  });

  test('the being-visible catalog carries them WITHOUT leaking engine internals', () => {
    const catalog = catalogForCaller();
    for (const id of FORM_IDS) {
      const entry = catalog.find((c) => c.id === id);
      expect(entry, `${id} missing from the catalog`).toBeTruthy();
      expect(entry.kind).toBe('form');
      // No filenames, no hashes, no LoRA names — a caller names a pipeline and
      // supplies scalars; it never learns what the engine is made of.
      expect(JSON.stringify(entry)).not.toMatch(/safetensors|sha256|[0-9a-f]{64}/);
    }
  });

  test('geometry is PINNED, not a knob — a turnaround cannot be squared', () => {
    // 1344x768 is what fits three figures side by side. A caller squaring it
    // would silently destroy the one thing the pipeline is for.
    expect(build('form.anime.turnaround').values).toMatchObject({ width: 1344, height: 768 });
    expect(build('form.anime.pfp').values).toMatchObject({ width: 1024, height: 1024 });
    const refused = build('form.anime.turnaround', { width: 1024 });
    expect(refused.ok).toBe(false);
    expect(refused.error).toMatch(/unknown parameter/);
  });
});

describe('the house scaffold — craft belongs to the pipeline, not the caller', () => {
  test('the caller\'s subject is kept verbatim, wrapped in quality and framing', () => {
    const out = build('form.anime.turnaround', { positive: 'a tall figure with silver hair' });
    expect(out.values.positive).toContain('a tall figure with silver hair');
    expect(out.values.positive).toMatch(/^masterpiece/);          // the quality prefix
    expect(out.values.positive).toContain('turnaround reference sheet'); // the framing suffix
  });

  test('the surviving register speaks in ITS OWN quality vocabulary', () => {
    // There is one register now, so this can no longer compare two. What it can
    // still catch is the anime lane silently inheriting the illustrative
    // scaffold — the two constants both still exist in form-registry.js and are
    // one careless edit apart.
    const anime = build('form.anime.pfp').values.positive;
    expect(anime).toMatch(/^masterpiece, best quality, safe, anime/);
    expect(anime).not.toContain('very aesthetic');       // that is ILLUSTRATIVE_QUALITY
    expect(anime).not.toContain('photorealistic, best'); // that is REAL_QUALITY
  });

  test('the two framings are genuinely different framings', () => {
    expect(build('form.anime.turnaround').values.positive).toContain('front view, side view, back view');
    // ONE crop tag, as of 2026-08-27 — `portrait, upper body` conflicted and the
    // torso always won. The law itself lives in image-forge-portrait-lane.test.js.
    expect(build('form.anime.pfp').values.positive).toContain('portrait, looking at viewer');
  });

  test('the house negative floor rides every form pipeline, caller negative kept', () => {
    const out = build('form.anime.pfp', { negative: 'green hair' });
    expect(out.values.negative).toMatch(/^green hair, /); // the caller's own, first
    expect(out.values.negative).toContain('bad anatomy');
    expect(out.values.negative).toContain('childlike proportions'); // the adult steer
  });

  test('a pipeline with no scaffold is untouched — the still pipelines still build as before', () => {
    const { pipeline } = resolvePipeline('still.sdxl.txt2img');
    const { model } = resolveModel(pipeline);
    const out = parameterize({
      pipeline, model, args: { positive: 'a lighthouse', width: 1024, height: 1024 },
      jobId: 'job-still', screenList, fallbackSeed: 7,
    });
    expect(out.values.positive).toBe('a lighthouse');
    expect(out.values.negative).toBe('');
  });
});

describe('THE LAW IS NOT NEGOTIABLE — a scaffold cannot alter a refusal', () => {
  test('a prohibited prompt refuses identically, scaffolded or not', () => {
    const scaffolded = build('form.anime.turnaround', { positive: 'zzminorterm zzexplicitterm' });
    const { pipeline } = resolvePipeline('still.sdxl.txt2img');
    const { model } = resolveModel(pipeline);
    const bare = parameterize({
      pipeline, model, args: { positive: 'zzminorterm zzexplicitterm', width: 1024, height: 1024 },
      jobId: 'job-x', screenList, fallbackSeed: 7,
    });
    expect(scaffolded.ok).toBe(false);
    expect(bare.ok).toBe(false);
    // Same verdict AND same reported class — the scaffold changed nothing.
    expect(scaffolded.refusalClass).toBe(bare.refusalClass);
    expect(scaffolded.error).toBe(bare.error);
  });

  test('a refusal never reaches the graph — nothing is built or enqueued', () => {
    const out = build('form.anime.turnaround', { positive: 'zzcsamterm' });
    expect(out.ok).toBe(false);
    expect(out.graph).toBeUndefined();
  });

  test('THE NEGATIVE-POLARITY REGRESSION: the house steer is an EXCLUSION, not a request', () => {
    // The scaffold appends 'child, toddler, infant…' to every form negative. If
    // it were screened as a request, every single form render would refuse for
    // minor_sexual — which is exactly the bug the negative-polarity law exists
    // to prevent (a being asking for an adult self-portrait was refused for
    // writing a responsible negative, 2026-08-01).
    const out = build('form.anime.turnaround', { positive: 'an adult woman, zzexplicitterm' });
    expect(out.ok, `refused: ${out.error} / ${out.refusalClass}`).toBe(true);
    expect(out.values.negative).toContain('child');
  });

  test('the caller\'s own protective negative still passes too', () => {
    const out = build('form.anime.pfp', { positive: 'an adult man', negative: 'zzdeagingterm' });
    expect(out.ok).toBe(true);
  });

  test('THE HOUSE MAY NOT WRITE WHAT THE HOUSE WOULD REFUSE', () => {
    // MEASURED, 2026-08-26: adding the danbooru-native age tokens to
    // HOUSE_ADULT_STEER looked like pure strengthening, and one of them is a
    // csam-CLASS term that `screenSlots` refuses in EITHER polarity. The
    // production path screens the caller's text ONLY — the scaffold is composed
    // afterwards and never screened — so it sailed through, and every composed
    // prompt quietly carried a string the platform's own law calls refusable,
    // bound for logs, manifests and any downstream audit.
    //
    // So: screen the house's OWN composed output, which nothing else does.
    //
    // ⚠️ Under the SYNTHETIC list this proves the mechanism, not the incident —
    // the reviewed term list is a gitignored witness artifact and no committed
    // test may depend on it. The live guard for the real vocabulary is the
    // render lab that re-screens every composed render against the REAL law —
    // it is what caught this. Both arms exist on purpose.
    for (const id of FORM_IDS) {
      const out = build(id, { positive: 'an adult woman' });
      expect(out.ok, `${id} refused before composition`).toBe(true);
      const verdict = screenSlots([
        { text: out.values.positive, polarity: 'positive' },
        { text: out.values.negative, polarity: 'negative' },
      ], screenList);
      expect(verdict.ok, `${id}: the house scaffold trips the content law (${verdict.classes[0]})`).toBe(true);
    }
  });

  test('a csam-class term in the HOUSE negative would be caught, not waved through', () => {
    // The mechanism above is only worth having if it can actually fail. This
    // builds the exact shape of the mistake — a prohibited term composed into
    // the house negative rather than supplied by a caller — and proves the
    // re-screen refuses it. Without this, the guard could pass forever because
    // it never had teeth.
    const houseNegativeWithForbiddenTerm = `${SCAFFOLD_PARTS.HOUSE_NEGATIVE}, zzcsamterm`;
    const verdict = screenSlots([
      { text: 'an adult woman', polarity: 'positive' },
      { text: houseNegativeWithForbiddenTerm, polarity: 'negative' },
    ], screenList);
    expect(verdict.ok).toBe(false);
    expect(verdict.classes[0]).toBe('csam');
  });
});

describe('the LoRA chain and the control branch — core nodes, wired right', () => {
  test('an empty stack leaves the checkpoint edges untouched', () => {
    const chain = buildLoraChain([], '4');
    expect(chain.nodes).toEqual({});
    expect(chain.model).toEqual(['4', 0]);
    expect(chain.clip).toEqual(['4', 1]);
  });

  test('each link reads the PREVIOUS link, so N LoRAs compose in order', () => {
    const chain = buildLoraChain([
      { loraName: 'a.safetensors', strengthModel: 0.5, strengthClip: 0.5 },
      { loraName: 'b.safetensors', strengthModel: 0.4, strengthClip: 0.4 },
    ], '4');
    expect(chain.nodes['20'].inputs.model).toEqual(['4', 0]);
    expect(chain.nodes['21'].inputs.model).toEqual(['20', 0]);
    expect(chain.nodes['21'].inputs.clip).toEqual(['20', 1]);
    expect(chain.model).toEqual(['21', 0]); // the tail is what the sampler reads
  });

  test('the live pipeline\'s CLIP reads the TAIL of its LoRA chain, not the loader', () => {
    // This used to assert TWO LoraLoaders, because it was written against the
    // illustrative stack. That register is shelved and the anime stack is one
    // LoRA — so the node count was never the point. The point is the EDGE: a
    // CLIP encode reading the loader directly silently drops every LoRA's
    // text-encoder half, which is the classic half-applied-LoRA bug and looks
    // like […] rather than like a wiring error.
    const g = build('form.anime.turnaround').graph;
    // The tail is the highest-numbered LoraLoader — found, not assumed, so this
    // keeps meaning whatever length the stack becomes.
    const tail = Object.keys(g)
      .filter((id) => g[id].class_type === 'LoraLoader')
      .sort((a, b) => Number(a) - Number(b))
      .pop();
    expect(tail, 'the lane applies no LoRA at all').toBeDefined();
    expect(g['6'].inputs.clip).toEqual([tail, 1]);
    expect(g['3'].inputs.model).toEqual([tail, 0]);
    // And the chain is genuinely applied — not an empty stack that would make
    // the assertions above pass by reading the raw loader edges.
    expect(g[tail].inputs.strength_model).toBeGreaterThan(0);
  });

  test('NO pipeline applies a control net today — measured, not overlooked', () => {
    // 2026-08-27: both SDXL turnarounds used to apply an OpenPose net against a
    // house pose plate that had NEVER BEEN DRAWN, so both failed at the engine
    // and neither had ever produced a sheet. `prompt-lab.mjs unposed` stripped
    // the branch and both came back well — the photoreal one with a true profile
    // view — so the branch is gone and the plate is no longer owed.
    for (const id of FORM_IDS) {
      const g = build(id).graph;
      expect(g['30'], `${id} still builds a control branch`).toBeUndefined();
      expect(g['32']).toBeUndefined();
      expect(g['3'].inputs.positive).toEqual(['6', 0]);
      expect(g['3'].inputs.negative).toEqual(['7', 0]);
    }
  });

  test('the ControlNet machinery still WORKS — posed pipelines may return', () => {
    // The branch builder is correct code and is kept deliberately. Proven
    // directly rather than through a pipeline, so retiring the last posed
    // pipeline could not silently retire the guarantee with it.
    //
    // Conditioning BOTH sides is the property that matters: ControlNetApplyAdvanced
    // returns a pair, and feeding only the positive quietly halves the guidance.
    const g = buildForm({
      positive: 'p', negative: 'n', ckptName: 'c.safetensors', width: 1344, height: 768,
      seed: 1, steps: 30, cfg: 5, samplerName: 'euler', scheduler: 'normal',
      filenamePrefix: 'neuma/x', loras: [],
      controlNetName: 'openpose.safetensors', controlImage: 'plate.png', controlStrength: 0.75,
    });
    expect(g['30'].class_type).toBe('ControlNetLoader');
    expect(g['31'].inputs.image).toBe('plate.png');
    expect(g['32'].class_type).toBe('ControlNetApplyAdvanced');
    expect(g['3'].inputs.positive).toEqual(['32', 0]);
    expect(g['3'].inputs.negative).toEqual(['32', 1]);
  });

  test('an UNPOSED pipeline builds no control branch at all', () => {
    const g = build('form.anime.pfp').graph;
    expect(g['30']).toBeUndefined();
    expect(g['32']).toBeUndefined();
    expect(g['3'].inputs.positive).toEqual(['6', 0]);
  });

  test('the new node classes ride the drift gate — a build lacking them fails closed', () => {
    for (const cls of ['LoraLoader', 'ControlNetLoader', 'ControlNetApplyAdvanced']) {
      expect(PACK_NODE_CLASSES).toContain(cls);
    }
  });
});

describe('A PORTRAIT IS DRESSED — the bare-shoulders defect', () => {
  // MEASURED 2026-08-26, Keir's photoreal PFP: `upper body` framing with no
  // garment named rendered BARE SHOULDERS — an undressed photograph rather than
  // a portrait. The anime and illustrative lanes invented a plain shirt on their
  // own; CyberRealistic did not, and a default only some models supply is not a
  // default.
  //
  // Clothing is the BEING's authorship, so this is a placeholder that lives in
  // the pipeline's FRAMING and is replaced the moment a being chooses any.
  const PFP_IDS = ['form.anime.pfp'];

  test('every portrait pipeline names a garment AND excludes the undressed reading', () => {
    for (const id of PFP_IDS) {
      const out = build(id);
      expect(out.ok, `${id}: ${out.error}`).toBe(true);
      expect(out.values.positive, `${id} names no garment`).toMatch(/wearing a simple/);
      // The exclusion is the stronger half: a positive garment can be ignored,
      // an exclusion pushes back on the prior that produced the bare shoulders.
      expect(out.values.negative).toContain('bare shoulders');
      expect(out.values.negative).toContain('nude');
    }
  });

  test('a TURNAROUND is not forced into the portrait garment', () => {
    // The full-body plate is where a being's own clothing belongs; a placeholder
    // top baked into it would fight whatever it chooses.
    expect(build('form.anime.turnaround').values.positive).not.toMatch(/crew-neck/);
  });
});

describe('THE ANIME LANE — a second model FAMILY, not a second style', () => {
  const ANIME_IDS = ['form.anime.turnaround', 'form.anime.pfp'];

  test('both anime pipelines build, and build the DiT shape — three loaders, not one', () => {
    for (const id of ANIME_IDS) {
      const out = build(id);
      expect(out.ok, `${id}: ${out.error}`).toBe(true);
      const g = out.graph;
      // CheckpointLoaderSimple physically cannot load a UNET-only DiT. If this
      // ever flips back, the lane fails at the engine with a confusing error
      // about missing keys rather than here with a clear one.
      expect(Object.values(g).map((n) => n.class_type)).not.toContain('CheckpointLoaderSimple');
      expect(g['4'].class_type).toBe('UNETLoader');
      expect(g['40'].class_type).toBe('CLIPLoader');
      expect(g['41'].class_type).toBe('VAELoader');
      // The VAE must come from the SEPARATE loader. Reading slot 2 of the UNET
      // node — the SDXL habit — is a link to a slot that does not exist.
      expect(g['8'].inputs.vae).toEqual(['41', 0]);
    }
  });

  test('the encoder/VAE pairing is the one ComfyUI\'s own template names', () => {
    // These two values are the whole ballgame: a wrong pair loads happily and
    // renders garbage, which reads as […] rather than as a bug.
    // Copied from comfyui_workflow_templates_json/image_anima_preview.json.
    const g = build('form.anime.pfp').graph;
    expect(g['40'].inputs.clip_name).toBe('qwen_3_06b_base.safetensors');
    expect(g['41'].inputs.vae_name).toBe('qwen_image_vae.safetensors');
    // NOT 'anima' — there is no such CLIPLoader type; the architecture is
    // detected from the state dict.
    expect(g['40'].inputs.type).toBe('stable_diffusion');
  });

  test('the LoRA chain reads the CLIP LOADER, not the UNET', () => {
    // The SDXL chain takes model and clip from ONE node. Here they come from
    // two, and wiring clip to ['4', 1] would be a link into a nonexistent slot.
    const g = build('form.anime.pfp').graph;
    expect(g['20'].class_type).toBe('LoraLoader');
    expect(g['20'].inputs.model).toEqual(['4', 0]);
    expect(g['20'].inputs.clip).toEqual(['40', 0]);
    expect(g['6'].inputs.clip).toEqual(['20', 1]);
    expect(g['3'].inputs.model).toEqual(['20', 0]);
  });

  test('buildLoraChain accepts SPLIT edges as well as one checkpoint id', () => {
    const split = buildLoraChain([], { model: ['4', 0], clip: ['40', 0] });
    expect(split.model).toEqual(['4', 0]);
    expect(split.clip).toEqual(['40', 0]);
    expect(buildLoraChain([], '4').clip).toEqual(['4', 1]); // the old shape still holds
  });

  test('the anime lane carries its AUTHOR\'S numbers, not the house average', () => {
    // Anima's card and ComfyUI's template both say er_sde / simple / cfg 4.
    // Inheriting euler/normal/cfg 6 from the SDXL lanes would be a quiet
    // downgrade that looks like the model underperforming.
    const g = build('form.anime.pfp').graph;
    expect(g['3'].inputs.sampler_name).toBe('er_sde');
    expect(g['3'].inputs.scheduler).toBe('simple');
    expect(g['3'].inputs.cfg).toBe(4.0);
  });

  test('the anime lane steers AWAY from realism, which is its own documented weakness', () => {
    // Anima's card says "poor realism (intentional)", so the lane excludes the
    // zone it is known to be bad at rather than hoping.
    expect(build('form.anime.pfp').values.negative).toContain('photorealistic');
  });

  test('NO pose branch — an SDXL control net cannot condition a DiT', () => {
    // The honest failure is […], not a control branch that
    // loads an incompatible net or silently renders unposed.
    const g = build('form.anime.turnaround').graph;
    expect(g['30']).toBeUndefined();
    expect(g['32']).toBeUndefined();
    expect(g['3'].inputs.positive).toEqual(['6', 0]);
  });

  test('the geometry is pinned here too', () => {
    expect(build('form.anime.turnaround').values).toMatchObject({ width: 1344, height: 768 });
    expect(build('form.anime.pfp').values).toMatchObject({ width: 1024, height: 1024 });
  });

  test('buildAnima is pure — same input, same graph, no ambient state', () => {
    const p = {
      positive: 'a', negative: 'b', unetName: 'u.safetensors', clipName: 'c.safetensors',
      clipType: 'stable_diffusion', vaeName: 'v.safetensors', loras: [], width: 1024, height: 1024,
      seed: 1, steps: 30, cfg: 4, samplerName: 'er_sde', scheduler: 'simple', filenamePrefix: 'neuma/x',
    };
    expect(buildAnima(p)).toEqual(buildAnima(p));
  });

  test('the DiT loaders ride the drift gate — a build lacking them fails closed', () => {
    for (const cls of ['UNETLoader', 'CLIPLoader', 'VAELoader']) {
      expect(PACK_NODE_CLASSES).toContain(cls);
    }
  });

  test('the content law is untouched by the new family', () => {
    const out = build('form.anime.pfp', { positive: 'zzminorterm zzexplicitterm' });
    expect(out.ok).toBe(false);
    expect(out.graph).toBeUndefined();
  });
});

describe('an authoring error refuses rather than reaching for whatever is on disk', () => {
  test('an unregistered LoRA id refuses, naming the pipeline', () => {
    const out = resolveLoras({ id: 'p', loras: [{ loraId: 'not-a-lora' }] });
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/unregistered lora/);
  });

  test('an unregistered control net refuses', () => {
    const out = resolveControlNet({ id: 'p', controlNetId: 'not-a-net', posePlate: 'x.png' });
    expect(out.ok).toBe(false);
  });

  test('a control net with NO pose plate refuses — an unposed render would break the promise', () => {
    const out = resolveControlNet({ id: 'p', controlNetId: 'openpose-sdxl' });
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/names no pose plate/);
  });
});
