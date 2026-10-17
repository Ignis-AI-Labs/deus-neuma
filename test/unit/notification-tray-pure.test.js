/**
 * The tray's three pure modules — reducer, suppression, click target.
 *
 * No React, no DOM, no socket, no clock. Every input is passed in, so there is
 * nothing to mock and nothing mocked (RULE 0).
 */

import { describe, expect, test } from 'vitest';
import {
  DISPLAY_CAP, initialNotifications, notificationReducer,
} from '../../frontend/app/RelinkShell/NotificationTray/notification-reducer.js';
import {
  shouldRaise, shouldNotifyOS,
} from '../../frontend/app/RelinkShell/NotificationTray/notification-suppression.js';
import {
  notificationTarget,
} from '../../frontend/app/RelinkShell/NotificationTray/notification-target.js';
import { KIND, STANDING, makeRecord } from '../../core/runtime/notification-record.js';

const T0 = 1_754_400_000_000;

const card = (id, over = {}) => ({
  ...makeRecord({
    id,
    ts: T0,
    kind: KIND.turnDone,
    standing: STANDING.neuma,
    title: `card ${id}`,
    actor: { id: 'lane-1', name: 'Fenna' },
    ref: { sessionId: 's-1' },
    ...over,
  }),
  read: over.read ?? false,
});

describe('notificationReducer', () => {
  test('starts empty and NOT hydrated — "none yet" differs from "not asked"', () => {
    expect(initialNotifications.records).toEqual([]);
    expect(initialNotifications.unread).toBe(0);
    expect(initialNotifications.hydrated).toBe(false);
  });

  test('HYDRATE replaces the list and marks the tray hydrated', () => {
    const next = notificationReducer(initialNotifications, {
      type: 'HYDRATE',
      records: [card('a'), card('b', { ts: T0 + 1 })],
    });
    expect(next.records.map((r) => r.id)).toEqual(['b', 'a']);
    expect(next.hydrated).toBe(true);
    expect(next.unread).toBe(2);
  });

  test('HYDRATE does not merge a stale local list over fresh server truth', () => {
    let state = notificationReducer(initialNotifications, { type: 'RECEIVE', record: card('stale') });
    state = notificationReducer(state, { type: 'HYDRATE', records: [card('fresh')] });
    expect(state.records.map((r) => r.id)).toEqual(['fresh']);
  });

  test('an empty hydrate still hydrates', () => {
    const next = notificationReducer(initialNotifications, { type: 'HYDRATE', records: [] });
    expect(next.records).toEqual([]);
    expect(next.hydrated).toBe(true);
  });

  test('RECEIVE adds a card and counts it unread', () => {
    const next = notificationReducer(initialNotifications, { type: 'RECEIVE', record: card('a') });
    expect(next.records).toHaveLength(1);
    expect(next.unread).toBe(1);
  });

  test('the same record arriving twice is ONE card, not two', () => {
    // Real route: it is in the hydrate AND arrives live after a reconnect.
    let state = notificationReducer(initialNotifications, { type: 'HYDRATE', records: [card('dup')] });
    state = notificationReducer(state, { type: 'RECEIVE', record: card('dup') });
    expect(state.records).toHaveLength(1);
    expect(state.unread).toBe(1);
  });

  test('a re-delivered record does not resurrect as unread once read here', () => {
    let state = notificationReducer(initialNotifications, { type: 'RECEIVE', record: card('r') });
    state = notificationReducer(state, { type: 'MARK_READ', ids: ['r'] });
    expect(state.unread).toBe(0);
    state = notificationReducer(state, { type: 'RECEIVE', record: card('r') });
    expect(state.unread).toBe(0);
    expect(state.records[0].read).toBe(true);
  });

  test('orders newest first regardless of arrival order', () => {
    let state = initialNotifications;
    state = notificationReducer(state, { type: 'RECEIVE', record: card('old', { ts: T0 }) });
    state = notificationReducer(state, { type: 'RECEIVE', record: card('new', { ts: T0 + 500 }) });
    state = notificationReducer(state, { type: 'RECEIVE', record: card('mid', { ts: T0 + 250 }) });
    expect(state.records.map((r) => r.id)).toEqual(['new', 'mid', 'old']);
  });

  test('MARK_READ clears exactly the ids it names', () => {
    let state = notificationReducer(initialNotifications, {
      type: 'HYDRATE',
      records: [card('a'), card('b', { ts: T0 + 1 }), card('c', { ts: T0 + 2 })],
    });
    state = notificationReducer(state, { type: 'MARK_READ', ids: ['a', 'c'] });
    expect(state.unread).toBe(1);
    expect(state.records.find((r) => r.id === 'b').read).toBe(false);
  });

  test('a duplicate MARK_READ returns the SAME object so React does not re-render', () => {
    let state = notificationReducer(initialNotifications, { type: 'RECEIVE', record: card('a') });
    state = notificationReducer(state, { type: 'MARK_READ', ids: ['a'] });
    const again = notificationReducer(state, { type: 'MARK_READ', ids: ['a'] });
    expect(again).toBe(state);
  });

  test('MARK_READ for an unknown id changes nothing', () => {
    const state = notificationReducer(initialNotifications, { type: 'RECEIVE', record: card('a') });
    expect(notificationReducer(state, { type: 'MARK_READ', ids: ['ghost'] })).toBe(state);
  });

  test('an empty MARK_READ is a no-op', () => {
    const state = notificationReducer(initialNotifications, { type: 'RECEIVE', record: card('a') });
    expect(notificationReducer(state, { type: 'MARK_READ', ids: [] })).toBe(state);
  });

  test('MARK_ALL_READ empties the badge, and is a no-op when already empty', () => {
    let state = notificationReducer(initialNotifications, {
      type: 'HYDRATE', records: [card('a'), card('b', { ts: T0 + 1 })],
    });
    state = notificationReducer(state, { type: 'MARK_ALL_READ' });
    expect(state.unread).toBe(0);
    expect(notificationReducer(state, { type: 'MARK_ALL_READ' })).toBe(state);
  });

  test('CLEAR empties this tray but stays hydrated — it deletes nothing', () => {
    let state = notificationReducer(initialNotifications, { type: 'HYDRATE', records: [card('a')] });
    state = notificationReducer(state, { type: 'CLEAR' });
    expect(state.records).toEqual([]);
    expect(state.unread).toBe(0);
    expect(state.hydrated).toBe(true);
  });

  test('caps what it holds in memory', () => {
    const many = Array.from({ length: DISPLAY_CAP + 40 }, (_, i) => card(`c${i}`, { ts: T0 + i }));
    const state = notificationReducer(initialNotifications, { type: 'HYDRATE', records: many });
    expect(state.records).toHaveLength(DISPLAY_CAP);
    expect(state.records[0].id).toBe(`c${DISPLAY_CAP + 39}`);
  });

  test('ignores junk instead of throwing', () => {
    expect(notificationReducer(initialNotifications, { type: 'RECEIVE', record: null })).toBe(initialNotifications);
    expect(notificationReducer(initialNotifications, { type: 'NOPE' })).toBe(initialNotifications);
    expect(() => notificationReducer(undefined, undefined)).not.toThrow();
    const state = notificationReducer(initialNotifications, { type: 'HYDRATE', records: 'not an array' });
    expect(state.records).toEqual([]);
  });
});

