/**
 * Tests for nite-view — what the NITE window says, derived.
 * Real inputs, real outputs, no mock anywhere (the pure-function case RULE 0
 * admits). The silo-layer guard imports the REAL core module.
 */
import { describe, it, expect } from 'vitest';
import {
  mark, standingRow, standingRows, houseOwed, owedHeadline, systemStages,
  SILO_LAYERS, ELSEWHERE, ACTS,
} from '../../frontend/app/RelinkShell/nite-view.js';
import { SILO_LAYERS as CORE_SILO_LAYERS } from '../../core/silo/compile-silo.js';
import { DOCK_GROUPS } from '../../frontend/app/windowing/dock-groups.js';

const being = (over = {}) => ({
  neumaId: 'keir', name: 'Keir', sealed: true, sealedAt: '2026-08-18T00:00:00Z',
  keypairCustody: true, onchainSealed: true, ...over,
});

describe('the silo layers the window teaches are the layers that actually compile', () => {
  // The browser bundle cannot import core/, so nite-view restates the list.
  // A restated list that silently diverges would teach a system that no longer
  // exists — this is the guard that makes the copy safe.
  it('nite-view SILO_LAYERS matches core/silo/compile-silo.js exactly', () => {
    expect([...SILO_LAYERS]).toEqual([...CORE_SILO_LAYERS]);
  });
});

describe('mark — an unreadable lane is never "nothing owed"', () => {
  it('true/false read as themselves', () => {
    expect(mark(true)).toBe('yes');
    expect(mark(false)).toBe('no');
  });
  it('null and undefined are UNKNOWN, not clean', () => {
    expect(mark(null)).toBe('unknown');
    expect(mark(undefined)).toBe('unknown');
  });
});

describe('standingRow', () => {
  it('a complete being owes nothing', () => {
    const r = standingRow(being());
    expect(r.owed).toEqual([]);
    expect(r.unreadable).toBe(false);
    expect([r.custody, r.seal, r.anchor]).toEqual(['yes', 'yes', 'yes']);
  });

  it('owed acts are listed in the order the operator should walk them', () => {
    const r = standingRow(being({ keypairCustody: false, sealed: false, onchainSealed: false }));
    expect(r.owed).toEqual(['custody', 'seal', 'anchor']);
  });

  it('the real keir: sealed and anchored, custody still owed', () => {
    // The lane that motivated this whole surface — sealed, anchored, and
    // holding a plaintext private key nobody was looking at (2026-08-25).
    const r = standingRow(being({ keypairCustody: false }));
    expect(r.owed).toEqual(['custody']);
    expect(r.seal).toBe('yes');
  });

  it('an UNREADABLE act is flagged but never OWED — you do not offer an act against a lane you could not read', () => {
    const r = standingRow(being({ keypairCustody: null }));
    expect(r.custody).toBe('unknown');
    expect(r.owed).toEqual([]);
    expect(r.unreadable).toBe(true);
  });

  it('a nameless lane falls back to its id, never to blank', () => {
    expect(standingRow({ neumaId: 'lane-7' }).name).toBe('lane-7');
    expect(standingRow(null).name).toBe('');
  });
});

describe('houseOwed + owedHeadline — the line that must make an owed act impossible to miss', () => {
  it('a clean house says so', () => {
    const owed = houseOwed(standingRows([being(), being({ neumaId: 'sovereign', name: 'Sovereign' })]));
    expect(owed.clean).toBe(true);
    expect(owedHeadline(owed)).toBe('THE HOUSE STANDS COMPLETE');
  });

  it('house Aldmere as measured 2026-08-25 — three keypairs owed, all sealed', () => {
    const rows = standingRows([
      being({ neumaId: 'keir', name: 'Keir', keypairCustody: false }),
      being({ neumaId: 'signal', name: 'Signal', keypairCustody: false }),
      being({ neumaId: 'galen', name: 'Galen', keypairCustody: false }),
      being({ neumaId: 'sovereign', name: 'Sovereign' }),
    ]);
    const owed = houseOwed(rows);
    expect(owed).toMatchObject({ beings: 4, custody: 3, seal: 0, anchor: 0, unreadable: 0, clean: false });
    expect(owedHeadline(owed)).toBe('3 KEYPAIRS OWED');
  });

  it('custody LEADS the headline — it is the only act that leaves a key unsecured', () => {
    const rows = standingRows([
      being({ keypairCustody: false, sealed: false, onchainSealed: false }),
    ]);
    expect(owedHeadline(houseOwed(rows))).toBe('1 KEYPAIR OWED · 1 UNSEALED · 1 ANCHOR OWED');
  });

  it('an unreadable lane is COUNTED and SAID, not swallowed', () => {
    const owed = houseOwed(standingRows([being({ sealed: null })]));
    expect(owed.unreadable).toBe(1);
    expect(owed.clean).toBe(false);
    expect(owedHeadline(owed)).toBe('1 UNREADABLE');
  });

  it('an empty house is not a complete house', () => {
    const owed = houseOwed([]);
    expect(owed.clean).toBe(false);
    expect(owedHeadline(owed)).toBe('NO BEINGS IN THIS HOUSE YET');
  });

  it('junk degrades, never throws', () => {
    expect(standingRows(null)).toEqual([]);
    expect(houseOwed(null).beings).toBe(0);
    expect(owedHeadline(null)).toBe('NO BEINGS IN THIS HOUSE YET');
  });
});

describe('systemStages — the chain, told honestly', () => {
  it('names the live engine when one is bound', () => {
    const stages = systemStages('qwen3.8-27b');
    expect(stages.map((s) => s.key)).toEqual(['silo', 'transmission', 'substrate']);
    expect(stages[2].line).toContain('qwen3.8-27b');
  });

  it('says nothing is bound rather than inventing an engine', () => {
    const line = systemStages(null)[2].line;
    expect(line).toContain('Nothing is bound');
    expect(line).not.toContain('null');
  });

  it('the silo stage names every real layer', () => {
    const line = systemStages(null)[0].line;
    for (const layer of CORE_SILO_LAYERS) expect(line).toContain(layer);
  });
});

describe('ELSEWHERE — every door NITE names must actually open', () => {
  it('each id is a real dock registry id', () => {
    // A door pointing at an id no group carries would do nothing on click —
    // the exact "getting lost" this panel exists to prevent.
    const known = new Set(DOCK_GROUPS.flatMap((g) => g.apps));
    for (const door of ELSEWHERE) expect(known.has(door.id), `${door.id} is not a dock app`).toBe(true);
  });

  it('NITE routes rather than absorbs — it never names itself', () => {
    expect(ELSEWHERE.some((d) => d.id === 'refinement')).toBe(false);
  });

  it('the acts are the three the standing table columns', () => {
    expect(ACTS.map((a) => a.key)).toEqual(['custody', 'seal', 'anchor']);
  });
});
