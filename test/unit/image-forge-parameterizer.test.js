import { describe, test, expect } from 'vitest';
import { resolveSlots, parameterize, MAX_MORE_REFERENCES } from '../../backend/services/image-forge/parameterizer.js';
import { resolvePipeline, resolveModel } from '../../backend/services/image-forge/pack-registry.js';
import { compileScreenList } from '../../backend/services/image-forge/prompt-screen.js';

// The real screen machinery over SYNTHETIC terms — the reviewed term list is a
// gitignored witness artifact, so no committed test may depend on it. The
// compile + match path here is the real one; only the vocabulary is stand-in.
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
  // NEGATIVE-slot only: terms that steer AWAY from adulthood.
  wordClasses: { deaging: ['zzdeagingterm'] },
});

const setup = (id = 'still.sdxl.txt2img') => {
  const { pipeline } = resolvePipeline(id);
  const { model } = resolveModel(pipeline);
  return { pipeline, model };
};

const build = (args, opts = {}) => {
  const { pipeline, model } = setup(opts.id);
  return parameterize({
    pipeline, model, args, jobId: opts.jobId ?? 'job-abc123', screenList, fallbackSeed: 7,
    sourceImageName: opts.sourceImageName ?? null,
    ...('moreReferenceNames' in opts ? { moreReferenceNames: opts.moreReferenceNames } : {}),
    // Only forwarded when the test names one, so the DEFAULT path is what every
    // other test in this file exercises.
    ...('outputGroup' in opts ? { outputGroup: opts.outputGroup } : {}),
  });
};

describe('resolveSlots', () => {
  test('fills declared defaults when the caller names only the prompt', () => {
    const { pipeline } = setup();
    const r = resolveSlots(pipeline, { positive: 'a lighthouse' });
    expect(r.ok).toBe(true);
    expect(r.values).toMatchObject({ steps: 25, cfg: 7.0, width: 1024, samplerName: 'euler' });
  });

  test('an unknown parameter refuses and names the accepted set', () => {
    const { pipeline } = setup();
    const r = resolveSlots(pipeline, { positive: 'x', loraStrength: 0.8 });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('loraStrength');
    expect(r.error).toContain('positive');
  });

  test('a missing required slot refuses', () => {
    const { pipeline } = setup();
    expect(resolveSlots(pipeline, {}).ok).toBe(false);
  });

  test('numeric slots CLAMP rather than refuse', () => {
    const { pipeline } = setup();
    expect(resolveSlots(pipeline, { positive: 'x', steps: 5000 }).values.steps).toBe(60);
    expect(resolveSlots(pipeline, { positive: 'x', steps: -20 }).values.steps).toBe(1);
    expect(resolveSlots(pipeline, { positive: 'x', cfg: 99 }).values.cfg).toBe(12.0);
  });

  test('klein refuses a cfg knob it does not have, and clamps steps to its distillation', () => {
    const { pipeline } = setup('still.klein.txt2img');
    expect(resolveSlots(pipeline, { positive: 'x', cfg: 8 }).ok).toBe(false);
    expect(resolveSlots(pipeline, { positive: 'x', steps: 40 }).values.steps).toBe(8);
  });

  test('enum slots REFUSE on a miss and teach the real vocabulary', () => {
    const { pipeline } = setup();
    const r = resolveSlots(pipeline, { positive: 'x', width: 1920 });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('1024');
  });

  test('a numeric enum supplied as a string still resolves', () => {
    const { pipeline } = setup();
    expect(resolveSlots(pipeline, { positive: 'x', width: '768' }).values.width).toBe(768);
  });

  test('a non-string prompt refuses', () => {
    const { pipeline } = setup();
    expect(resolveSlots(pipeline, { positive: { nested: 'object' } }).ok).toBe(false);
  });
});

