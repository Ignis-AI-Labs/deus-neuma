/**
 * A card's click lands where its target says — through the REAL window
 * manager reducer, from both doors: the desk tray card and the clicked OS
 * notification (electron/notify-text.cjs hands the desk the card's id).
 *
 * The window manager carries one payload shape, a bounded string; a sitting
 * travels as the stream-transfer string a torn-out tab uses. Nothing here is
 * faked: real records, the real target map, the real reducer, the real codec.
 */

import { describe, expect, test } from 'vitest';
import { createRequire } from 'node:module';
import { KIND, STANDING, makeRecord } from '../../core/runtime/notification-record.js';
import {
  cardOpenActions, notificationTarget,
} from '../../frontend/app/RelinkShell/NotificationTray/notification-target.js';
import { appIdOf, hydrate, reducer } from '../../frontend/app/windowing/window-manager-reducer.js';
import { decodeStreamTransfer } from '../../frontend/app/RelinkShell/stream-tab-transfer.js';

const require = createRequire(import.meta.url);
const { activationOf } = require('../../electron/notify-text.cjs');

// Every ref a target reads, so each kind takes its richest path.
const REF = { sessionId: 's-1', taskId: 'T-9', runId: 'R-1', imageId: 'img-7', wakeId: 'w1', askId: 'a1' };

const card = (kind, over = {}) => makeRecord({
  id: `card-${kind}`, ts: 1_754_400_000_000, kind, standing: STANDING.neuma,
  title: 'a card', actor: { id: 'lane-1', name: 'Fenna' }, ref: REF, ...over,
});

const land = (record, state) => cardOpenActions(record, state.windows).reduce(reducer, state);
const focused = (state) => state.windows.find((w) => w.id === state.focusedId);

describe('every navigable card lands on a focused window of its own app', () => {
  for (const kind of Object.values(KIND)) {
    const record = card(kind);
    const target = notificationTarget(record);
    if (!target) continue;
    test(`${kind} -> ${target.appId}`, () => {
      for (const start of [hydrate([]), hydrate([...new Set(['chat', target.appId])].map((id) => ({ id })))]) {
        const after = land(record, start);
        expect(appIdOf(after.focusedId)).toBe(target.appId);
      }
    });
  }
});

describe('a card about a sitting opens that sitting', () => {
  test('its stream window carries the sitting the window manager keeps', () => {
    const after = land(card(KIND.turnDone), hydrate([{ id: 'chat' }]));
    const win = focused(after);
    expect(win.id).toBe('chat#2');
    expect(typeof win.payload).toBe('string');
    const seated = decodeStreamTransfer(win.payload);
    expect(seated).toMatchObject({ neumaId: 'lane-1', name: 'Fenna', sessionId: 's-1', kind: 'local' });
  });

  test('with the desk stream closed, it opens first, so the sitting never lands on instance 1', () => {
    const after = land(card(KIND.awaitingAnswer), hydrate([]));
    expect(after.windows.map((w) => w.id)).toEqual(['chat', 'chat#2']);
    expect(after.focusedId).toBe('chat#2');
    expect(decodeStreamTransfer(focused(after).payload).sessionId).toBe('s-1');
  });

  test('a witness card seats a witness tab', () => {
    const after = land(card(KIND.turnDone, { standing: STANDING.witness }), hydrate([{ id: 'chat' }]));
    expect(decodeStreamTransfer(focused(after).payload).kind).toBe('witness');
  });

  test('a turn card without a sitting raises the stream, adding no window', () => {
    const after = land(card(KIND.turnRefused, { ref: {} }), hydrate([{ id: 'chat' }, { id: 'todo' }]));
    expect(after.windows.map((w) => w.id)).toEqual(['chat', 'todo']);
    expect(after.focusedId).toBe('chat');
  });

  test('the reload card opens nothing', () => {
    expect(cardOpenActions(card(KIND.codeReload))).toEqual([]);
  });
});

describe('the clicked OS notification replays the card', () => {
  test('main hands back the card id, and the desk lands it where the card does', () => {
    const record = card(KIND.turnDone);
    const activation = activationOf({ id: record.id, appId: notificationTarget(record).appId, title: 'x' });
    expect(activation).toEqual({ id: record.id, appId: 'chat' });
    const held = [record].find((rec) => rec.id === activation.id);
    const after = land(held, hydrate([{ id: 'chat' }]));
    expect(decodeStreamTransfer(focused(after).payload).sessionId).toBe('s-1');
  });

  test('a malformed id is dropped, never forwarded; the app still opens', () => {
    expect(activationOf({ id: '../x', appId: 'todo' })).toEqual({ appId: 'todo' });
    expect(activationOf({ id: 'a'.repeat(65), appId: 'todo' })).toEqual({ appId: 'todo' });
    expect(activationOf({ id: 42, appId: 'todo' })).toEqual({ appId: 'todo' });
  });

  test('no safe app id, no activation', () => {
    expect(activationOf({ id: 'card-1', appId: 'http://evil' })).toBeNull();
    expect(activationOf(null)).toBeNull();
  });
});
