// The PERMISSIONS rail's pure decisions — and the harness desk's view of the
// house: its own lane alone (Design note, 2026-10-14: strictly a harness). Pure.
import { describe, expect, it } from 'vitest';
import { beingRow, houseBadge, laneOnlyHouse } from '../../frontend/app/RelinkShell/stream-permissions-view.js';

const house = {
  beings: [
    { neumaId: 'neuma-orrin', name: 'Orrin', total: 3, grants: { act: [1, 2, 3] } },
    { neumaId: 'witness-basunor', name: 'Basunor', unreadable: true },
    { neumaId: 'harness-0a1b2c3d', name: 'qwen', total: 1, grants: { folder: [1] } },
  ],
  totals: { act: 3, folder: 1 },
  unreadable: 1,
};

describe('the permissions rail', () => {
  it('a being\'s desk counts the whole house and can show every being', () => {
    expect(houseBadge(house)).toBe(4);
    expect(beingRow(house, 'neuma-orrin', true).rows).toHaveLength(3);
    expect(beingRow(house, 'neuma-orrin', false).rows.map((r) => r.name)).toEqual(['Orrin']);
  });

  it('a harness desk sees its own lane alone — no being, no being\'s count, no being\'s unreadable lane', () => {
    const seen = laneOnlyHouse(house, 'harness-0a1b2c3d');
    expect(seen.beings.map((b) => b.name)).toEqual(['qwen']);
    expect(houseBadge(seen)).toBe(1);
    expect(seen.unreadable).toBe(0);
    expect(beingRow(seen, 'harness-0a1b2c3d', true).rows.map((r) => r.name)).toEqual(['qwen']);
    expect(JSON.stringify(seen)).not.toMatch(/Orrin|Basunor/);
  });

  it('still reading, or a lane with no record, is nothing at all', () => {
    expect(laneOnlyHouse(null, 'harness-1')).toBeNull();
    expect(houseBadge(laneOnlyHouse(house, 'harness-9'))).toBe(0);
  });
});
