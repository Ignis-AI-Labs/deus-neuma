/**
 * The review packet's shape law (house-clock/review-packet.js packetFields) —
 * a pure function, real inputs to real outputs: a packet names only open asks
 * of its own house, each once, its blocked ones among them, with a summary.
 * The seat law (only the seated Optio files it) is proven on the real sweep in
 * test/integration/house-review-packet.test.js.
 */
import { describe, test, expect } from 'vitest';
import { packetFields, PACKET_SUMMARY_MAX, PACKET_ITEMS_MAX } from '../../backend/services/house-clock/review-packet.js';

const asks = [
  { id: 'a1', status: 'open' }, { id: 'a2', status: 'open' }, { id: 'a3', status: 'answered' }, { id: 'a4', status: 'closed' },
];
const judge = (fields) => packetFields({ summary: 'Two things wait on you.', order: ['a2', 'a1'], ...fields }, asks);

describe('a review packet\'s fields', () => {
  test('a good packet keeps the Optio\'s order, its blocked ones, the summary trimmed', () => {
    expect(judge({ summary: '  Price first, then the site.  ', blocked: ['a2', 'a2'] })).toEqual({
      ok: true, value: { summary: 'Price first, then the site.', order: ['a2', 'a1'], blocked: ['a2'] },
    });
    expect(judge({}).value.blocked).toEqual([]);
  });

  test('every ask it names must exist in this house and still be open', () => {
    expect(judge({ order: ['a1', 'zz'] }).reason).toMatch(/no such ask in this house: zz/);
    expect(judge({ order: ['a1', 'a3', 'a4'] }).reason).toMatch(/already answered or closed: a3, a4/);
    expect(judge({ blocked: ['a3'] }).reason).toMatch(/not in order: a3/);
  });

  test('shape: a summary, a non-empty order of ids, no repeats, bounded', () => {
    expect(judge({ summary: '  ' }).reason).toMatch(/needs a summary/);
    expect(judge({ summary: 'x'.repeat(PACKET_SUMMARY_MAX + 1) }).reason).toMatch(/keep it under/);
    expect(judge({ order: [] }).reason).toMatch(/order lists the open ask ids/);
    expect(judge({ order: 'a1' }).reason).toMatch(/order lists/);
    expect(judge({ order: ['a1', 'a1'] }).reason).toMatch(/appears twice/);
    expect(judge({ blocked: 'a1' }).reason).toMatch(/blocked lists ask ids/);
    const many = Array.from({ length: PACKET_ITEMS_MAX + 1 }, (_, i) => `x${i}`);
    expect(packetFields({ summary: 's', order: many }, many.map((id) => ({ id, status: 'open' }))).reason).toMatch(/at most 50/);
  });
});