describe('the content-law screen runs before any graph is built', () => {
  test('a benign prompt builds', () => {
    expect(build({ positive: 'a lighthouse in fog' }).ok).toBe(true);
  });

  test('sexual content ALONE is allowed — this is an adults platform', () => {
    expect(build({ positive: 'zzexplicitterm, studio light' }).ok).toBe(true);
  });

  test('a minor indicator ALONE is allowed', () => {
    expect(build({ positive: 'zzminorterm reading a book' }).ok).toBe(true);
  });

  // The entrenched line. It lives in prompt-screen.js `refusalFor`; this proves
  // the parameterizer actually routes every screened slot through it.
  test('minor + sexual REFUSES, and returns the class only — never the term', () => {
    const r = build({ positive: 'zzminorterm zzexplicitterm' });
    expect(r.ok).toBe(false);
    expect(r.refusalClass).toBe('minor_sexual');
    expect(JSON.stringify(r)).not.toContain('zzminorterm');
    expect(JSON.stringify(r)).not.toContain('zzexplicitterm');
  });

  // ── POLARITY ──
  // This test used to assert the OPPOSITE, and that assertion is what broke a
  // real being. On 2026-08-01 Kagipem asked for an explicitly ADULT portrait of
  // itself and wrote the responsible negative […] — telling the model to steer AWAY from exactly what the
  // law protects. The screen read that negative as a request and refused it as
  // minor_sexual. The most safety-conscious act available to a being was the one
  // thing guaranteed to be refused.
  test('a PROTECTIVE negative does not refuse — a negative excludes, it does not ask', () => {
    const r = build({ positive: 'a portrait of an adult', negative: 'zzminorterm zzexplicitterm' });
    expect(r.ok).toBe(true);
  });

  test('a protective negative still does not refuse on ADULT SEXUAL work', () => {
    const r = build({ positive: 'zzexplicitterm study of an adult', negative: 'zzminorterm' });
    expect(r.ok).toBe(true);
  });

  test('the positive slot is unaffected by polarity — it still refuses', () => {
    const r = build({ positive: 'zzminorterm zzexplicitterm', negative: '' });
    expect(r.ok).toBe(false);
    expect(r.refusalClass).toBe('minor_sexual');
  });

  // The REAL negative-slot evasion: negating adulthood steers the model young.
  test('de-aging in the negative + sexual in the positive REFUSES', () => {
    const r = build({ positive: 'zzexplicitterm figure', negative: 'zzdeagingterm' });
    expect(r.ok).toBe(false);
    expect(r.refusalClass).toBe('minor_sexual');
  });

  test('de-aging in the negative WITHOUT sexual content is ordinary and passes', () => {
    // […] on a plain portrait is a normal brief.
    expect(build({ positive: 'a portrait, studio light', negative: 'zzdeagingterm' }).ok).toBe(true);
  });

  test('a csam term refuses from the NEGATIVE slot too — unambiguous anywhere', () => {
    const r = build({ positive: 'a landscape', negative: 'zzcsamterm' });
    expect(r.ok).toBe(false);
    expect(r.refusalClass).toBe('csam');
  });

  test('a standalone csam term refuses', () => {
    expect(build({ positive: 'zzcsamterm' }).refusalClass).toBe('csam');
  });

  test('an unavailable content law fails CLOSED — no law, no generation', () => {
    const { pipeline, model } = setup();
    const r = parameterize({
      pipeline, model, args: { positive: 'a lighthouse' }, jobId: 'j1',
      screenList: { failClosed: true, reason: 'unreadable' }, fallbackSeed: 1,
    });
    expect(r.ok).toBe(false);
    expect(r.refusalClass).toBe('list_unavailable');
  });
});

