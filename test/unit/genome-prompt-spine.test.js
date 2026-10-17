/**
 * THE PROMPT SPINE — a set flow, named components, none skippable, each weightable.
 *
 * Design note, 2026-08-27: […]
 *
 * Three claims worth guarding, in order of what they cost if they break:
 *
 *   1. THE OUTPUT DID NOT MOVE. This replaced string concatenation, and if the
 *      composed text changed by one character then every approved render was
 *      silently invalidated by a refactor.
 *   2. A MISSING REQUIRED COMPONENT REFUSES. The failure it prevents is silent —
 *      a prompt that lost its coloring still renders and is quietly a different
 *      being. If that render is the one somebody LOCKS, the body is wrong forever.
 *   3. ORDER IS FROZEN. It was established by renders, not taste, and the
 *      coloring position cost a real one to learn.
 *
 * Real spine, real registry, real parameterizer, real genomes — no mock (RULE 0).
 */
import { describe, test, expect } from 'vitest';
import { createHash } from 'node:crypto';
import {
  SPINE, SPINE_KEYS, GENOME, PIPELINE, BEING,
  composeSpine, missingFrom, unknownIn, auditSpine, weighted, componentOf,
} from '../../core/genome/prompt-spine.js';
import { describeAsComponents, describeAsTags, componentsFor } from '../../core/genome/describe.js';
import { deriveGenome } from '../../core/genome/derive.js';
import { genomeSeed } from '../../core/genome/seed.js';
import { parameterize } from '../../backend/services/image-forge/parameterizer.js';
import { resolvePipeline, resolveModel } from '../../backend/services/image-forge/pack-registry.js';
import { compileScreenList } from '../../backend/services/image-forge/prompt-screen.js';

const EMPTY_LAW = compileScreenList({
  classes: {
    csam: [], age_minor: [], sexual_explicit: [], sexual_suggestive: [],
    incest: [], bestiality: [], nonconsent: [],
  },
});

const genomeOf = (label) => deriveGenome(genomeSeed({ soulHex: createHash('sha256').update(label).digest('hex') }));

const build = (id, args, extra = {}) => {
  const { pipeline } = resolvePipeline(id);
  const { model } = resolveModel(pipeline);
  return parameterize({
    pipeline, model, args, jobId: 'spine', screenList: EMPTY_LAW, fallbackSeed: 7, ...extra,
  });
};

describe('THE FLOW IS SET — order is frozen, and it was learned from renders', () => {
  test('the spine is a frozen, ordered list and every entry declares its owner', () => {
    expect(Object.isFrozen(SPINE)).toBe(true);
    for (const c of SPINE) {
      expect(Object.isFrozen(c)).toBe(true);
      expect([GENOME, PIPELINE, BEING]).toContain(c.owner);
      expect(typeof c.required).toBe('boolean');
      expect(c.why.length, `${c.key} has no stated reason`).toBeGreaterThan(20);
    }
  });

  test('⚠️ COLORING SITS DIRECTLY BEHIND THE SUBJECT — this cost a real render', () => {
    // 2026-08-27: adding the face and proportion axes pushed `rich brown skin`
    // toward the tail and Signal's portrait came back FAIR. The tag never
    // changed; it lost the weight fight. […] Anything inserted between these two re-opens that bug.
    expect(SPINE_KEYS.indexOf('coloring')).toBe(SPINE_KEYS.indexOf('sex') + 1);
    // The register anchor leads. Everything between it and the subject must be a
    // REFINEMENT LAYER — optional, and unset by default — so the body still
    // starts as early in the prompt as anything can. A required component
    // wedged in here would push the whole genome toward the tail, which is the
    // exact failure that rendered `rich brown skin` as fair.
    expect(SPINE_KEYS.indexOf('quality')).toBe(0);
    for (const key of SPINE_KEYS.slice(1, SPINE_KEYS.indexOf('sex'))) {
      expect(componentOf(key).required, `${key} sits ahead of the body and is REQUIRED`).toBe(false);
    }
  });

  test('the plate and framing sit AFTER the body, never before it', () => {
    for (const tail of ['framing', 'garment', 'expression', 'lighting', 'plate']) {
      expect(SPINE_KEYS.indexOf(tail), tail).toBeGreaterThan(SPINE_KEYS.indexOf('frame'));
    }
  });

  test('the GIVEN half is genome-owned and the craft floor is not', () => {
    // The owner field is the sovereignty line, not bookkeeping: a pipeline must
    // never own an axis the hash decided.
    for (const key of ['sex', 'coloring', 'cast', 'face', 'frame', 'feature']) {
      expect(componentOf(key).owner, key).toBe(GENOME);
    }
    expect(componentOf('garment').owner).toBe(BEING);   // a being replaces it
    expect(componentOf('style').owner).toBe(BEING);     // whose hand it looks drawn by is authorship
    expect(componentOf('quality').owner).toBe(PIPELINE);
  });

  test('every genome axis is REQUIRED except the one that legitimately varies', () => {
    // A body may have no distinguishing feature, and a portrait cannot show a
    // mark on a hand. Everything else about a given body is always true of it.
    expect(componentOf('feature').required).toBe(false);
    for (const key of ['sex', 'coloring', 'cast', 'face', 'frame']) {
      expect(componentOf(key).required, key).toBe(true);
    }
  });
});