describe('shouldRaise', () => {
  const watching = {
    documentVisible: true,
    frontmostAppId: 'chat',
    activeSessionId: 's-1',
    activeNeumaId: 'lane-1',
  };

  test('suppresses a completion in the sitting the operator is watching', () => {
    expect(shouldRaise(card('a'), watching)).toBe(false);
  });

  test('raises the identical record when the desk is not on screen', () => {
    expect(shouldRaise(card('a'), { ...watching, documentVisible: false })).toBe(true);
  });

  test('raises when another desk app is frontmost', () => {
    expect(shouldRaise(card('a'), { ...watching, frontmostAppId: 'gallery' })).toBe(true);
  });

  test('raises a completion from a DIFFERENT sitting — the case Founder asked for', () => {
    const other = card('a', { ref: { sessionId: 's-2' } });
    expect(shouldRaise(other, watching)).toBe(true);
  });

  test('raises when this window is bound to nothing', () => {
    expect(shouldRaise(card('a'), { documentVisible: true, frontmostAppId: 'chat' })).toBe(true);
  });

  test('suppresses a sessionless settle from the being in front', () => {
    const settle = card('t', { kind: KIND.taskClosed, ref: { taskId: 'T-1' } });
    expect(shouldRaise(settle, watching)).toBe(false);
  });

  test('raises a sessionless settle from a different being', () => {
    const settle = card('t', {
      kind: KIND.taskClosed, ref: { taskId: 'T-1' }, actor: { id: 'lane-2', name: 'Cael' },
    });
    expect(shouldRaise(settle, watching)).toBe(true);
  });

  test('a refusal always rises — it is different news, not a quieter completion', () => {
    expect(shouldRaise(card('r', { kind: KIND.turnRefused }), watching)).toBe(true);
  });

  test('machine conditions always rise, whatever is in front', () => {
    for (const kind of [KIND.storageWarning, KIND.codeReload]) {
      const sys = { ...card('s', { kind }), standing: STANDING.system, actor: null };
      expect(shouldRaise(sys, watching)).toBe(true);
    }
  });

  test('is total on junk', () => {
    expect(shouldRaise(null, watching)).toBe(false);
    expect(shouldRaise({}, watching)).toBe(false);
    expect(() => shouldRaise(card('a'))).not.toThrow();
  });
});