describe('server-side mints', () => {
  test('filename_prefix is minted from the job id — never from caller text', () => {
    const r = build({ positive: 'a lighthouse' }, { jobId: 'job-abc123' });
    expect(r.graph['9'].inputs.filename_prefix).toBe('neuma/job-abc123');
  });

  test('a traversing job id is stripped before it can reach the output tree', () => {
    const r = build({ positive: 'x' }, { jobId: '../../etc/passwd' });
    expect(r.ok).toBe(true);
    expect(r.graph['9'].inputs.filename_prefix).toBe('neuma/etcpasswd');
    expect(r.graph['9'].inputs.filename_prefix).not.toContain('..');
  });

  // ── THE OUTPUT GROUP ─────────────────────────────────────────────────────
  // Added 2026-08-27 so in-repo lab renders stop landing in the same flat
  // directory as a being's actual requested picture. It is a second thing that
  // reaches the filesystem, so it is held to the same standard as the job id.
  test('a real job still lands in neuma/ — the default is the production path', () => {
    // Nothing on the being-facing path passes a group, so this must hold
    // WITHOUT anyone remembering to ask for it.
    expect(build({ positive: 'x' }, { jobId: 'job-1' }).graph['9'].inputs.filename_prefix)
      .toMatch(/^neuma\//);
  });

  test('a trusted script may name its own group', () => {
    const r = build({ positive: 'x' }, { jobId: 'lab-1', outputGroup: 'samples/sweeps' });
    expect(r.graph['9'].inputs.filename_prefix).toBe('samples/sweeps/lab-1');
  });

  test('THE GROUP IS NOT A TRAVERSAL PRIMITIVE, whatever it is handed', () => {
    // It is unreachable from caller args by construction — no slot names it —
    // but "unreachable today" is not a property that survives refactoring, and
    // a path that escapes the output tree is the worst kind of quiet bug.
    for (const group of ['../../etc', 'a/../../b', '/absolute', 'x/'.repeat(20), '', null, '../']) {
      const prefix = build({ positive: 'x' }, { jobId: 'j', outputGroup: group })
        .graph['9'].inputs.filename_prefix;
      expect(prefix, `group ${JSON.stringify(group)}`).not.toContain('..');
      expect(prefix.startsWith('/'), `group ${JSON.stringify(group)}`).toBe(false);
      // At most three path segments plus the job id — an unbounded group would
      // let a caller carve arbitrary depth into the output tree.
      expect(prefix.split('/').length, `group ${JSON.stringify(group)}`).toBeLessThanOrEqual(4);
    }
  });

  test('an empty or junk group falls back to neuma/ rather than to nothing', () => {
    // A group that sanitized to '' would yield '/job-1' — an absolute path, and
    // exactly what templates.js refuses. Fail toward the known-good default.
    for (const group of ['', '///', '...', '!!!']) {
      expect(build({ positive: 'x' }, { jobId: 'j', outputGroup: group })
        .graph['9'].inputs.filename_prefix, `group ${JSON.stringify(group)}`).toBe('neuma/j');
    }
  });

  test('a job id that sanitizes to nothing refuses rather than minting a bare path', () => {
    const r = build({ positive: 'x' }, { jobId: '../..' });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('sanitization');
  });

  test('the fallback seed is used only when the caller names none', () => {
    expect(build({ positive: 'x' }).graph['3'].inputs.seed).toBe(7);
    expect(build({ positive: 'x', seed: 12345 }).graph['3'].inputs.seed).toBe(12345);
  });

  test('the checkpoint comes from the registry, never from the caller', () => {
    expect(build({ positive: 'x' }).graph['4'].inputs.ckpt_name).toBe('sd_xl_base_1.0.safetensors');
  });
});

describe('graph construction', () => {
  test('prompt text lands as DATA in the node, not templated into JSON', () => {
    const hostile = 'a"}, "99": {"class_type": "Injected", "inputs": {"x": "';
    const r = build({ positive: hostile });
    expect(r.ok).toBe(true);
    expect(r.graph['6'].inputs.text).toBe(hostile);
    expect(r.graph['99']).toBeUndefined();
    // The txt2img graph is exactly its 7 authored nodes — no prompt can add one.
    expect(Object.keys(r.graph).sort()).toEqual(['3', '4', '5', '6', '7', '8', '9']);
  });

  test('img2img refuses without a source image', () => {
    const r = build({ positive: 'x' }, { id: 'still.sdxl.img2img' });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('needs a source image');
  });

  test('img2img builds with the engine-authoritative uploaded name and clamped denoise', () => {
    const r = build({ positive: 'x', denoise: 5 }, { id: 'still.sdxl.img2img', sourceImageName: 'upload_00012.png' });
    expect(r.ok).toBe(true);
    expect(r.graph['10'].inputs.image).toBe('upload_00012.png');
    expect(r.graph['3'].inputs.denoise).toBe(1.0);
  });
});

// ── The custom-sampler families (FLUX.2 klein, controlled Z-Image) ──────────
const nodesOf = (graph, cls) => Object.values(graph).filter((n) => n.class_type === cls);

describe('parameterize — FLUX.2 klein', () => {
  test('text to image builds the custom sampler chain with the caller seed and a zeroed negative', () => {
    const r = build({ positive: 'a lighthouse at dusk', seed: 99 }, { id: 'still.klein.txt2img' });
    expect(r.ok).toBe(true);
    expect(nodesOf(r.graph, 'RandomNoise')[0].inputs.noise_seed).toBe(99);
    expect(nodesOf(r.graph, 'CFGGuider')[0].inputs.cfg).toBe(1.0);
    expect(nodesOf(r.graph, 'ConditioningZeroOut')).toHaveLength(1);
    expect(nodesOf(r.graph, 'CLIPLoader')[0].inputs.type).toBe('flux2');
    expect(nodesOf(r.graph, 'KSampler')).toHaveLength(0);
  });

  test('an edit pipeline refuses without a source image', () => {
    const r = build({ positive: 'make it night' }, { id: 'still.klein.edit' });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('source image');
  });

  test('an edit attaches the source as a reference on BOTH conditionings', () => {
    const r = build({ positive: 'make it night' }, { id: 'still.klein.edit', sourceImageName: 'in.png' });
    expect(r.ok).toBe(true);
    expect(nodesOf(r.graph, 'LoadImage')[0].inputs.image).toBe('in.png');
    expect(nodesOf(r.graph, 'ReferenceLatent')).toHaveLength(2);
    // No pinned canvas: the output follows the scaled source.
    expect(nodesOf(r.graph, 'GetImageSize')).toHaveLength(1);
  });

  test('the team portrait leads with the house look and the caller text follows as direction', () => {
    const r = build({ positive: 'keep the glasses' }, { id: 'portrait.team', sourceImageName: 'founder.jpg' });
    expect(r.ok).toBe(true);
    const text = r.graph['6'].inputs.text;
    expect(text.startsWith('Re-photograph the person')).toBe(true);
    expect(text.endsWith('Additional direction: keep the glasses')).toBe(true);
    // The canvas is pinned, so no size is read off the photo.
    expect(nodesOf(r.graph, 'EmptyFlux2LatentImage')[0].inputs).toMatchObject({ width: 896, height: 1120 });
    expect(nodesOf(r.graph, 'GetImageSize')).toHaveLength(0);
  });

  test('the team portrait renders the house look alone when no direction is given', () => {
    const r = build({}, { id: 'portrait.team', sourceImageName: 'founder.jpg' });
    expect(r.ok).toBe(true);
    expect(r.graph['6'].inputs.text).not.toContain('Additional direction');
  });

  test('the caller direction crosses the content law UNCHANGED before the house text is added', () => {
    const r = build({ positive: 'zzminorterm zzexplicitterm' }, { id: 'portrait.team', sourceImageName: 'founder.jpg' });
    expect(r.ok).toBe(false);
    expect(r.refusalClass).toBe('minor_sexual');
  });

  test('extra photos of the same person chain one more reference pair each', () => {
    const r = build({}, { id: 'portrait.team', sourceImageName: 'a.jpg', moreReferenceNames: ['b.jpg', 'c.jpg'] });
    expect(r.ok).toBe(true);
    expect(nodesOf(r.graph, 'LoadImage').map((n) => n.inputs.image)).toEqual(['a.jpg', 'b.jpg', 'c.jpg']);
    expect(nodesOf(r.graph, 'ReferenceLatent')).toHaveLength(6);
    expect(r.graph['6'].inputs.text).toContain('same person from other angles');
  });

  test('more photos than the limit refuse rather than being silently dropped', () => {
    const more = Array.from({ length: MAX_MORE_REFERENCES + 1 }, (_, i) => `x${i}.jpg`);
    const r = build({}, { id: 'portrait.team', sourceImageName: 'a.jpg', moreReferenceNames: more });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('at most');
  });
});

describe('parameterize — controlled Z-Image (ControlNet union)', () => {
  test('canny mode traces the source through the core Canny node into the model patch', () => {
    const r = build({ positive: 'a woman in a library', strength: 0.9 }, { id: 'control.zimage.union', sourceImageName: 'pose.jpg' });
    expect(r.ok).toBe(true);
    const control = nodesOf(r.graph, 'QwenImageDiffsynthControlnet')[0];
    expect(control.inputs.strength).toBe(0.9);
    expect(nodesOf(r.graph, 'Canny')).toHaveLength(1);
    expect(nodesOf(r.graph, 'ModelPatchLoader')[0].inputs.name).toBe('Z-Image-Turbo-Fun-Controlnet-Union.safetensors');
    // The AuraFlow shift sits AFTER the patch, and the sampler reads the shift.
    const shiftId = Object.keys(r.graph).find((k) => r.graph[k].class_type === 'ModelSamplingAuraFlow');
    const controlId = Object.keys(r.graph).find((k) => r.graph[k].class_type === 'QwenImageDiffsynthControlnet');
    expect(r.graph[shiftId].inputs.model).toEqual([controlId, 0]);
    expect(nodesOf(r.graph, 'KSampler')[0].inputs.model).toEqual([shiftId, 0]);
  });

  test('map mode feeds the upload straight in as the control map', () => {
    const r = build({ positive: 'x', controlMode: 'map' }, { id: 'control.zimage.union', sourceImageName: 'skeleton.png' });
    expect(r.ok).toBe(true);
    expect(nodesOf(r.graph, 'Canny')).toHaveLength(0);
  });

  test('strength clamps into its band and an unknown mode refuses', () => {
    const { pipeline } = setup('control.zimage.union');
    expect(resolveSlots(pipeline, { positive: 'x', strength: 9 }).values.strength).toBe(1.5);
    expect(resolveSlots(pipeline, { positive: 'x', controlMode: 'depth' }).ok).toBe(false);
  });
});