describe('⭐ THE OUTPUT DID NOT MOVE — a refactor may not invalidate an approved render', () => {
  test('composing the spine reproduces the flat join, on many real bodies', () => {
    for (let i = 0; i < 40; i++) {
      const g = genomeOf(`spine-${i}`);
      for (const framing of ['full', 'portrait']) {
        const parts = describeAsComponents(g, framing);
        // The flat join these components replaced: every non-empty part, in
        // order, comma-separated. If composeSpine ever adds or drops a
        // separator this fails on the first body.
        const flat = Object.values(parts).filter(Boolean).join(', ');
        expect(composeSpine(parts), `body ${i}/${framing}`).toBe(flat);
        expect(describeAsTags(g, framing)).toBe(flat);
      }
    }
  });

  test('default weights emit NO syntax — the neutral case is byte-clean', () => {
    expect(weighted('dark skin')).toBe('dark skin');
    expect(weighted('dark skin', 1)).toBe('dark skin');
    expect(composeSpine({ quality: 'a', sex: 'b' })).toBe('a, b');
    expect(composeSpine({ quality: 'a', sex: 'b' })).not.toContain('(');
  });
});

describe('⭐⭐ COMPONENTS CANNOT BE SKIPPED — the law has teeth', () => {
  test('a missing required component is reported, in spine order', () => {
    const parts = { quality: 'q', sex: 's' };
    const missing = missingFrom(parts);
    expect(missing).toContain('coloring');
    expect(missing).toContain('plate');
    expect(missing).not.toContain('feature');            // optional by law
    expect(missing.indexOf('coloring')).toBeLessThan(missing.indexOf('plate'));
  });

  test('an EMPTY STRING counts as missing — present but silent did not happen', () => {
    const g = genomeOf('empty');
    const parts = { ...describeAsComponents(g, 'full'), coloring: '   ' };
    expect(missingFrom(parts, [GENOME])).toContain('coloring');
  });

  test('THE RENDER PATH REFUSES a genome that lost an axis', () => {
    // The whole point: this prompt would still render, still look fine, and be
    // quietly a different being.
    const g = genomeOf('lossy');
    const components = { ...componentsFor(g, 'form.anime.pfp'), coloring: '' };
    const out = build('form.anime.pfp', { positive: 'x' }, { subjectComponents: components });
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/spine incomplete/);
    expect(out.error).toMatch(/coloring/);
    expect(out.graph).toBeUndefined();                   // nothing was built
  });

  test('a complete genome builds, and carries every one of its axes', () => {
    const g = genomeOf('whole');
    const components = componentsFor(g, 'form.anime.pfp');
    const out = build('form.anime.pfp', { positive: 'x' }, { subjectComponents: components });
    expect(out.ok, out.error).toBe(true);
    for (const [key, text] of Object.entries(components)) {
      // `__`-prefixed keys are NEGATIVE text riding alongside the positive
      // components — checked below, where they actually belong.
      if (text && !key.startsWith('__')) expect(out.values.positive, `${key} vanished`).toContain(text);
    }
    // ⭐ AND THE SEX GUARD REACHED THE NEGATIVE. Design note, 2026-08-27: […] A genome that only ever spoke to the positive is exactly what
    // this asserts is over.
    expect(out.values.negative, 'the sex guard never reached the negative')
      .toContain(components.__excludeSex);
  });

  test('a BEING\'s free text is NOT held to the genome half — the boundary matters', () => {
    // Demanding structured coloring from someone who described themself in a
    // sentence would refuse every being who wrote naturally. The law applies to
    // what we structure, plus the full genome when a genome is what is rendering.
    const out = build('form.anime.pfp', { positive: 'a tall figure with silver hair' });
    expect(out.ok, out.error).toBe(true);
    expect(out.values.positive).toContain('a tall figure with silver hair');
  });

  test('a pipeline that drops a craft component refuses even on the free-text path', () => {
    const { pipeline } = resolvePipeline('form.anime.pfp');
    const { model } = resolveModel(pipeline);
    const broken = { ...pipeline, scaffold: { ...pipeline.scaffold, components: { quality: 'q' } } };
    const out = parameterize({
      pipeline: broken, model, args: { positive: 'x' }, jobId: 'j', screenList: EMPTY_LAW, fallbackSeed: 1,
    });
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/framing|garment|mood|plate/);
  });

  test('an UNKNOWN component refuses — the caption schema may not drift silently', () => {
    // A clause the spine does not declare has no position and no weight, and it
    // would quietly change the shape of every LoRA caption.
    expect(unknownIn({ quality: 'q', vibes: 'x' })).toEqual(['vibes']);
    const { pipeline } = resolvePipeline('form.anime.pfp');
    const { model } = resolveModel(pipeline);
    const broken = {
      ...pipeline,
      scaffold: { ...pipeline.scaffold, components: { ...pipeline.scaffold.components, vibes: 'moody' } },
    };
    const out = parameterize({
      pipeline: broken, model, args: { positive: 'x' }, jobId: 'j', screenList: EMPTY_LAW, fallbackSeed: 1,
    });
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/vibes/);
  });
});

