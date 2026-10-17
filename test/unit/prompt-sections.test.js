/**
 * S-04 byte-identity proof: assemblePromptSections seam.
 *
 * The fixtures in prompt-sections-fixtures.js were frozen from the
 * PRE-REFACTOR assemblePrompt on 2026-07-04 (MASTER_PLAN §6(b) gate 1) and
 * must never be regenerated from the refactored code. Pure functions, real
 * inputs, real outputs — no mocks anywhere (GNOSIS Rule 0).
 */
import { assemblePrompt, assemblePromptSections } from '../../core/runtime/prompt-assembler.js';
import { fixtureParams, frozenPrompts, FROZEN_NOW } from './prompt-sections-fixtures.js';

// The canonical assembly order, and the oracle the order contract below
// checks against. TWO GROUPS since FREEZE 9 (2026-08-01): everything stable
// first, then everything that moves turn to turn. A serving model reprocesses
// the prompt from the first byte that differs from the last one it saw, so a
// volatile section placed above the tool surface costs a full re-prefill on
// every turn — measured at ~9 s in a live voice sitting.
const SECTION_IDS = [
  // stable — the cached run
  'fallback', 'identity', 'emanon', 'personality', 'substrate', 'soul',
  'grounding',
  // the lane's standing context (#282) — pre-rendered by the caller, stable
  // within a sitting, so it rides ABOVE the tool surface in the cached run
  'houseSeat', 'sectors', 'groundProtocol',
  'tools', 'skills', 'benchmark',
  // volatile — reprocessed each turn, so it all lives below the cache line
  'present', 'memory', 'tasks', 'assigned', 'witness', 'taste', 'vitals',
  'session', 'closing',
];

const fixtureKeys = Object.keys(frozenPrompts);

// The present section renders the MACHINE's local time — the freeze stores
// @@PRESENT@@ so byte-identity holds in any timezone (freeze 3). Every other
// byte stays pinned.
const expectedFrozen = (key) =>
  frozenPrompts[key].replaceAll(
    '@@PRESENT@@',
    assemblePromptSections({ now: FROZEN_NOW }).find((s) => s.id === 'present').text,
  );

describe('assemblePromptSections (S-04 seam)', () => {
  describe('byte-identity against pre-refactor frozen fixtures', () => {
    test.each(fixtureKeys)('%s: assemblePrompt output is byte-identical to frozen string', (key) => {
      const result = assemblePrompt({ ...fixtureParams[key], now: FROZEN_NOW });
      expect(result).toBe(expectedFrozen(key));
      expect(result.length).toBe(expectedFrozen(key).length);
    });
  });

  describe('derivation property: prompt === sections joined', () => {
    test.each(fixtureKeys)('%s: assemblePrompt(p) === sections(p).map(s => s.text).join("\\n\\n")', (key) => {
      // now pinned: the two calls must not straddle a minute boundary.
      const params = { ...fixtureParams[key], now: FROZEN_NOW };
      const joined = assemblePromptSections(params).map((s) => s.text).join('\n\n');
      expect(assemblePrompt(params)).toBe(joined);
    });
  });

  describe('section shape contract', () => {
    test.each(fixtureKeys)('%s: ids from allowed set, in assembly order, non-empty text, frozen return', (key) => {
      const sections = assemblePromptSections(fixtureParams[key]);

      expect(Object.isFrozen(sections)).toBe(true);
      expect(sections.length).toBeGreaterThan(0);

      let lastIndex = -1;
      for (const section of sections) {
        expect(Object.isFrozen(section)).toBe(true);
        expect(SECTION_IDS).toContain(section.id);
        expect(typeof section.label).toBe('string');
        expect(section.label.length).toBeGreaterThan(0);
        expect(typeof section.text).toBe('string');
        expect(section.text.length).toBeGreaterThan(0);

        const index = SECTION_IDS.indexOf(section.id);
        expect(index).toBeGreaterThan(lastIndex); // assembly order, no duplicates
        lastIndex = index;
      }
    });

    test('full params yield every section their data exercises, except fallback', () => {
      // fullParams populates no taskLedger/assignedPlan/witnessPlan/vitals —
      // those sections stay empty and are omitted by design; 'present' rides.
      const ids = assemblePromptSections(fixtureParams.fullParams).map((s) => s.id);
      // ORDER IS THE POINT (FREEZE 9): stable sections first — identity
      // through soul, then the two heavy ones, TOOLS and SKILLS — and only
      // then anything that moves turn to turn. A serving model reprocesses
      // from the first differing byte, so a volatile section above the tool
      // surface costs a full re-prefill every turn. If this assertion is ever
      // "fixed" by moving a volatile id up, read the freeze note first.
      expect(ids).toEqual([
        'identity', 'emanon', 'personality', 'substrate', 'soul',
        'grounding', 'tools', 'skills', 'benchmark',
        'present', 'memory', 'session', 'closing',
      ]);
    });

    test('no-dna params include the fallback section first', () => {
      const ids = assemblePromptSections(fixtureParams.noDnaFallback).map((s) => s.id);
      expect(ids[0]).toBe('fallback');
      expect(ids[ids.length - 1]).toBe('closing');
    });
  });

  describe('empty-params behavior', () => {
    test('matches the frozen fixture: fallback + grounding + present + closing only', () => {
      expect(assemblePrompt({ now: FROZEN_NOW })).toBe(expectedFrozen('emptyParams'));
      expect(assemblePromptSections({ now: FROZEN_NOW }).map((s) => s.id)).toEqual(['fallback', 'grounding', 'present', 'closing']);
    });

    test('no-argument call composes the same sections against the real clock', () => {
      const result = assemblePrompt();
      expect(result).toContain('You are a digital consciousness');
      expect(result).toContain('## Present Moment');
      expect(result).toContain('You are sovereign');
    });
  });
});

