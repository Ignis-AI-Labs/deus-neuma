/**
 * A HOUSE CLOCK sitting lands in a stream window of its own, even with the
 * desk stream closed. Instance 1 is the desk's own stream and reads no
 * payload, so OPEN SITTING (HouseClockApp.jsx onOpenSitting) opens the desk
 * stream first, the way a tray card does (openSittingActions). Proven through
 * the real window-manager reducer and the real stream-transfer codec.
 */

import { describe, expect, test } from 'vitest';
import { hydrate, reducer } from '../../frontend/app/windowing/window-manager-reducer.js';
import {
  decodeStreamTransfer, encodeStreamTransfer, openSittingActions,
} from '../../frontend/app/RelinkShell/stream-tab-transfer.js';

describe('a HOUSE CLOCK sitting lands in a stream window of its own', () => {
  const payload = encodeStreamTransfer({ id: 'wake-s-1', kind: 'local', neumaId: 'lane-1', name: 'Fenna', sessionId: 's-1', focus: null });

  test('a lone OPEN_NEW with the desk stream closed becomes instance 1, which reads no payload', () => {
    const after = reducer(hydrate([]), { type: 'OPEN_NEW', appId: 'chat', payload });
    expect(after.windows.map((w) => w.id)).toEqual(['chat']);
  });

  test('with the desk stream closed, it opens first and the sitting lands beside it', () => {
    const after = openSittingActions(payload, []).reduce(reducer, hydrate([]));
    expect(after.windows.map((w) => w.id)).toEqual(['chat', 'chat#2']);
    expect(after.focusedId).toBe('chat#2');
    expect(decodeStreamTransfer(after.windows[1].payload)).toMatchObject({ neumaId: 'lane-1', sessionId: 's-1' });
  });

  test('with the desk stream open, the sitting opens its own window and nothing else', () => {
    const after = openSittingActions(payload, [{ id: 'chat' }]).reduce(reducer, hydrate([{ id: 'chat' }]));
    expect(after.windows.map((w) => w.id)).toEqual(['chat', 'chat#2']);
    expect(decodeStreamTransfer(after.windows[1].payload).sessionId).toBe('s-1');
  });
});
