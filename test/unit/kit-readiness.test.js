/**
 * THE BRAND KIT GATE — nothing goes out under a brand nobody has defined.
 *
 * Design note, 2026-08-30: […]
 *
 * He chose the strict floor — the FULL kit — and refusal rather than warning.
 * These tests hold that floor honest in both directions: a kit missing anything
 * is refused, AND a complete kit actually opens. A gate nobody can satisfy is
 * not strict, it is broken.
 */
import { describe, expect, test } from 'vitest';
import { KIT_SECTIONS, kitReadiness, readinessReport } from '../../backend/services/branding/kit-readiness.js';

/** A kit with every section genuinely filled — the shape that must pass. */
const COMPLETE = {
  brand: 'northwind', name: 'Northwind Capital', owner: 'metidar',
  // ⚠️ `handle` joined the gate on 2026-08-31, with `marks.mask` below. Four of
  // the six templates sign the footer with it and five compose around the mask,
  // and neither was ever asked for — so a kit could read READY and still refuse
  // every card it was ready for. Found by scanning the templates for what they
  // actually draw rather than trusting the required-list.
  handle: '@northwind',
  colors: { bg: '#0b0b0c', ink: '#fafafa', accent: '#ff6b00', rise: '#00ff88', halo: '#ff9d3c' },
  type: {
    display: "'Rajdhani'", voice: 'Inter', data: "'JetBrains Mono'",
    numeral: "'JetBrains Mono'",
    displayWeight: '700', displayTrack: '0',
    voiceWeight: '400',
    numeralWeight: '300', numeralTrack: '-0.02em',
    labelWeight: '400', labelTrack: '0.2em',
  },
  marks: { wordmark: { file: 'wordmark.svg' }, mask: { file: 'mask.svg' } },
  positioning: 'Liquidity infrastructure for teams who do not want to run a desk.',
  audience: 'Protocol treasuries and market-making desks on Base.',
  pillars: ['capital efficiency', 'no unwind', 'transparent fees'],
  tagline: 'Liquidity that keeps working.',
  boilerplate: 'Northwind Capital builds liquidity infrastructure on Base.',
  voice: 'Plain, exact, unhurried. Never hype.',
  tone: 'Level on launches; brief and factual on incidents.',
  bannedPatterns: ['guaranteed returns', 'to the moon', 'risk-free'],
  claims: {
    approved: ['non-custodial', 'audited by Trail of Bits, March 2026'],
    forbidden: ['any projected APY', 'any claim of principal protection'],
  },
  disclosures: ['Not financial advice.'],
  logoRules: { clearSpace: 'one cap-height on all sides', minWidthPx: 96, misuse: ['never stretch', 'never recolour', 'never outline'] },
  imagery: { direction: 'Instrument photography, hard light, no people.', avoid: ['stock handshakes', 'rocket ships'] },
  accessibility: { contrastMin: 4.5, altTextRequired: true },
  channels: { x: { handle: '@northwind' } },
  competitors: { neverName: [] },
};

const without = (path) => {
  const copy = structuredClone(COMPLETE);
  const parts = path.split('.');
  const last = parts.pop();
  const parent = parts.reduce((o, k) => o[k], copy);
  delete parent[last];
  return copy;
};

describe('a complete kit opens the gate', () => {
  test('the fixture passes — a gate nobody can satisfy is broken, not strict', () => {
    const r = kitReadiness(COMPLETE);
    expect(r.missing, JSON.stringify(r.missing, null, 2)).toEqual([]);
    expect(r.ready).toBe(true);
    expect(r.sections.every((s) => s.ready)).toBe(true);
  });

  test('every declared field is genuinely reachable in the fixture', () => {
    // Guards the reverse mistake: a section spec naming a path the shape does
    // not have would make the gate permanently unsatisfiable, and only this
    // catches it.
    const paths = KIT_SECTIONS.flatMap((s) => s.fields.map((f) => f.path));
    expect(paths.length).toBeGreaterThan(15);
    expect(new Set(paths).size).toBe(paths.length); // no field asked for twice
  });
});

