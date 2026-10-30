/**
 * THE GAP WORKSHEETS as pure law, called with real worksheets (RULE 0): the
 * kit's one gap passes every stage when each builds on the last; each law —
 * every figure sourced (SHINKEI), each stage fitted to the round's earlier
 * work, value innovation in the ERRC grid, real responses for PROVE — refuses
 * in words a being can act on.
 */
import { describe, test, expect } from 'vitest';
import { checkWorksheet, takesWorksheet, WORKSHEET_MAX_BYTES } from '../../backend/services/company-line/worksheets.js';
import { SHEETS, GAP } from '../helpers/company-line-kit.js';

const CONTEXT = Object.freeze({ survey: SHEETS.survey, measure: SHEETS.measure, shape: SHEETS.shape, choose: SHEETS.choose });
const problems = (stage, w, ctx = CONTEXT) => {
  const r = checkWorksheet(stage, w, ctx);
  return r.ok ? [] : r.problems;
};

describe('the round\'s worksheets', () => {
  test('one gap carried from SURVEY to PROVE passes every stage; CHARTER and FORM take none', () => {
    for (const stage of ['survey', 'measure', 'shape', 'choose', 'prove']) expect(problems(stage, SHEETS[stage]), stage).toEqual([]);
    expect(takesWorksheet('charter')).toBe(false);
    expect(checkWorksheet('form', undefined, {})).toEqual({ ok: true });
  });

  test('a worksheet that is not an object, or too large, is refused before any law is read', () => {
    expect(problems('survey', null)).toEqual(['worksheet: this stage hands on a worksheet object']);
    expect(problems('survey', [])).toEqual(['worksheet: this stage hands on a worksheet object']);
    expect(problems('survey', { candidates: [], pad: 'x'.repeat(WORKSHEET_MAX_BYTES) })[0]).toMatch(/at most 64 KB/);
  });
});

describe('SHINKEI — every figure names its source', () => {
  test('a canvas level without a source, out of range, or missing for a player is named exactly', () => {
    const [cv] = SHEETS.measure.canvases;
    const broken = { canvases: [{ ...cv, factors: [
      { name: 'Price', levels: [{ player: 'National almanac', level: 6, source: 'it is obvious' }, { player: 'Us', level: 11, source: 'repos/tidewater/pricing.md' }] },
      { name: 'Local accuracy', levels: [{ player: 'Us', level: 9, source: 'repos/tidewater/model-check.md' }] },
      cv.factors[2],
    ] }] };
    expect(problems('measure', broken)).toEqual([
      'canvases[0].factors[0].National almanac.source: a source is an https link, a repos/ path on the house ground, or first-hand evidence like "interview: who, when"',
      'canvases[0].factors[0].Us.level: a whole number from 0 to 10',
      'canvases[0].factors[1]: exactly one level for "National almanac"',
    ]);
  });

  test('http, a bare word, or a too-short evidence line is no source', () => {
    const at = (source) => problems('survey', { candidates: [{ ...SHEETS.survey.candidates[0], evidence: [{ claim: 'Harbour masters copy tables', source }] }] });
    expect(at('http://example.org/x')).toHaveLength(1);
    expect(at('trust me')).toHaveLength(1);
    expect(at('interview: x')).toHaveLength(1);
    expect(at('interview: harbour master, 2026-10-20')).toEqual([]);
    expect(at('repos/tidewater/notes.md')).toEqual([]);
  });
});

describe('fitted to this blade — each stage builds on the round', () => {
  test('MEASURE, SHAPE, CHOOSE and PROVE must name the gap the stage before handed on', () => {
    expect(problems('measure', SHEETS.measure, {})).toEqual(['canvases[0].candidate: a candidate SURVEY handed on (none yet)']);
    expect(problems('shape', { ...SHEETS.shape, candidate: 'Berth booking for moorings' })[0]).toBe(`candidate: a candidate MEASURE drew (${GAP.toLowerCase()})`);
    expect(problems('choose', { ...SHEETS.choose, candidate: 'Berth booking for moorings' })).toEqual([`candidate: the gap SHAPE shaped (${GAP})`]);
    expect(problems('prove', { ...SHEETS.prove, candidate: 'x' })).toEqual([`candidate: the gap CHOOSE chose (${GAP})`]);
  });
});

describe('the Blue Ocean laws of each stage', () => {
  test('SURVEY: a path from the six, a known noncustomer tier, names unique', () => {
    const [a] = SHEETS.survey.candidates;
    expect(problems('survey', { candidates: [{ ...a, path: 'vibes', noncustomers: 'all' }, a] })).toEqual([
      'candidates: each candidate has its own name',
      'candidates[0].path: which of the six paths found it: industries, groups, buyers, complements, appeal, time',
      'candidates[0].noncustomers: one of soon, refusing, unexplored, or leave it out',
    ]);
  });

  test('SHAPE: value innovation — something created, something eliminated or reduced; a real price band', () => {
    const flat = { ...SHEETS.shape, errc: { eliminate: [], reduce: [], raise: ['speed'], create: [] }, priceBand: { low: 10, high: 5, currency: 'dollars', basis: 'x' } };
    expect(problems('shape', flat)).toEqual([
      'errc.create: create at least one thing the field has never offered',
      'errc: eliminate or reduce at least one thing — value innovation cuts cost as it adds value',
      'priceBand: {low, high} numbers, high at least low',
      'priceBand.currency: a three-letter currency (USD, ETH, …)',
      'priceBand.basis: what the band is set against (the price corridor of the mass)',
    ]);
  });

  test('PROVE: three real responses at least, each sourced and dated, and stand-ins declared', () => {
    const thin = { ...SHEETS.prove, results: [SHEETS.prove.results[0]], standIns: 'maybe' };
    expect(problems('prove', thin)).toEqual([
      'results: at least three real responses from buyers',
      'standIns: true when any response is a named stand-in (a simulated economy), false when every one is real',
    ]);
  });
});
