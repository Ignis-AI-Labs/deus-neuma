/**
 * THE CALM GATE (frontend/app/RelinkShell/calm-gate.js): background news
 * waits while the person works a surface, and lands the moment they leave;
 * their own reads land at once. And an arriving surface takes focus only when
 * focus is free or already in its own window. Pure: real functions, real
 * inputs, nothing stood in for.
 */
import { describe, expect, test } from 'vitest';
import { createCalmGate, mayTakeFocus } from '../../frontend/app/RelinkShell/calm-gate.js';

describe('createCalmGate', () => {
  test('a background update lands at once while nobody is at the surface', () => {
    const gate = createCalmGate();
    const landed = [];
    expect(gate.offer('queue', () => landed.push('q1'))).toBe(true);
    expect(landed).toEqual(['q1']);
    expect(gate.holding()).toEqual([]);
  });

  test('while engaged, each reader\'s LATEST update waits, and leaving lands every reader once, in the order first held', () => {
    const gate = createCalmGate();
    const landed = [];
    gate.setEngaged(true);
    expect(gate.offer('queue', () => landed.push('q1'))).toBe(false);
    expect(gate.offer('pulse', () => landed.push('p1'))).toBe(false);
    expect(gate.offer('queue', () => landed.push('q2'))).toBe(false);
    expect(landed).toEqual([]);
    expect(gate.holding()).toEqual(['queue', 'pulse']);
    gate.setEngaged(true); // still there: nothing lands
    expect(landed).toEqual([]);
    gate.setEngaged(false);
    expect(landed).toEqual(['q2', 'p1']);
    expect(gate.holding()).toEqual([]);
    gate.setEngaged(false); // a second leave lands nothing twice
    expect(landed).toEqual(['q2', 'p1']);
  });

  test('the person\'s own read lands at once even while engaged, and drops that reader\'s older held update', () => {
    const gate = createCalmGate();
    const landed = [];
    gate.setEngaged(true);
    gate.offer('queue', () => landed.push('poll'));
    gate.offer('pulse', () => landed.push('pulse'));
    gate.now('queue', () => landed.push('after-approve'));
    expect(landed).toEqual(['after-approve']);
    expect(gate.holding()).toEqual(['pulse']);
    gate.setEngaged(false);
    expect(landed).toEqual(['after-approve', 'pulse']);
  });
});

describe('mayTakeFocus', () => {
  // A small real tree: contains() walks the parent chain, as a DOM node's does.
  const node = (name, parent = null) => {
    const n = { name, parent };
    n.contains = (other) => { for (let at = other; at; at = at.parent) if (at === n) return true; return false; };
    return n;
  };
  const page = node('body');
  const chatWindow = node('chat window', page);
  const chatComposer = node('composer', chatWindow);
  const tiktokWindow = node('tiktok window', page);
  const queueField = node('queue field', tiktokWindow);

  test('free focus (nothing, or the page itself) may be taken', () => {
    expect(mayTakeFocus(null, chatWindow, page)).toBe(true);
    expect(mayTakeFocus(page, chatWindow, page)).toBe(true);
  });

  test('focus already in the arriving surface\'s own window may move within it', () => {
    expect(mayTakeFocus(chatComposer, chatWindow, page)).toBe(true);
  });

  test('focus in another window is the person\'s, and is never taken', () => {
    expect(mayTakeFocus(queueField, chatWindow, page)).toBe(false);
    expect(mayTakeFocus(queueField, null, page)).toBe(false);
  });
});
