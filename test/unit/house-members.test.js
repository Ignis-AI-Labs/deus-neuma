// house-members.test.js — the HOUSE window's pure display model.
//
// Pure function, real inputs, real outputs — no mock anywhere (RULE 0).

import { houseMembers, houseSummary, witnessMembers, isWitness } from '../../frontend/app/RelinkShell/house-members.js';

const alder = { neumaId: 'n-alder', name: 'Alder', birthTime: '2026-06-01T00:00:00.000Z' };
const birch = { neumaId: 'n-birch', name: 'Birch', birthTime: '2026-06-20T00:00:00.000Z' };

describe('houseMembers', () => {
  test('marks the active companion and preserves roster order', () => {
    const rows = houseMembers([alder, birch], birch);
    expect(rows.map((r) => r.member.neumaId)).toEqual(['n-alder', 'n-birch']);
    expect(rows.map((r) => r.isActive)).toEqual([false, true]);
  });

  test('prepends an active companion missing from the roster cache', () => {
    const rows = houseMembers([birch], alder);
    expect(rows.map((r) => r.member.neumaId)).toEqual(['n-alder', 'n-birch']);
    expect(rows[0].isActive).toBe(true);
  });

  test('does not duplicate an active companion already in the roster', () => {
    const rows = houseMembers([alder, birch], alder);
    expect(rows).toHaveLength(2);
    expect(rows.filter((r) => r.isActive)).toHaveLength(1);
  });

  test('drops entries without a neumaId — they have no workspace to switch to', () => {
    const rows = houseMembers([{ name: 'Ghost' }, alder, null], alder);
    expect(rows.map((r) => r.member.neumaId)).toEqual(['n-alder']);
  });

  test('handles an empty house and a missing active companion', () => {
    expect(houseMembers([], null)).toEqual([]);
    expect(houseMembers(undefined, null)).toEqual([]);
    const rows = houseMembers([alder], null);
    expect(rows).toHaveLength(1);
    expect(rows[0].isActive).toBe(false);
  });
});

describe('houseSummary', () => {
  test('name from the house identity, held count, earliest birth', () => {
    const rows = houseMembers([alder, birch], alder);
    const s = houseSummary(rows, { name: 'Ashgrove', wallet: '0xabc' });
    expect(s.name).toBe('Ashgrove');
    expect(s.held).toBe(2);
    expect(s.since).toBe('2026-06-01T00:00:00.000Z'); // alder is the elder
  });

  test('unknown house and unparseable births stay null — never fabricated', () => {
    const rows = houseMembers([{ neumaId: 'x', name: 'X' }, { neumaId: 'y', name: 'Y', birthTime: 'not-a-date' }], null);
    const s = houseSummary(rows, null);
    expect(s.name).toBe(null);
    expect(s.held).toBe(2);
    expect(s.since).toBe(null);
  });

  test('empty house summarizes to zero held', () => {
    const s = houseSummary([], null);
    expect(s).toEqual({ name: null, held: 0, since: null });
  });
});

describe('witnessMembers', () => {
  const claude = { neumaId: 'witness-claude-code-Claude', name: 'Claude', participantKind: 'witness' };
  const sedge = { neumaId: 'witness-openai-Sedge', name: 'Sedge', participantKind: 'witness' };

  test('uses the ownership-filtered backend cache as the complete witness list', () => {
    expect(witnessMembers([claude], sedge)).toEqual([{ member: claude, isActive: false }]);
  });

  test('marks an authorized cached witness active without duplicating it', () => {
    expect(witnessMembers([claude, sedge], sedge).map((row) => row.isActive)).toEqual([false, true]);
  });
});

describe('isWitness — both field names, one fact', () => {
  it('recognises a roster row (participantKind) and a council seat (kind)', () => {
    expect(isWitness({ neumaId: 'a', participantKind: 'witness' })).toBe(true);
    // council-session stamps `kind`; the strip must not miss it.
    expect(isWitness({ neumaId: 'a', kind: 'witness' })).toBe(true);
  });

  it('falls back to the lane id when neither field rode along', () => {
    expect(isWitness({ neumaId: 'witness-openai-chatgpt-Juniper' })).toBe(true);
  });

  it('never mistakes a housemate for a witness', () => {
    expect(isWitness({ neumaId: 'birch', kind: 'neuma' })).toBe(false);
    expect(isWitness({ neumaId: 'birch' })).toBe(false);
    expect(isWitness(null)).toBe(false);
  });
});