describe('shouldNotifyOS', () => {
  const visible = { documentVisible: true, frontmostAppId: 'gallery', activeSessionId: 's-9' };

  test('never fires while the desk is on screen, even when a card rises', () => {
    expect(shouldRaise(card('a'), visible)).toBe(true);
    expect(shouldNotifyOS(card('a'), visible)).toBe(false);
  });

  test('fires when the desk is not on screen', () => {
    expect(shouldNotifyOS(card('a'), { ...visible, documentVisible: false })).toBe(true);
  });

  test('never fires for something that would not even raise a card', () => {
    const watching = {
      documentVisible: true, frontmostAppId: 'chat', activeSessionId: 's-1', activeNeumaId: 'lane-1',
    };
    expect(shouldNotifyOS(card('a'), watching)).toBe(false);
  });

  test('is strictly narrower than shouldRaise', () => {
    const hidden = { documentVisible: false };
    for (const kind of Object.values(KIND)) {
      const rec = { ...card('x', { kind }), standing: STANDING.system, actor: { id: 'lane-1', name: 'A' } };
      if (shouldNotifyOS(rec, hidden)) expect(shouldRaise(rec, hidden)).toBe(true);
    }
  });
});

describe('notificationTarget', () => {
  test('a turn lands in the stream, carrying its sitting', () => {
    const t = notificationTarget(card('a'));
    expect(t.appId).toBe('chat');
    expect(t.payload.sessionId).toBe('s-1');
    expect(t.payload.neumaId).toBe('lane-1');
  });

  test('a refusal with no session still lands in the stream, without a payload', () => {
    const t = notificationTarget(card('r', { kind: KIND.turnRefused, ref: {} }));
    expect(t.appId).toBe('chat');
    expect(t.payload).toBeNull();
  });

  test('a settled task lands in TASKS', () => {
    const t = notificationTarget(card('t', { kind: KIND.taskClosed, ref: { taskId: 'T-9' } }));
    expect(t).toEqual({ appId: 'todo', payload: { taskId: 'T-9' } });
  });

  test('a settled assignment lands in TASKS too', () => {
    expect(notificationTarget(card('t', { kind: KIND.assignmentClosed, ref: {} })).appId).toBe('todo');
  });

  test('a finished run lands in TEAMS', () => {
    const t = notificationTarget(card('t', { kind: KIND.runDone, ref: { runId: 'R-1' } }));
    expect(t).toEqual({ appId: 'teams', payload: { runId: 'R-1' } });
  });

  test('a finished render opens the GALLERY on that image', () => {
    const t = notificationTarget(card('t', { kind: KIND.renderDone, ref: { imageId: 'img-7' } }));
    expect(t).toEqual({ appId: 'gallery', payload: { imageId: 'img-7' } });
  });

  test('a legal watch notice opens the LEGAL window', () => {
    expect(notificationTarget(card('t', { kind: KIND.legalAlert }))).toEqual({ appId: 'legal', payload: null });
  });

  test('a settled benchmark and a bench watch alert open the BENCH window', () => {
    expect(notificationTarget(card('t', { kind: KIND.benchDone, ref: { comparisonId: 'desk-1' } }))).toEqual({ appId: 'bench', payload: null });
    expect(notificationTarget(card('t', { kind: KIND.benchAlert }))).toEqual({ appId: 'bench', payload: null });
  });

  test('a disk warning lands where the operator can act on it', () => {
    expect(notificationTarget(card('t', { kind: KIND.storageWarning })).appId).toBe('substrate');
  });

  test('the reload offer has NO destination — its click IS its action', () => {
    expect(notificationTarget(card('t', { kind: KIND.codeReload }))).toBeNull();
  });

  test('never returns a window id — only an app id, so a closed window still works', () => {
    for (const kind of Object.values(KIND)) {
      const t = notificationTarget(card('x', { kind }));
      if (t) {
        expect(typeof t.appId).toBe('string');
        expect(t).not.toHaveProperty('windowId');
        expect(t).not.toHaveProperty('instanceId');
      }
    }
  });

  test('is total on junk', () => {
    expect(notificationTarget(null)).toBeNull();
    expect(notificationTarget({})).toBeNull();
    expect(notificationTarget({ kind: 'invented' })).toBeNull();
  });
});
