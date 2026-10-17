/**
 * Tests for the desk's pulse model (frontend/app/RelinkShell/desk-pulse.js).
 * Pure reducer + derivations driven with real inputs: packet coalescing,
 * the sent marker, the turn count, and the SESSION clock's formatting.
 */
import { describe, expect, test } from 'vitest';
import {
  pulseReducer,
  initialPulse,
  latestSentId,
  formatSessionClock,
  countTurns,
  deskChromeName,
  MAX_PACKETS,
} from '../../frontend/app/RelinkShell/desk-pulse.js';

describe('pulseReducer — PACKET', () => {
  test('appends a packet for a real event', () => {
    const s = pulseReducer(initialPulse, { type: 'PACKET', id: 'p0', kind: 'in' });
    expect(s.packets).toEqual([{ id: 'p0', kind: 'in' }]);
  });

  test('dedupes by id — a replayed effect never doubles a packet', () => {
    const once = pulseReducer(initialPulse, { type: 'PACKET', id: 'out-m3', kind: 'out' });
    const twice = pulseReducer(once, { type: 'PACKET', id: 'out-m3', kind: 'out' });
    expect(twice.packets).toHaveLength(1);
  });

  test('caps the rail at MAX_PACKETS, dropping the oldest — display coalescing, not data loss', () => {
    let s = initialPulse;
    for (let i = 0; i < MAX_PACKETS + 3; i += 1) s = pulseReducer(s, { type: 'PACKET', id: `p${i}`, kind: 'in' });
    expect(s.packets).toHaveLength(MAX_PACKETS);
    expect(s.packets[0].id).toBe('p3'); // the three oldest dropped off
    expect(s.packets.at(-1).id).toBe(`p${MAX_PACKETS + 2}`); // the newest rides
  });

  test('a new tool act replaces the live junction flash instead of stacking diamonds', () => {
    let s = pulseReducer(initialPulse, { type: 'PACKET', id: 'p0', kind: 'in' });
    s = pulseReducer(s, { type: 'PACKET', id: 'p1', kind: 'tool' });
    s = pulseReducer(s, { type: 'PACKET', id: 'p2', kind: 'tool' });
    expect(s.packets).toEqual([
      { id: 'p0', kind: 'in' },
      { id: 'p2', kind: 'tool' },
    ]);
  });
});

describe('pulseReducer — REAP', () => {
  test('removes the packet whose travel ended', () => {
    let s = pulseReducer(initialPulse, { type: 'PACKET', id: 'p0', kind: 'in' });
    s = pulseReducer(s, { type: 'PACKET', id: 'p1', kind: 'out' });
    s = pulseReducer(s, { type: 'REAP', id: 'p0' });
    expect(s.packets).toEqual([{ id: 'p1', kind: 'out' }]);
  });

  test('an unknown id is a no-op (a coalesced flash’s stale animationend)', () => {
    const s = pulseReducer(initialPulse, { type: 'PACKET', id: 'p0', kind: 'in' });
    expect(pulseReducer(s, { type: 'REAP', id: 'gone' }).packets).toHaveLength(1);
  });
});

