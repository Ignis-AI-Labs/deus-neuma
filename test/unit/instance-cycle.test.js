/**
 * THE MULTI-WINDOW TASKBAR BUTTON (docs/work/dock-stream-cycle.md) — Founder,
 * 2026-10-23: […]
 *
 * The decisions are pure (instance-cycle.js) and run here on real window
 * states built by the REAL reducer; the hover list is rendered for real
 * through react-dom/server. No mocks anywhere.
 */
import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { clickTarget, instanceRows, instancesOf, listPlace } from '../../frontend/app/windowing/instance-cycle.js';
import { reducer, initialState } from '../../frontend/app/windowing/window-manager-reducer.js';
import { DockInstances } from '../../frontend/app/windowing/DockInstances.jsx';
import '../../frontend/i18n/index.js';

const run = (actions) => actions.reduce(reducer, initialState);
// chat, chat#2, chat#3 open in that order, then the person opens the terminal
const desk = () => run([
  { type: 'OPEN', id: 'chat' },
  { type: 'OPEN_NEW', appId: 'chat' },
  { type: 'OPEN_NEW', appId: 'chat' },
  { type: 'OPEN', id: 'terminal' },
]);

// Click the STREAM button the way the dock does: decide, then dispatch.
const click = (state, appId = 'chat') => {
  const next = clickTarget(state.windows, state.focusedId, appId);
  return reducer(state, next ? { type: 'FOCUS', id: next.id, restore: next.restore } : { type: 'OPEN', id: appId });
};

describe('a click steps through the app\'s windows in open order', () => {
  it('lists an app\'s windows in the order they opened', () => {
    expect(instancesOf(desk().windows, 'chat')).toEqual(['chat', 'chat#2', 'chat#3']);
  });

  it('from another app, the first click returns to the stream last in; then each click steps on, wrapping', () => {
    let s = desk();
    expect(s.focusedId).toBe('terminal');
    s = click(s);
    expect(s.focusedId).toBe('chat#3'); // the frontmost stream — the one last in
    s = click(s);
    expect(s.focusedId).toBe('chat');
    s = click(s);
    expect(s.focusedId).toBe('chat#2');
    s = click(s);
    expect(s.focusedId).toBe('chat#3');
  });

  it('every window is reached — the order does not ping-pong between the last two', () => {
    let s = run([{ type: 'OPEN', id: 'chat' }, { type: 'OPEN_NEW', appId: 'chat' }, { type: 'OPEN_NEW', appId: 'chat' }]);
    const seen = new Set();
    for (let i = 0; i < 3; i += 1) { s = click(s); seen.add(s.focusedId); }
    expect([...seen].sort()).toEqual(['chat', 'chat#2', 'chat#3']);
  });

  it('one window: the click raises it as it always did, with no restore', () => {
    const s = run([{ type: 'OPEN', id: 'chat' }, { type: 'OPEN', id: 'terminal' }]);
    expect(clickTarget(s.windows, s.focusedId, 'chat')).toEqual({ id: 'chat', restore: false });
    expect(click(s).windows.find((w) => w.id === 'chat').restored).toBeUndefined();
  });

  it('no window: nothing to raise — the dock opens one', () => {
    expect(clickTarget([], null, 'chat')).toBeNull();
    expect(click(initialState).windows.map((w) => w.id)).toEqual(['chat']);
  });

  it('with two or more, the raised window carries a restore stamp — fresh on every turn', () => {
    let s = desk();
    s = click(s); // chat#3
    const first = s.windows.find((w) => w.id === 'chat#3').restored;
    expect(typeof first).toBe('number');
    s = click(click(click(s))); // around to chat#3 again
    expect(s.windows.find((w) => w.id === 'chat#3').restored).toBeGreaterThan(first);
  });

  it('a restore FOCUS on the window already focused still stamps it (a shaded focused window opens)', () => {
    const s = run([{ type: 'OPEN', id: 'chat' }]);
    const after = reducer(s, { type: 'FOCUS', id: 'chat', restore: true });
    expect(after.windows[0].restored).toBe(s.nextZ);
    expect(after.focusedId).toBe('chat');
    // a plain FOCUS on it stays the no-op it always was
    expect(reducer(s, { type: 'FOCUS', id: 'chat' })).toBe(s);
  });
});

