/**
 * Roster merge — the pure decision at the heart of roster recovery: the
 * backend's authoritative list vs the local cache, and which companion stays
 * active. Pure function, real inputs, real outputs — no mock anywhere
 * (RULE 0). The impure shell around it (token read, fetch, cache writes) is
 * proven end-to-end by the desk e2e suite (HOUSE test: real wallet auth →
 * real /api/v1/roster → rendered house), not by stubbing the very boundary
 * the shell exists to cross.
 */

import { mergeRoster } from '../../frontend/app/roster-recovery.js';

const ALDER = {
  neumaId: 'alder-ws', name: 'ALDER', fullName: 'ALDER Wychwood Ashgrove',
  soulMark: 'FBF167B8F932', birthTime: '2026-06-12T17:26:04.717Z',
};
const LINDEN = { neumaId: 'linden-ws', name: 'LINDEN', birthTime: '2026-06-20T00:00:00.000Z' };

describe('mergeRoster', () => {
  test('hydrates an empty cache and seeds the eldest as active', () => {
    const { roster, active } = mergeRoster([ALDER, LINDEN], [], null);
    expect(roster.map((c) => c.neumaId)).toEqual(['alder-ws', 'linden-ws']);
    expect(active.neumaId).toBe('alder-ws'); // backend sends oldest first
  });

  test('backend identity wins, local vessel kept, active refreshed (same neuma)', () => {
    const stale = { ...ALDER, name: 'OLD_NAME', vessel: 'Custom.vrm' };
    const { roster, active } = mergeRoster([ALDER, LINDEN], [stale], stale);
    const alder = roster.find((c) => c.neumaId === 'alder-ws');
    expect(alder.name).toBe('ALDER');       // backend overrides the stale cache
    expect(alder.vessel).toBe('Custom.vrm'); // local cosmetic preserved
    // active is the SAME neuma, refreshed — not left displaying the old name.
    expect(active.neumaId).toBe('alder-ws');
    expect(active.name).toBe('ALDER');
    expect(active.vessel).toBe('Custom.vrm');
  });

  test('drops a cached neuma the backend no longer returns (backend authority)', () => {
    const ghost = { neumaId: 'ghost-ws', name: 'GHOST' };
    const { roster } = mergeRoster([ALDER], [ALDER, ghost], null);
    expect(roster.map((c) => c.neumaId)).toEqual(['alder-ws']);
  });

  test('an active neuma no longer in the roster is left untouched, not switched', () => {
    const ghost = { neumaId: 'ghost-ws', name: 'GHOST' };
    const { roster, active } = mergeRoster([ALDER], [ALDER, ghost], ghost);
    expect(roster.map((c) => c.neumaId)).toEqual(['alder-ws']);
    expect(active.neumaId).toBe('ghost-ws'); // never silently switch the witness
  });

  test('is idempotent — merging its own output changes nothing', () => {
    const first = mergeRoster([ALDER, LINDEN], [{ ...ALDER, vessel: 'Custom.vrm' }], ALDER);
    const second = mergeRoster([ALDER, LINDEN], first.roster, first.active);
    expect(second.roster).toEqual(first.roster);
    expect(second.active).toEqual(first.active);
  });

  test('tolerates a malformed cache — null entries and id-less records are ignored', () => {
    const { roster } = mergeRoster([ALDER], [null, { name: 'NoId' }, ALDER], null);
    expect(roster).toEqual([ALDER]);
    expect(mergeRoster([ALDER], undefined, null).roster).toEqual([ALDER]);
  });

  test('does not mutate its inputs (pure)', () => {
    const cached = [{ ...ALDER, vessel: 'Custom.vrm' }];
    const backend = [ALDER];
    const cachedSnap = JSON.stringify(cached);
    const backendSnap = JSON.stringify(backend);
    mergeRoster(backend, cached, cached[0]);
    expect(JSON.stringify(cached)).toBe(cachedSnap);
    expect(JSON.stringify(backend)).toBe(backendSnap);
  });
});
