// Desk slots — the pure heart of the multi-window registry (I-01).
// Pure functions on plain data: no Electron, no mocks (GNOSIS-compatible).
import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { SLOT_ARG_PREFIX, lowestFreeSlot, parseDeskSlot, hiddenDeskSlot } = require('../../electron/desk-slots.cjs');

describe('lowestFreeSlot', () => {
  it('claims slot 1 on an empty registry', () => {
    expect(lowestFreeSlot([])).toBe(1);
  });

  it('claims the next slot when lower ones are held', () => {
    expect(lowestFreeSlot([1])).toBe(2);
    expect(lowestFreeSlot([1, 2, 3])).toBe(4);
  });

  it('reclaims a gap left by a closed desk — restart semantics', () => {
    // desks 1..3 open, desk 2 closed: the next window IS desk 2 again,
    // and with it reclaims desk 2's persisted layout.
    expect(lowestFreeSlot([1, 3])).toBe(2);
  });

  it('accepts any iterable (the registry passes Map.keys())', () => {
    expect(lowestFreeSlot(new Map([[1, 'a'], [2, 'b']]).keys())).toBe(3);
  });
});

describe('parseDeskSlot', () => {
  it('reads the slot main passed via additionalArguments', () => {
    expect(parseDeskSlot(['/usr/bin/electron', `${SLOT_ARG_PREFIX}3`])).toBe(3);
  });

  it('resolves null when no slot was declared (plain browser tab)', () => {
    expect(parseDeskSlot(['/usr/bin/electron', '--type=renderer'])).toBeNull();
  });

  it('fails closed to null on malformed values, never crashes', () => {
    expect(parseDeskSlot([`${SLOT_ARG_PREFIX}`])).toBeNull();
    expect(parseDeskSlot([`${SLOT_ARG_PREFIX}zero`])).toBeNull();
    expect(parseDeskSlot([`${SLOT_ARG_PREFIX}0`])).toBeNull();
    expect(parseDeskSlot([`${SLOT_ARG_PREFIX}-2`])).toBeNull();
    expect(parseDeskSlot([`${SLOT_ARG_PREFIX}2.5`])).toBeNull();
    expect(parseDeskSlot(undefined)).toBeNull();
    expect(parseDeskSlot([null, 42])).toBeNull();
  });

  it('takes the first declaration when several appear', () => {
    expect(parseDeskSlot([`${SLOT_ARG_PREFIX}2`, `${SLOT_ARG_PREFIX}9`])).toBe(2);
  });
});

describe('hiddenDeskSlot', () => {
  it('finds the desk the X hid to the tray', () => {
    expect(hiddenDeskSlot([[1, { visible: false }]])).toBe(1);
    expect(hiddenDeskSlot([[1, { visible: true }], [2, { visible: false }]])).toBe(2);
  });

  it('takes the lowest hidden slot, whatever order the registry lists them in', () => {
    expect(hiddenDeskSlot([[3, { visible: false }], [1, { visible: true }], [2, { visible: false }]])).toBe(2);
  });

  it('is null when every desk is on screen, or there is none', () => {
    expect(hiddenDeskSlot([[1, { visible: true }], [2, { visible: true }]])).toBeNull();
    expect(hiddenDeskSlot([])).toBeNull();
    expect(hiddenDeskSlot(new Map().entries())).toBeNull();
  });
});
