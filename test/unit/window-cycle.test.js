/**
 * Shift+\ moves between open windows.
 *
 * Design note, 2026-07-27: muscle memory from his editor, carried onto the desk — the
 * `\|` key, which he named by its physical position rather than its character.
 *
 * The hazard is the reason most of these cases exist: `Shift+\` IS the `|`
 * character. A global handler that does not stand down inside a text surface
 * steals every pipe typed into the composer, the terminal, a path or a regex —
 * a far worse regression than having no shortcut. So […] is tested harder than the cycling itself.
 *
 * Pure functions, real inputs, no mocks (RULE 0).
 *
 * `isTypingTarget` is NOT unit-tested here, deliberately. It is one DOM query,
 * and its whole correctness IS the selector — hand-building an object with a
 * fake `closest()` would prove only that the fake matches the code. There is no
 * DOM environment in this suite (`vitest.config.js` → `environment: 'node'`;
 * jsdom is not installed), and adding one to host a stub would be cheating
 * gnosis.
 *
 * It is COVERED in `test/e2e/desk.spec.js` against a real browser, real focus
 * and real typing — the only place the actual requirement can be checked: that
 * typing `|` into the composer still types `|` and moves nothing.
 *
 * ⚠ That e2e is WRITTEN BUT NOT YET RUN (it needs the desk stack up), so the
 * guard is reasoned and covered, NOT yet proven. Saying "proven" here while the
 * spec has never executed would be exactly the false gnosis claim RULE 0 exists
 * to prevent. Run `npm run test:e2e:desk` and delete this paragraph.
 */
import { describe, it, expect } from 'vitest';
import { nextWindowId, cycleDirection } from '../../frontend/app/windowing/window-cycle.js';

const wins = (...ids) => ids.map((id) => ({ id }));
const press = (over = {}) => ({ code: 'Backslash', key: '|', shiftKey: true, ...over });

describe('nextWindowId — stable open order, wrapping', () => {
  it('walks forward in the order windows were opened', () => {
    const w = wins('chat', 'files', 'terminal');
    expect(nextWindowId(w, 'chat', 1)).toBe('files');
    expect(nextWindowId(w, 'files', 1)).toBe('terminal');
  });

  it('wraps at the end, so the cycle is a loop', () => {
    expect(nextWindowId(wins('chat', 'files', 'terminal'), 'terminal', 1)).toBe('chat');
  });

  it('walks backward and wraps the other way', () => {
    const w = wins('chat', 'files', 'terminal');
    expect(nextWindowId(w, 'files', -1)).toBe('chat');
    expect(nextWindowId(w, 'chat', -1)).toBe('terminal');
  });

  it('reaches EVERY window, which is the whole point of stable order over MRU', () => {
    const w = wins('a', 'b', 'c', 'd', 'e');
    const seen = [];
    let at = 'a';
    for (let i = 0; i < 4; i += 1) { at = nextWindowId(w, at, 1); seen.push(at); }
    expect(seen).toEqual(['b', 'c', 'd', 'e']); // not ping-ponging between two
  });

  it('does nothing when there is nothing to move to', () => {
    expect(nextWindowId([], null, 1)).toBeNull();
    expect(nextWindowId(wins('only'), 'only', 1)).toBeNull(); // one window
    expect(nextWindowId(null, null, 1)).toBeNull();
  });

  it('lands somewhere sensible when nothing is focused, rather than refusing', () => {
    const w = wins('chat', 'files');
    expect(nextWindowId(w, null, 1)).toBe('chat');
    expect(nextWindowId(w, 'a-closed-window', 1)).toBe('chat');
    expect(nextWindowId(w, null, -1)).toBe('files');
  });

  it('ignores malformed entries instead of focusing undefined', () => {
    expect(nextWindowId([{ id: 'chat' }, {}, { id: 'files' }], 'chat', 1)).toBe('files');
  });
});

describe('cycleDirection — which chord means what', () => {
  it('Shift+\\ goes forward', () => {
    expect(cycleDirection(press())).toBe(1);
  });

  it('Ctrl+Shift+\\ and Cmd+Shift+\\ go back', () => {
    expect(cycleDirection(press({ ctrlKey: true }))).toBe(-1);
    expect(cycleDirection(press({ metaKey: true }))).toBe(-1);
  });

  it('answers to the physical key even if the layout reports another character', () => {
    expect(cycleDirection({ code: 'Backslash', key: 'ø', shiftKey: true })).toBe(1);
  });

  it('answers to the character even if the code is missing', () => {
    expect(cycleDirection({ key: '|', shiftKey: true })).toBe(1);
  });

  it('is NOT triggered without shift — a bare backslash is a backslash', () => {
    expect(cycleDirection(press({ shiftKey: false }))).toBe(0);
  });

  it('is not triggered by Alt, which composes characters on some layouts', () => {
    expect(cycleDirection(press({ altKey: true }))).toBe(0);
  });

  it('ignores every other key', () => {
    expect(cycleDirection({ code: 'Tab', key: 'Tab', shiftKey: true })).toBe(0);
    expect(cycleDirection({ code: 'Slash', key: '?', shiftKey: true })).toBe(0);
    expect(cycleDirection(null)).toBe(0);
  });
});