describe('the hover list is the same order, the focused one marked', () => {
  it('rows follow open order, mark exactly the focused window, carry payloads', () => {
    const s = click(desk()); // chat#3 focused
    const rows = instanceRows(s.windows, s.focusedId, 'chat');
    expect(rows.map((r) => r.id)).toEqual(['chat', 'chat#2', 'chat#3']);
    expect(rows.filter((r) => r.focused).map((r) => r.id)).toEqual(['chat#3']);
    expect(instanceRows(run([{ type: 'OPEN_NEW', appId: 'editor', payload: '/a/b.js' }]).windows, null, 'editor')[0].payload).toBe('/a/b.js');
  });

  it('renders one row per window, named by the app, in the dock\'s marks', () => {
    const s = click(desk());
    const app = { label: 'STREAM', InstanceLabel: ({ windowId, fallback }) => (windowId === 'chat#2' ? 'METIDAR · TikTok test' : fallback) };
    const html = renderToStaticMarkup(createElement(DockInstances, {
      app, rows: instanceRows(s.windows, s.focusedId, 'chat'), place: { left: 40, bottom: 58 },
      onPick: () => {}, onEnter: () => {}, onLeave: () => {}, onBlur: () => {}, onEscape: () => {},
    }));
    expect(html).toContain('aria-label="Open STREAM windows"');
    expect(html.match(/role="menuitem"/g)).toHaveLength(3);
    expect(html).toContain('METIDAR · TikTok test');
    expect(html).toContain('>STREAM<'); // instance 1 falls back to the app's label
    expect(html).toContain('>STREAM 3<');
    expect(html).toMatch(/data-window-id="chat#3" class="dock-menu-item is-open is-focused" aria-current="true"/);
    expect(html).toContain('left:40px;bottom:58px');
  });

  it('an app with a window title (TERMINAL) names its rows by that title', () => {
    const app = { label: 'TERMINAL', makeTitle: (ordinal) => (ordinal >= 2 ? `TERMINAL ${ordinal} // SHELL` : 'TERMINAL // SHELL') };
    const html = renderToStaticMarkup(createElement(DockInstances, {
      app, rows: [{ id: 'terminal', focused: true }, { id: 'terminal#2', focused: false }], place: {},
      onPick: () => {}, onEnter: () => {}, onLeave: () => {}, onBlur: () => {}, onEscape: () => {},
    }));
    expect(html).toContain('TERMINAL // SHELL');
    expect(html).toContain('TERMINAL 2 // SHELL');
  });
});

describe('the list stands off the bar beside its button', () => {
  const bar = { left: 12, right: 1908, top: 1000, bottom: 1048, width: 1896 };
  const button = { left: 112, right: 150, top: 1005, bottom: 1043 };
  it('bottom bar: above the button, aligned to it', () => {
    expect(listPlace('bottom', button, bar)).toEqual({ left: 100, bottom: 53 });
  });
  it('top bar: below it', () => {
    expect(listPlace('top', { left: 112, right: 150, top: 51, bottom: 89 }, { ...bar, top: 46, bottom: 94 })).toEqual({ left: 100, top: 53 });
  });
  it('left bar: to its right, bottom-aligned with the button', () => {
    const side = { left: 10, right: 58, top: 52, bottom: 900, width: 48 };
    expect(listPlace('left', { left: 15, right: 53, top: 300, bottom: 338 }, side)).toEqual({ left: 53, bottom: 562 });
  });
  it('never runs past the bar\'s far end', () => {
    expect(listPlace('bottom', { ...button, left: 1890 }, bar).left).toBe(bar.width - 280);
  });
});