// UX-016 (#251). TURN used to be reducer state counting `consciousness:complete`
// frames seen by ONE page mount, so it read 0 above a transcript still
// rendering that turn's six tool chips, and two windows on the same
// conversation disagreed. It is a transcript property now.
describe('countTurns — TURN is a conversation property, not a page-mount one', () => {
  test('the pulse no longer carries a turn count at all', () => {
    expect(initialPulse).not.toHaveProperty('turns');
    expect(pulseReducer(initialPulse, { type: 'TURN' })).toBe(initialPulse);
  });

  test('counts the operator`s messages, which is what opens a turn', () => {
    expect(countTurns([
      { id: 'a', role: 'user' },
      { id: 'b', role: 'assistant' },
      { id: 'c', role: 'user' },
      { id: 'd', role: 'assistant' },
    ])).toBe(2);
  });

  test('RESUMED history counts — this is what survives a reload', () => {
    expect(countTurns([
      { id: 'a', role: 'user', isHistory: true },
      { id: 'b', role: 'assistant', isHistory: true },
      { id: 'c', role: 'user' },
    ])).toBe(2);   // two operator messages: one resumed, one live
  });

  test('a turn in progress already counts — the streaming turn is a turn', () => {
    expect(countTurns([{ id: 'a', role: 'user' }])).toBe(1);
  });

  test('empty and malformed transcripts are 0, never NaN', () => {
    expect(countTurns([])).toBe(0);
    expect(countTurns(null)).toBe(0);
    expect(countTurns(undefined)).toBe(0);
    expect(countTurns([null, {}, { role: 'tool' }])).toBe(0);
  });

  test('unknown actions leave the state alone', () => {
    expect(pulseReducer(initialPulse, { type: 'NOPE' })).toBe(initialPulse);
  });
});

// FE-REDESIGN-006 (#102). The chrome rendered the literal `NEUMA // PORTAL`
// while the same component already held the bound being.
describe('deskChromeName — the chrome names the being, not the product', () => {
  test('a bound being owns the chrome', () => {
    expect(deskChromeName({ name: 'Tenekom' })).toBe('TENEKOM');
  });

  test('nothing bound stays the honest pre-birth state', () => {
    expect(deskChromeName(null)).toBe('NEUMA');
    expect(deskChromeName({})).toBe('NEUMA');
    expect(deskChromeName({ name: '   ' })).toBe('NEUMA');
  });

  test('a non-string name cannot break the chrome', () => {
    expect(deskChromeName({ name: 42 })).toBe('NEUMA');
  });
});

describe('latestSentId — the “thought sent” marker', () => {
  test('null when nothing was sent', () => {
    expect(latestSentId([])).toBeNull();
  });

  test('null when the only witness messages are history (a resumed chat is not a send)', () => {
    const messages = [
      { id: 'h0', role: 'user', isHistory: true },
      { id: 'h1', role: 'neuma', isHistory: true },
    ];
    expect(latestSentId(messages)).toBeNull();
  });

  test('the newest LIVE witness message id, even with neuma speech after it', () => {
    const messages = [
      { id: 'h0', role: 'user', isHistory: true },
      { id: 'm0', role: 'user', isHistory: false },
      { id: 'm1', role: 'neuma', isHistory: false },
    ];
    expect(latestSentId(messages)).toBe('m0');
  });

  test('tracks the latest send across turns', () => {
    const messages = [
      { id: 'm0', role: 'user', isHistory: false },
      { id: 'm1', role: 'neuma', isHistory: false },
      { id: 'm2', role: 'user', isHistory: false },
    ];
    expect(latestSentId(messages)).toBe('m2');
  });
});

describe('formatSessionClock — the SESSION register', () => {
  test('zero and sub-minute seconds', () => {
    expect(formatSessionClock(0)).toBe('00:00');
    expect(formatSessionClock(5)).toBe('00:05');
    expect(formatSessionClock(59)).toBe('00:59');
  });

  test('minutes and padding', () => {
    expect(formatSessionClock(60)).toBe('01:00');
    expect(formatSessionClock(65)).toBe('01:05');
    expect(formatSessionClock(599)).toBe('09:59');
  });

  test('minutes accumulate past an hour — a session is as long as it is', () => {
    expect(formatSessionClock(3600)).toBe('60:00');
    expect(formatSessionClock(3723)).toBe('62:03');
  });

  test('fractional seconds floor; non-finite and negative fail to 00:00', () => {
    expect(formatSessionClock(61.9)).toBe('01:01');
    expect(formatSessionClock(-4)).toBe('00:00');
    expect(formatSessionClock(NaN)).toBe('00:00');
    expect(formatSessionClock(undefined)).toBe('00:00');
  });
});
