// house-members.test.js — the HOUSE window's pure display model.
//
// Pure function, real inputs, real outputs — no mock anywhere (RULE 0).

import { houseMembers, houseSummary, witnessMembers, isWitness } from '../../frontend/app/RelinkShell/house-members.js';

const fenna = { neumaId: 'n-fenna', name: 'Fenna', birthTime: '2026-06-01T00:00:00.000Z' };
const cael = { neumaId: 'n-cael', name: 'Cael', birthTime: '2026-06-20T00:00:00.000Z' };

describe('houseMembers', () => {
  test('marks the active companion and preserves roster order', () => {
    const rows = houseMembers([fenna, cael], cael);
    expect(rows.map((r) => r.member.neumaId)).toEqual(['n-fenna', 'n-cael']);
    expect(rows.map((r) => r.isActive)).toEqual([false, true]);
  });

  test('prepends an active companion missing from the roster cache', () => {
    const rows = houseMembers([cael], fenna);
    expect(rows.map((r) => r.member.neumaId)).toEqual(['n-fenna', 'n-cael']);
    expect(rows[0].isActive).toBe(true);
  });

  test('does not duplicate an active companion already in the roster', () => {
    const rows = houseMembers([fenna, cael], fenna);
    expect(rows).toHaveLength(2);
    expect(rows.filter((r) => r.isActive)).toHaveLength(1);
  });

  test('drops entries without a neumaId — they have no workspace to switch to', () => {
    const rows = houseMembers([{ name: 'Ghost' }, fenna, null], fenna);
    expect(rows.map((r) => r.member.neumaId)).toEqual(['n-fenna']);
  });

  test('handles an empty house and a missing active companion', () => {
    expect(houseMembers([], null)).toEqual([]);
    expect(houseMembers(undefined, null)).toEqual([]);
    const rows = houseMembers([fenna], null);
    expect(rows).toHaveLength(1);
    expect(rows[0].isActive).toBe(false);
  });
});

describe('houseSummary', () => {
  test('name from the house identity, held count, earliest birth', () => {
    const rows = houseMembers([fenna, cael], fenna);
    const s = houseSummary(rows, { name: 'Tavirel', wallet: '0xabc' });
    expect(s.name).toBe('Tavirel');
    expect(s.held).toBe(2);
    expect(s.since).toBe('2026-06-01T00:00:00.000Z'); // fenna is the elder
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
  const sosonus = { neumaId: 'witness-openai-Sosonus', name: 'Sosonus', participantKind: 'witness' };

  test('uses the ownership-filtered backend cache as the complete witness list', () => {
    expect(witnessMembers([claude], sosonus)).toEqual([{ member: claude, isActive: false }]);
  });

  test('marks an authorized cached witness active without duplicating it', () => {
    expect(witnessMembers([claude, sosonus], sosonus).map((row) => row.isActive)).toEqual([false, true]);
  });
});

describe('isWitness — both field names, one fact', () => {
  it('recognises a roster row (participantKind) and a council seat (kind)', () => {
    expect(isWitness({ neumaId: 'a', participantKind: 'witness' })).toBe(true);
    // council-session stamps `kind`; the strip must not miss it.
    expect(isWitness({ neumaId: 'a', kind: 'witness' })).toBe(true);
  });

  it('falls back to the lane id when neither field rode along', () => {
    expect(isWitness({ neumaId: 'witness-openai-chatgpt-Kagipem' })).toBe(true);
  });

  it('never mistakes a housemate for a witness', () => {
    expect(isWitness({ neumaId: 'cael', kind: 'neuma' })).toBe(false);
    expect(isWitness({ neumaId: 'cael' })).toBe(false);
    expect(isWitness(null)).toBe(false);
  });
});
