/**
 * The content law's BOUNDED reading (2026-10-23) — a model licence is judged on
 * words, never across the space between two ordinary words, and says what it
 * read; the platform's own law keeps its full reach. The real screen, the real
 * parameterizer and the real refusal words, called with real inputs. No mocks
 * (RULE 0). The list is synthetic beyond the one short word the incident turned
 * on, which the forge's other suites already use.
 */
import { describe, test, expect } from 'vitest';
import { compileScreenList, screenSlots } from '../../backend/services/image-forge/prompt-screen.js';
import { resolvePipeline, resolveModel } from '../../backend/services/image-forge/pack-registry.js';
import { parameterize } from '../../backend/services/image-forge/parameterizer.js';
import { refusalMessage } from '../../backend/services/image-forge/image-being-tools.js';

const LAW = compileScreenList({
  classes: {
    csam: ['zzcsam'], age_minor: ['zzminor'], sexual_explicit: ['sex', 'zzexplicit act'], sexual_suggestive: [],
    incest: [], bestiality: [], nonconsent: [],
  },
});
const LICENCE = { licenceRefuses: ['sexual_explicit'] };
const licence = (text) => screenSlots([{ text }], LAW, LICENCE);

// The two prompts the marketing being wrote, verbatim.
const DARK_WATER = [
  'Slow cinematic camera push-in toward the ripples on the dark water surface. The warm amber beam from above shimmers gently, refracting through the water. Ripples expand slowly and calmly outward. Subtle particles drift in the light beam. The sound of quiet water, a soft low ambient hum, deep and calm.',
  'Cinematic slow camera push-in over a dark lake at night. A column of warm light falls onto the water from above. Concentric ripples expand slowly and evenly across the surface. Faint dust motes drift through the light column. Quiet, calm, meditative mood. Audio: soft water sounds and a low ambient drone.',
];

describe('the incident: dark water on LTX', () => {
  const ltx = resolvePipeline('video.ltx.i2v').pipeline;
  const make = (positive) => parameterize({
    pipeline: ltx, model: resolveModel(ltx).model, args: { positive }, jobId: '7b0c6d1e-5b6a-4a71-9d6f-2a0d4e9c1f00',
    screenList: LAW, fallbackSeed: 1, sourceImageName: 'job.png', sourceLineage: 'a still of dark water at night',
  });

  test('both prompts pass the LTX screen', () => {
    for (const p of DARK_WATER) expect(make(p).ok).toBe(true);
  });

  test('a real licence refusal still lands, and carries what it read and where', () => {
    const built = make('two adults having sex');
    expect(built).toMatchObject({ ok: false, refusalClass: 'licence:sexual_explicit', refusalMatch: { term: 'sex', where: 'sex', slot: 'positive' } });
  });

  test('a source image\'s words are named as the source when they are what tripped it', () => {
    const built = parameterize({
      pipeline: ltx, model: resolveModel(ltx).model, args: { positive: 'she turns her head' }, jobId: '7b0c6d1e-5b6a-4a71-9d6f-2a0d4e9c1f00',
      screenList: LAW, fallbackSeed: 1, sourceImageName: 'job.png', sourceLineage: 'two adults having sex',
    });
    expect(built.refusalMatch).toEqual({ term: 'sex', where: 'sex', slot: 'source' });
  });
});

describe('ordinary words never meet a listed word across the space between them', () => {
  test.each([
    'ripples expand', 'the kelp sways as waves expand', 'his expression softens', "it's expensive", 'it’s exquisite',
    'the bus exits the tunnel', 'glass extends to the horizon', 'this is expected', 'plus extra light', "she's ex-military",
    'his ex-wife smiles', 'U.S. expansion', 'mass exodus', 'grass exhales dew', 'lens exposure at dusk',
  ])('%s', (text) => {
    expect(licence(text)).toEqual({ ok: true, classes: [] });
  });

  test('a phrase term still matches across its OWN word break, with plural or glued edges', () => {
    for (const text of ['a zzexplicit act', 'zzexplicit acts on screen', 'the zzexplicit-act', 'zzexplicitact'])
      expect(licence(text).classes).toEqual(['licence:sexual_explicit']);
  });
});

