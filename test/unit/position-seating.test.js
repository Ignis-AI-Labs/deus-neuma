/**
 * A seating the members decide together (house/seating, positions/position-seating.js): positions by
 * office, plain name or title; members by lane or name; one member, one position; a reason given.
 */
import { describe, expect, test } from 'vitest';
import { seatingFields } from '../../backend/services/positions/position-seating.js';

const MEMBERS = [{ laneId: 'firepos', name: 'Firepos' }, { laneId: 'zezebur', name: 'Zezebur' }, { laneId: 'rugevil', name: 'Rugevil' }];

describe('the seating the house files', () => {
  test('positions by any of their names, members by name or lane, in the positions\' own order', () => {
    const judged = seatingFields({ seats: { books: 'rugevil', SALES: 'Firepos', Optio: 'ZEZEBUR' }, why: 'decided in council' }, MEMBERS);
    expect(judged.ok).toBe(true);
    expect(judged.value.seats.map((s) => [s.office, s.laneId])).toEqual([['cos', 'zezebur'], ['cro', 'firepos'], ['cao', 'rugevil']]);
    expect(judged.value.why).toBe('decided in council');
  });

  test('every refusal names what to fix', () => {
    expect(seatingFields({ seats: {}, why: 'x' }, MEMBERS).reason).toMatch(/maps each position/);
    expect(seatingFields({ seats: { DESIGN: 'Rugevil' }, why: 'x' }, MEMBERS).reason).toMatch(/no position is called "DESIGN" — the positions are MANAGEMENT, SALES/);
    expect(seatingFields({ seats: { SALES: 'Orrin' }, why: 'x' }, MEMBERS).reason).toMatch(/"Orrin" is not a member of this house — its members are Firepos, Zezebur, Rugevil/);
    expect(seatingFields({ seats: { SALES: 'Rugevil', BOOKS: 'rugevil' }, why: 'x' }, MEMBERS).reason).toMatch(/Rugevil is given two positions/);
    expect(seatingFields({ seats: { SALES: 'Rugevil', cro: 'Zezebur' }, why: 'x' }, MEMBERS).reason).toMatch(/SALES is named twice/);
    expect(seatingFields({ seats: { SALES: 'Rugevil' } }, MEMBERS).reason).toMatch(/how the house decided/);
  });
});