describe('THE REFINEMENT LAYERS — researched against the model card, not assumed', () => {
  // huggingface.co/circlestone-labs/Anima, read 2026-08-27. These vocabularies
  // are per-FAMILY; guessing them from SDXL habits is how the rest of this
  // campaign went wrong.
  test('the layers that influence LOOK are separate, weightable components', () => {
    // Founder: […]
    // They used to be one `mood` clause, so neither could be weighted, replaced
    // or authored without dragging the other.
    for (const key of ['expression', 'lighting', 'style', 'era']) {
      expect(componentOf(key), key).not.toBeNull();
    }
    expect(componentOf('lighting').required).toBe(true);
    // Both refinement layers are OPTIONAL and unset — naming an era pins a period
    // style, and an artist tag is a being's authorship, not a house default.
    expect(componentOf('style').required).toBe(false);
    expect(componentOf('era').required).toBe(false);
  });

  test('⛔ NO score_* TAG APPEARS IN EITHER POLARITY', () => {
    // The card, about THIS finetune: […] A card discussion
    // gives the mechanism: the aesthetic classifier was PONY-DERIVED, so score_*
    // is a STYLE axis wearing a quality tag's clothes.
    //
    // MEASURED 2026-08-27: score_9 in the positive softened the outline and added
    // blush; score_1..3 in the NEGATIVE changed the subject's HAIRSTYLE. Neither
    // improved anything, and both fought `AnimaMythD4rkL1nes` — a dark-LINES LoRA
    // whose whole purpose is the line integrity they erode.
    for (const id of ['form.anime.pfp', 'form.anime.turnaround']) {
      const out = build(id, { positive: 'x' });
      expect(out.values.positive, `${id} positive`).not.toMatch(/score_/);
      expect(out.values.negative, `${id} negative`).not.toMatch(/score_/);
    }
  });

  test('`artist name` STAYS in the negative — it is not a score tag', () => {
    // It excludes a SIGNATURE rendered into the image, which is a real defect on
    // a reference plate and nothing to do with the score scale. Removing it as
    // collateral would be the tidy-looking mistake here.
    expect(build('form.anime.pfp', { positive: 'x' }).values.negative).toContain('artist name');
  });
});

