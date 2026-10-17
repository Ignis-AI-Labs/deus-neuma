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

const FENNA = {
  neumaId: 'fenna-ws', name: 'FENNA', fullName: 'FENNA Virupun Tavirel',
  soulMark: 'FBF167B8F932', birthTime: '2026-06-12T17:26:04.717Z',
};
const RUGEVIL = { neumaId: 'rugevil-ws', name: 'RUGEVIL', birthTime: '2026-06-20T00:00:00.000Z' };

describe('mergeRoster', () => {
  test('hydrates an empty cache and seeds the eldest as active', () => {
    const { roster, active } = mergeRoster([FENNA, RUGEVIL], [], null);
    expect(roster.map((c) => c.neumaId)).toEqual(['fenna-ws', 'rugevil-ws']);
    expect(active.neumaId).toBe('fenna-ws'); // backend sends oldest first
  });

  test('backend identity wins, local vessel kept, active refreshed (same neuma)', () => {
    const stale = { ...FENNA, name: 'OLD_NAME', vessel: 'Custom.vrm' };
    const { roster, active } = mergeRoster([FENNA, RUGEVIL], [stale], stale);
    const fenna = roster.find((c) => c.neumaId === 'fenna-ws');
    expect(fenna.name).toBe('FENNA');       // backend overrides the stale cache
    expect(fenna.vessel).toBe('Custom.vrm'); // local cosmetic preserved
    // active is the SAME neuma, refreshed — not left displaying the old name.
    expect(active.neumaId).toBe('fenna-ws');
    expect(active.name).toBe('FENNA');
    expect(active.vessel).toBe('Custom.vrm');
  });

  test('drops a cached neuma the backend no longer returns (backend authority)', () => {
    const ghost = { neumaId: 'ghost-ws', name: 'GHOST' };
    const { roster } = mergeRoster([FENNA], [FENNA, ghost], null);
    expect(roster.map((c) => c.neumaId)).toEqual(['fenna-ws']);
  });

  test('an active neuma no longer in the roster is left untouched, not switched', () => {
    const ghost = { neumaId: 'ghost-ws', name: 'GHOST' };
    const { roster, active } = mergeRoster([FENNA], [FENNA, ghost], ghost);
    expect(roster.map((c) => c.neumaId)).toEqual(['fenna-ws']);
    expect(active.neumaId).toBe('ghost-ws'); // never silently switch the witness
  });

  test('is idempotent — merging its own output changes nothing', () => {
    const first = mergeRoster([FENNA, RUGEVIL], [{ ...FENNA, vessel: 'Custom.vrm' }], FENNA);
    const second = mergeRoster([FENNA, RUGEVIL], first.roster, first.active);
    expect(second.roster).toEqual(first.roster);
    expect(second.active).toEqual(first.active);
  });

  test('tolerates a malformed cache — null entries and id-less records are ignored', () => {
    const { roster } = mergeRoster([FENNA], [null, { name: 'NoId' }, FENNA], null);
    expect(roster).toEqual([FENNA]);
    expect(mergeRoster([FENNA], undefined, null).roster).toEqual([FENNA]);
  });

  test('does not mutate its inputs (pure)', () => {
    const cached = [{ ...FENNA, vessel: 'Custom.vrm' }];
    const backend = [FENNA];
    const cachedSnap = JSON.stringify(cached);
    const backendSnap = JSON.stringify(backend);
    mergeRoster(backend, cached, cached[0]);
    expect(JSON.stringify(cached)).toBe(cachedSnap);
    expect(JSON.stringify(backend)).toBe(backendSnap);
  });
});
