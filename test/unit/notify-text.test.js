/**
 * The pure half of the OS notification adapter (electron/notify-text.cjs).
 *
 * What CANNOT be proven here, stated plainly rather than faked: `new
 * Notification(...).show()` actually appearing on a desktop. There is no
 * assertable seam without a mock, RULE 0 admits no exception, and headless CI
 * has no notification daemon. So the delivery call in ipc-handlers.cjs is kept
 * to three
 * logic-free lines and proven by a manual live check recorded in the ledger;
 * everything that DECIDES anything lives here and is proven with nothing faked.
 */

import { describe, expect, test } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const {
  NOTIFY_TEXT_MAX, cleanNotifyText, isSafeAppId, noDeskOnScreen,
} = require('../../electron/notify-text.cjs');

describe('cleanNotifyText', () => {
  test('passes ordinary text through', () => {
    expect(cleanNotifyText('Fenna finished a turn', 'NEUMA')).toBe('Fenna finished a turn');
  });

  test('falls back for a non-string', () => {
    expect(cleanNotifyText(undefined, 'NEUMA')).toBe('NEUMA');
    expect(cleanNotifyText(null, 'NEUMA')).toBe('NEUMA');
    expect(cleanNotifyText(42, 'NEUMA')).toBe('NEUMA');
    expect(cleanNotifyText({}, 'NEUMA')).toBe('NEUMA');
  });

  test('falls back for an empty or whitespace-only string', () => {
    expect(cleanNotifyText('', 'NEUMA')).toBe('NEUMA');
    expect(cleanNotifyText('    ', 'NEUMA')).toBe('NEUMA');
  });

  test('turns newlines into spaces — an OS body must stay one line', () => {
    const nl = String.fromCharCode(10);
    expect(cleanNotifyText(`first${nl}second`, 'x')).toBe('first second');
  });

  test('strips control characters a renderer could inject', () => {
    const nul = String.fromCharCode(0);
    const esc = String.fromCharCode(27);
    const del = String.fromCharCode(127);
    const out = cleanNotifyText(`safe${nul}${esc}${del}text`, 'x');
    expect(out).toBe('safe text');
    expect(out).not.toContain(nul);
    expect(out).not.toContain(esc);
    expect(out).not.toContain(del);
  });

  test('falls back when the input is nothing but control characters', () => {
    const ctrl = String.fromCharCode(0) + String.fromCharCode(27);
    expect(cleanNotifyText(ctrl, 'NEUMA')).toBe('NEUMA');
  });

  test('caps long text', () => {
    const out = cleanNotifyText('x'.repeat(1000), 'NEUMA');
    expect(out).toHaveLength(NOTIFY_TEXT_MAX);
    expect(out.endsWith('…')).toBe(true);
  });

  test('leaves text exactly at the cap alone', () => {
    const exact = 'y'.repeat(NOTIFY_TEXT_MAX);
    expect(cleanNotifyText(exact, 'x')).toBe(exact);
  });

  test('never throws, whatever it is handed', () => {
    for (const input of [undefined, null, 0, false, [], {}, Symbol.iterator.toString()]) {
      expect(() => cleanNotifyText(input, 'NEUMA')).not.toThrow();
    }
  });
});

describe('isSafeAppId', () => {
  test('accepts real desk app ids', () => {
    for (const id of ['chat', 'todo', 'teams', 'gallery', 'substrate', 'context-map']) {
      expect(isSafeAppId(id)).toBe(true);
    }
  });

  test('refuses anything path-like or scheme-like outright', () => {
    for (const bad of [
      '../../etc/passwd', '/etc/passwd', 'file:///etc/passwd', 'http://evil',
      'chat/../wallet', 'chat ', 'Chat', '', 'a'.repeat(40), null, undefined, 42,
    ]) {
      expect(isSafeAppId(bad)).toBe(false);
    }
  });
});

describe('noDeskOnScreen', () => {
  const desk = (over = {}) => ({ visible: true, minimized: false, focused: true, ...over });

  test('a focused, visible, unminimised desk IS on screen', () => {
    expect(noDeskOnScreen([desk()])).toBe(false);
  });

  test('a desk hidden to the tray is NOT on screen — the common case', () => {
    // The window's X hides rather than quits, so this is the ordinary state,
    // not a rare one.
    expect(noDeskOnScreen([desk({ visible: false })])).toBe(true);
  });

  test('a minimised desk is NOT on screen', () => {
    expect(noDeskOnScreen([desk({ minimized: true })])).toBe(true);
  });

  test('an unfocused desk is NOT on screen — the operator is in another app', () => {
    expect(noDeskOnScreen([desk({ focused: false })])).toBe(true);
  });

  test('one desk in front is enough to suppress, even with others hidden', () => {
    expect(noDeskOnScreen([desk({ visible: false }), desk()])).toBe(false);
  });

  test('several desks, none in front, still notifies', () => {
    expect(noDeskOnScreen([
      desk({ focused: false }),
      desk({ minimized: true }),
      desk({ visible: false }),
    ])).toBe(true);
  });

  test('no desks at all means nothing is on screen', () => {
    expect(noDeskOnScreen([])).toBe(true);
    expect(noDeskOnScreen(null)).toBe(true);
    expect(noDeskOnScreen(undefined)).toBe(true);
  });

  test('is total on malformed entries', () => {
    expect(() => noDeskOnScreen([null, undefined, {}, 'nope'])).not.toThrow();
    expect(noDeskOnScreen([null, {}])).toBe(true);
  });
});