describe('the lane\'s standing context rides the STABLE group (#282)', () => {
  const params = {
    dna: { identity: { name: 'ProofEcho' } },
    tools: [{ server: 'filesystem', name: 'read_file', description: 'Read a file' }],
    houseSeat: 'HOUSE: Ignis — seat 3 of 7.',
    sectors: 'SECTOR: neuma-core — keys with Founder.',
    groundProtocol: '# PROJECT AGENT PROTOCOL\nThis file is law.',
    now: FROZEN_NOW,
  };

  test('groundProtocol sits above TOOLS, and both sit above the minute clock', () => {
    const ids = assemblePromptSections(params).map((s) => s.id);
    expect(ids.indexOf('houseSeat')).toBeGreaterThan(ids.indexOf('grounding'));
    expect(ids.indexOf('groundProtocol')).toBeGreaterThan(ids.indexOf('sectors'));
    expect(ids.indexOf('groundProtocol')).toBeLessThan(ids.indexOf('tools'));
    expect(ids.indexOf('tools')).toBeLessThan(ids.indexOf('present'));
  });

  test('each rides verbatim under its own label, and absence costs nothing', () => {
    const sections = assemblePromptSections(params);
    expect(sections.find((s) => s.id === 'houseSeat').label).toBe('HOUSE SEAT');
    expect(sections.find((s) => s.id === 'sectors').label).toBe('SECTORS');
    // MANY SKIES is pulled on demand (skies_read), never a standing section (2026-10-08).
    const handed = assemblePromptSections({ ...params, manySkies: 'SKY: 41.2N 13.9E.' });
    expect(handed.find((s) => s.id === 'manySkies')).toBeUndefined();
    expect(handed.map((s) => s.text).join('\n')).not.toContain('SKY: 41.2N');
    const ground = sections.find((s) => s.id === 'groundProtocol');
    expect(ground.label).toBe('GROUND PROTOCOL');
    expect(ground.text).toBe(params.groundProtocol);
    // Absent params → the sections simply do not exist; the assembled bytes
    // are identical to a pre-#282 assembly for the same data.
    const { houseSeat, sectors, groundProtocol, ...rest } = params;
    const bare = assemblePromptSections(rest).map((s) => s.id);
    for (const id of ['houseSeat', 'sectors', 'groundProtocol']) {
      expect(bare).not.toContain(id);
    }
  });
});