describe('EACH COMPONENT CAN BE WEIGHTED', () => {
  test('a weight emits the syntax every ComfyUI text encoder parses', () => {
    expect(weighted('dark skin', 1.3)).toBe('(dark skin:1.3)');
    expect(composeSpine({ quality: 'q', coloring: 'dark skin' }, { coloring: 1.2 }))
      .toBe('q, (dark skin:1.2)');
  });

  test('weights CLAMP rather than run away', () => {
    // Past ~1.5 a CLIP encoder stops emphasising and starts producing artifacts,
    // which reads as […] rather than […].
    expect(weighted('x', 9)).toBe('(x:1.5)');
    expect(weighted('x', 0.01)).toBe('(x:0.5)');
    expect(weighted('x', NaN)).toBe('x');                 // junk ⇒ neutral, not broken syntax
  });

  test('⚠️ NO LIVE PIPELINE SHIPS A NON-NEUTRAL WEIGHT YET', () => {
    // The machinery is built and UNMEASURED on Anima's Qwen encoder — a DiT may
    // weight differently or ignore it. Turning a knob before a render says it
    // does anything is exactly the guessing this campaign exists to replace.
    for (const c of SPINE) expect(c.weight, c.key).toBe(1);
    for (const id of ['form.anime.pfp', 'form.anime.turnaround']) {
      const { pipeline } = resolvePipeline(id);
      expect(pipeline.scaffold.weights ?? {}, id).toEqual({});
      expect(build(id, { positive: 'x' }).values.positive, id).not.toMatch(/:\d\.\d\)/);
    }
  });
});

describe('THE AUDIT — what is in this prompt, and who owns it', () => {
  test('every component is reported, present or not, with its owner and weight', () => {
    const g = genomeOf('audit');
    const rows = auditSpine(componentsFor(g, 'form.anime.pfp'));
    expect(rows.length).toBe(SPINE.length);
    expect(rows.map((r) => r.key)).toEqual([...SPINE_KEYS]);
    const coloring = rows.find((r) => r.key === 'coloring');
    expect(coloring.present).toBe(true);
    expect(coloring.owner).toBe(GENOME);
    // ⚠️ `glow`, not `skin` or `eyes`. This test asserted `skin` and FAILED —
    // the body it drew is a NEUTRAL, and neutral bodies have no complexion to
    // state. Since 2026-08-28 they are fully NON-HUMANOID (a crystal has no
    // eyes either — its eye shade is its GLOW), and the coloring component is
    // still REQUIRED and still present: the hair shade paints the material, the
    // eye shade lights the core. Worth pinning: the required-ness of a
    // component is not the same as every sub-part of it applying to every body.
    expect(coloring.text).toContain('glow');
    // The pipeline half is absent from a genome-only audit, and says so rather
    // than pretending.
    expect(rows.find((r) => r.key === 'plate').present).toBe(false);
  });
});