describe('EVERY required field actually blocks', () => {
  // The whole floor, one test per field, generated from the spec itself — so a
  // field added to KIT_SECTIONS tomorrow is covered the day it lands rather
  // than the day somebody remembers.
  const every = KIT_SECTIONS.flatMap((s) => s.fields.map((f) => [s.label, f.path]));
  test.each(every)('%s · %s missing → not ready', (_label, path) => {
    const r = kitReadiness(without(path));
    expect(r.ready).toBe(false);
    expect(r.missing.map((m) => m.path)).toContain(path);
  });
});

describe('DECLARED is not the same as NON-EMPTY', () => {
  test('an empty disclosures list PASSES — no disclosures is a real answer', () => {
    // Demanding a non-empty list here would only teach people to type one word
    // to get past the gate, turning a safety check into a formality.
    const r = kitReadiness({ ...COMPLETE, disclosures: [] });
    expect(r.ready).toBe(true);
  });

  test('an empty competitors list passes for the same reason', () => {
    expect(kitReadiness({ ...COMPLETE, competitors: { neverName: [] } }).ready).toBe(true);
  });

  test('but an empty CLAIMS list is refused — emptiness there is not an answer', () => {
    // A brand that approves nothing cannot be spoken for, and a brand that
    // forbids nothing has not thought about the question.
    expect(kitReadiness({ ...COMPLETE, claims: { approved: [], forbidden: ['x'] } }).ready).toBe(false);
    expect(kitReadiness({ ...COMPLETE, claims: { approved: ['x'], forbidden: [] } }).ready).toBe(false);
  });

  test('an empty pillars or bannedPatterns list is refused too', () => {
    expect(kitReadiness({ ...COMPLETE, pillars: [] }).ready).toBe(false);
    expect(kitReadiness({ ...COMPLETE, bannedPatterns: [] }).ready).toBe(false);
  });

  test('whitespace is not text', () => {
    expect(kitReadiness({ ...COMPLETE, positioning: '   ' }).ready).toBe(false);
  });

  test('altTextRequired: FALSE is a decision and passes; absent does not', () => {
    // The operator may genuinely decide alt text is not required. What is not
    // acceptable is nobody having decided.
    expect(kitReadiness({ ...COMPLETE, accessibility: { contrastMin: 4.5, altTextRequired: false } }).ready).toBe(true);
    expect(kitReadiness(without('accessibility.altTextRequired')).ready).toBe(false);
  });
});

describe('the refusal can be acted on without reading a schema', () => {
  test('it names the section, the field, and what the field is FOR', () => {
    const report = readinessReport('northwind', kitReadiness(without('claims.approved')));
    expect(report).toContain('CLAIMS');
    expect(report).toContain('claims.approved');
    expect(report).toContain('what may be asserted');
  });

  test('it states progress, so a half-finished kit shows how close it is', () => {
    const report = readinessReport('northwind', kitReadiness(without('tagline')));
    expect(report).toMatch(/\d+ of \d+ sections are complete/);
    expect(report).toContain('MESSAGE  (1/2)');
  });

  test('a complete kit says so plainly', () => {
    expect(readinessReport('northwind', kitReadiness(COMPLETE))).toBe('The "northwind" brand kit is complete.');
  });

  test('an empty kit lists EVERY section rather than stopping at the first', () => {
    // Somebody starting from nothing should see the whole job at once, not
    // discover it one refusal at a time.
    const report = readinessReport('x', kitReadiness({}));
    for (const section of KIT_SECTIONS) expect(report).toContain(section.label);
  });

  test('junk never throws', () => {
    for (const junk of [null, undefined, 'a kit', 42, []]) {
      expect(() => kitReadiness(junk)).not.toThrow();
      expect(kitReadiness(junk).ready).toBe(false);
    }
  });
});
