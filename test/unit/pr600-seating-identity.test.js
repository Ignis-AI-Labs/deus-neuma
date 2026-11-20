import { describe, expect, it } from 'vitest';
import { seatingFields } from '../../backend/services/positions/position-seating.js';

const members = [
  { laneId: 'lane-a', name: 'Rowan' },
  { laneId: 'lane-b', name: 'rowan' },
  { laneId: 'lane-c', name: 'Aster' },
];

describe('P6-152 seating identity', () => {
  it('refuses an ambiguous name instead of seating the first match', () => {
    const result = seatingFields({ seats: { SALES: 'Rowan' }, why: 'council' }, members);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('lane id');
  });

  it('resolves an exact lane id and a genuinely unique name', () => {
    const byLane = seatingFields({ seats: { SALES: 'lane-b' }, why: 'council' }, members);
    expect(byLane.ok).toBe(true);
    expect(byLane.value.seats[0]).toMatchObject({ laneId: 'lane-b', name: 'rowan' });
    const byName = seatingFields({ seats: { SALES: 'Aster' }, why: 'council' }, members);
    expect(byName.ok).toBe(true);
    expect(byName.value.seats[0].laneId).toBe('lane-c');
  });

  it('still refuses a nonmember', () => {
    expect(seatingFields({ seats: { SALES: 'nobody' }, why: 'council' }, members).ok).toBe(false);
  });
});