describe('evasion is still read', () => {
  test.each([
    ['sex', 'sex'], ['s e x', 's e x'], ['s.e.x', 's e x'], ['s-e-x', 's e x'], ['S E X', 's e x'], ['s3x', 'sex'],
    ['s e x y', 's e x'], ['se x', 'se x'], ['s ex', 's ex'], ['sexy', 'sexy'],
    ['sextape', 'sextape'], ['hardsex', 'hardsex'], [`${String.fromCharCode(0x0455)}ex`, 'sex'],
    [`s${String.fromCharCode(0x200B)}ex`, 'sex'], ['z z e x p l i c i t act', 'z z e x p l i c i t act'],
  ])('%s', (text, where) => {
    const r = licence(`two adults, ${text}`);
    expect(r.classes).toEqual(['licence:sexual_explicit']);
    // Shown as the screen reads it (lowercased, letters folded) — never as a guess.
    expect(r.match.where).toBe(where);
  });
});

describe('the platform\'s own law keeps its full reach (entrenched — never narrowed)', () => {
  test('a minor indicator with a sexual word read ACROSS two ordinary words still refuses — the safe side, on purpose', () => {
    expect(screenSlots([{ text: 'a zzminor watches the ripples expand' }], LAW, LICENCE).classes).toEqual(['minor_sexual']);
  });

  test('glued-and-split evasions the bounded reading would miss are refused by the law', () => {
    // The bounded reading cannot tell these from ordinary words run together; the law does not try to.
    expect(licence('two adults, s e xy')).toEqual({ ok: true, classes: [] });
    expect(screenSlots([{ text: 'a zzminor, s e xy' }], LAW).classes).toEqual(['minor_sexual']);
    expect(screenSlots([{ text: 'zzminorse x' }], LAW).classes).toEqual(['minor_sexual']);
    expect(screenSlots([{ text: 'zz cs am' }], LAW).classes).toEqual(['csam']);
    expect(screenSlots([{ text: 'zzcs amazing' }], LAW).classes).toEqual(['csam']);
  });

  test('an unrecorded source keeps the full reach too', () => {
    expect(screenSlots([{ text: 'ripples expand' }], LAW, { unrecordedSource: true }).classes).toEqual(['source_unrecorded']);
  });

  test('a refusal of the platform\'s law carries no match — the term is never echoed', () => {
    const r = screenSlots([{ text: 'a zzminor, sex' }], LAW, LICENCE);
    expect(r).toEqual({ ok: false, classes: ['minor_sexual'] });
  });
});

describe('the refusal words', () => {
  test('a licence refusal quotes the word, the words it sat in, and the slot', () => {
    const text = refusalMessage('licence:sexual_explicit', { term: 'sex', where: 'ripples expand', slot: 'positive' });
    expect(text).toContain('"sex" in "ripples expand" (your prompt)');
    expect(text).toContain('reword that part');
    expect(refusalMessage('licence:sexual_explicit', { term: 'sex', where: 'sex', slot: 'source' })).toContain('(the words that made the source image)');
  });

  test('without a match the licence refusal keeps its old words', () => {
    expect(refusalMessage('licence:sexual_explicit')).toMatch(/Do not rephrase and retry here\.$/);
  });

  test('the platform\'s law and the source guard name no word, whatever they are handed', () => {
    for (const cls of ['csam', 'minor_sexual', 'bestiality', 'nonconsent_sexual', 'incest_sexual', 'source_unrecorded']) {
      expect(refusalMessage(cls, { term: 'zzminor', where: 'zzminor', slot: 'positive' })).not.toContain('zzminor');
    }
  });
});
