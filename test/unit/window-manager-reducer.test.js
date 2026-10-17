/**
 * Tests for the pure window-manager reducer
 * (frontend/app/windowing/window-manager-reducer.js): open/close/focus(raise)/
 * toggle and focus hand-off, plus the instance-id law (appIdOf /
 * instanceOrdinal / nextInstanceId / OPEN_NEW) and the hydration boundary
 * validator. Minimizing is an in-place window-shade owned by the window,
 * not the manager — so there is no minimize/restore here.
 */

import { describe, expect, test } from 'vitest';
import {
  reducer,
  initialState,
  hydrate,
  appIdOf,
  instanceOrdinal,
  nextInstanceId,
  frontmostInstanceId,
  dedupeById,
  isValidWindowId,
} from '../../frontend/app/windowing/window-manager-reducer.js';

const run = (actions, start = initialState) => actions.reduce(reducer, start);
const win = (s, id) => s.windows.find((w) => w.id === id);

describe('window-manager reducer', () => {
  test('OPEN adds a focused window on top', () => {
    const s = run([{ type: 'OPEN', id: 'chat' }]);
    expect(s.windows).toHaveLength(1);
    expect(win(s, 'chat')).toMatchObject({ id: 'chat' });
    expect(s.focusedId).toBe('chat');
  });

  test('OPEN on an existing window raises + focuses it (no duplicate)', () => {
    const s = run([
      { type: 'OPEN', id: 'chat' },
      { type: 'OPEN', id: 'avatar' },
      { type: 'OPEN', id: 'chat' },
    ]);
    expect(s.windows).toHaveLength(2);
    expect(s.focusedId).toBe('chat');
    expect(win(s, 'chat').z).toBeGreaterThan(win(s, 'avatar').z);
  });

  test('FOCUS raises a window above the others', () => {
    const s = run([
      { type: 'OPEN', id: 'chat' },
      { type: 'OPEN', id: 'avatar' },
      { type: 'FOCUS', id: 'chat' },
    ]);
    expect(s.focusedId).toBe('chat');
    expect(win(s, 'chat').z).toBeGreaterThan(win(s, 'avatar').z);
  });

  test('FOCUS on the already-focused or an absent window is a no-op', () => {
    const base = run([{ type: 'OPEN', id: 'chat' }]);
    expect(reducer(base, { type: 'FOCUS', id: 'chat' })).toBe(base);
    expect(reducer(base, { type: 'FOCUS', id: 'ghost' })).toBe(base);
  });

  test('CLOSE removes a window and reassigns focus to the frontmost', () => {
    const s = run([
      { type: 'OPEN', id: 'chat' },
      { type: 'OPEN', id: 'avatar' },
      { type: 'CLOSE', id: 'avatar' },
    ]);
    expect(s.windows).toHaveLength(1);
    expect(win(s, 'avatar')).toBeUndefined();
    expect(s.focusedId).toBe('chat');
  });

  test('CLOSE of an absent window is a no-op', () => {
    const base = run([{ type: 'OPEN', id: 'chat' }]);
    expect(reducer(base, { type: 'CLOSE', id: 'ghost' })).toBe(base);
  });

  test('TOGGLE spawns when closed, focuses when already open', () => {
    const spawned = run([{ type: 'TOGGLE', id: 'chat' }]);
    expect(win(spawned, 'chat')).toBeDefined();
    expect(spawned.focusedId).toBe('chat');

    const twoUp = run([{ type: 'OPEN', id: 'avatar' }], spawned); // avatar focused
    const back = reducer(twoUp, { type: 'TOGGLE', id: 'chat' });
    expect(back.focusedId).toBe('chat');
    expect(win(back, 'chat').z).toBeGreaterThan(win(back, 'avatar').z);
  });

  test('hydrate builds state from a persisted open-set', () => {
    const s = hydrate([{ id: 'chat' }, { id: 'avatar' }]);
    expect(s.windows).toHaveLength(2);
    expect(s.focusedId).toBe('avatar'); // last seeded is frontmost
    expect(s.nextZ).toBe(3);
  });

  test('reducer never mutates input state', () => {
    const frozen = Object.freeze({ ...initialState, windows: Object.freeze([]) });
    expect(() => reducer(frozen, { type: 'OPEN', id: 'chat' })).not.toThrow();
    expect(frozen.windows).toHaveLength(0);
  });
});

describe('instance id helpers', () => {
  test('appIdOf strips the #N suffix and leaves bare ids alone', () => {
    expect(appIdOf('terminal')).toBe('terminal');
    expect(appIdOf('terminal#2')).toBe('terminal');
    expect(appIdOf('terminal#10')).toBe('terminal');
    expect(appIdOf('app3')).toBe('app3'); // digits in a base id are not a suffix
    expect(appIdOf('#2')).toBe('');
    expect(appIdOf('##2')).toBe('');
    expect(appIdOf(' terminal#2')).toBe(' terminal'); // junk stays in the base — registry rejects it
  });

  test('instanceOrdinal is 1 for bare ids, N for #N (N >= 2)', () => {
    expect(instanceOrdinal('terminal')).toBe(1);
    expect(instanceOrdinal('app3')).toBe(1);
    expect(instanceOrdinal('terminal#2')).toBe(2);
    expect(instanceOrdinal('terminal#10')).toBe(10);
  });

  test('instanceOrdinal treats malformed suffixes as instance 1', () => {
    const malformed = [
      'terminal#1', // first instance is the BARE id — #1 never exists
      'terminal#0',
      'terminal#abc',
      'terminal#',
      'terminal#02', // leading zero is not system-generated
      'terminal#2x',
      'terminal#2 ',
      'terminal#2#3',
      '##2',
    ];
    for (const id of malformed) expect(instanceOrdinal(id)).toBe(1);
  });

  test('nextInstanceId: bare id first, then lowest free ordinal >= 2', () => {
    expect(nextInstanceId([], 'terminal')).toBe('terminal');
    expect(nextInstanceId([{ id: 'terminal', z: 1 }], 'terminal')).toBe('terminal#2');
    expect(
      nextInstanceId([{ id: 'terminal', z: 1 }, { id: 'terminal#2', z: 2 }], 'terminal'),
    ).toBe('terminal#3');
    // #2 was closed while #3 lives — the freed ordinal is reclaimed
    expect(
      nextInstanceId([{ id: 'terminal', z: 1 }, { id: 'terminal#3', z: 2 }], 'terminal'),
    ).toBe('terminal#2');
    // the bare slot itself is reclaimed first
    expect(
      nextInstanceId([{ id: 'terminal#2', z: 1 }, { id: 'terminal#3', z: 2 }], 'terminal'),
    ).toBe('terminal');
  });

  test("nextInstanceId ignores other apps' windows", () => {
    const windows = [{ id: 'chat', z: 1 }, { id: 'chat#2', z: 2 }, { id: 'terminal', z: 3 }];
    expect(nextInstanceId(windows, 'terminal')).toBe('terminal#2');
  });
});

describe('OPEN_NEW', () => {
  test('first spawn opens the bare appId, focused', () => {
    const s = run([{ type: 'OPEN_NEW', appId: 'terminal' }]);
    expect(s.windows.map((w) => w.id)).toEqual(['terminal']);
    expect(s.focusedId).toBe('terminal');
  });

  test('every spawn is a NEW window: #2, then #3', () => {
    const s = run([
      { type: 'OPEN_NEW', appId: 'terminal' },
      { type: 'OPEN_NEW', appId: 'terminal' },
      { type: 'OPEN_NEW', appId: 'terminal' },
    ]);
    expect(s.windows.map((w) => w.id)).toEqual(['terminal', 'terminal#2', 'terminal#3']);
    expect(s.focusedId).toBe('terminal#3');
  });

  test('reclaims the lowest freed ordinal after CLOSE of #2 while #3 lives', () => {
    const s = run([
      { type: 'OPEN_NEW', appId: 'terminal' },
      { type: 'OPEN_NEW', appId: 'terminal' },
      { type: 'OPEN_NEW', appId: 'terminal' },
      { type: 'CLOSE', id: 'terminal#2' },
      { type: 'OPEN_NEW', appId: 'terminal' },
    ]);
    expect(s.windows.map((w) => w.id).sort()).toEqual(['terminal', 'terminal#2', 'terminal#3']);
    expect(s.focusedId).toBe('terminal#2');
  });

  test('the spawned window lands focused and on top of the stack', () => {
    const s = run([
      { type: 'OPEN', id: 'chat' },
      { type: 'OPEN_NEW', appId: 'terminal' },
      { type: 'OPEN_NEW', appId: 'terminal' },
    ]);
    const maxZ = Math.max(...s.windows.map((w) => w.z));
    expect(win(s, 'terminal#2').z).toBe(maxZ);
    expect(s.focusedId).toBe('terminal#2');
  });

  test("ordinal allocation ignores other apps' windows", () => {
    const s = run([
      { type: 'OPEN', id: 'chat' },
      { type: 'OPEN', id: 'avatar' },
      { type: 'OPEN_NEW', appId: 'terminal' },
      { type: 'OPEN_NEW', appId: 'terminal' },
    ]);
    expect(win(s, 'terminal')).toBeDefined();
    expect(win(s, 'terminal#2')).toBeDefined();
    expect(win(s, 'chat#2')).toBeUndefined();
    expect(win(s, 'avatar#2')).toBeUndefined();
  });

  test('OPEN_NEW never mutates input state', () => {
    const frozen = Object.freeze({ ...initialState, windows: Object.freeze([]) });
    expect(() => reducer(frozen, { type: 'OPEN_NEW', appId: 'terminal' })).not.toThrow();
    expect(frozen.windows).toHaveLength(0);
  });
});

describe('spawn payloads (the editor opens on a file)', () => {
  test('OPEN_NEW stores a string payload with the born window', () => {
    const s = run([
      { type: 'OPEN_NEW', appId: 'editor', payload: '/repo/a.js' },
      { type: 'OPEN_NEW', appId: 'editor', payload: '/repo/b.js' },
    ]);
    expect(win(s, 'editor')).toMatchObject({ id: 'editor', payload: '/repo/a.js' });
    expect(win(s, 'editor#2')).toMatchObject({ id: 'editor#2', payload: '/repo/b.js' });
  });

  test('a payload-less spawn stores no payload key (byte-identical open-set)', () => {
    const s = run([{ type: 'OPEN_NEW', appId: 'terminal' }]);
    expect(win(s, 'terminal')).toEqual({ id: 'terminal', z: 1 });
  });

  test('hostile payloads degrade to undefined — never stored', () => {
    const hostiles = [
      { payload: 42 },
      { payload: null },
      { payload: {} },
      { payload: ['x'] },
      { payload: '' },
      { payload: 'x'.repeat(4097) }, // over the cap
    ];
    for (const h of hostiles) {
      const s = run([{ type: 'OPEN_NEW', appId: 'editor', ...h }]);
      expect(win(s, 'editor')).toEqual({ id: 'editor', z: 1 });
    }
  });

  test('hydrate carries a valid payload and drops a hostile one', () => {
    const s = hydrate([
      { id: 'editor', payload: '/repo/a.js' },
      { id: 'editor#2', payload: { evil: true } },
      { id: 'terminal' },
    ]);
    expect(win(s, 'editor').payload).toBe('/repo/a.js');
    expect(win(s, 'editor#2')).toEqual({ id: 'editor#2', z: 2 });
    expect(win(s, 'terminal')).toEqual({ id: 'terminal', z: 3 });
  });
});

describe('REPAYLOAD (the tree renamed a file an editor has open)', () => {
  const twoEditors = () => run([
    { type: 'OPEN_NEW', appId: 'editor', payload: '/repo/a.js' },
    { type: 'OPEN_NEW', appId: 'editor', payload: '/repo/b.js' },
    { type: 'OPEN_NEW', appId: 'terminal' },
  ]);

  test('retargets exactly the windows whose payload matches, across instances', () => {
    const s = reducer(twoEditors(), { type: 'REPAYLOAD', appId: 'editor', from: '/repo/a.js', to: '/repo/renamed.js' });
    expect(win(s, 'editor').payload).toBe('/repo/renamed.js');
    expect(win(s, 'editor#2').payload).toBe('/repo/b.js'); // untouched
    expect(win(s, 'terminal')).toEqual({ id: 'terminal', z: 3 }); // other apps untouched
  });

  test('no match is a no-op (same state reference)', () => {
    const base = twoEditors();
    expect(reducer(base, { type: 'REPAYLOAD', appId: 'editor', from: '/repo/ghost.js', to: '/repo/x.js' })).toBe(base);
  });

  test('hostile from/to is a no-op — never a malformed payload', () => {
    const base = twoEditors();
    for (const a of [
      { type: 'REPAYLOAD', appId: 'editor', from: 42, to: '/repo/x.js' },
      { type: 'REPAYLOAD', appId: 'editor', from: '/repo/a.js', to: {} },
      { type: 'REPAYLOAD', appId: 'editor', from: '/repo/a.js', to: '' },
    ]) {
      expect(reducer(base, a)).toBe(base);
    }
  });
});

describe('frontmostInstanceId (dock plain-click focus)', () => {
  test('null when the app has no open instance', () => {
    expect(frontmostInstanceId([], 'terminal')).toBe(null);
    expect(frontmostInstanceId([{ id: 'chat', z: 1 }], 'terminal')).toBe(null);
  });

  test('picks the highest-z instance among many', () => {
    const windows = [
      { id: 'terminal', z: 3 },
      { id: 'terminal#2', z: 7 },
      { id: 'terminal#3', z: 5 },
    ];
    expect(frontmostInstanceId(windows, 'terminal')).toBe('terminal#2');
  });

  test("other apps' windows never win, whatever their z", () => {
    const windows = [
      { id: 'chat', z: 99 },
      { id: 'avatar', z: 42 },
      { id: 'terminal#2', z: 2 },
      { id: 'terminal', z: 1 },
    ];
    expect(frontmostInstanceId(windows, 'terminal')).toBe('terminal#2');
  });

  test('tracks the reducer: the latest OPEN_NEW spawn is the frontmost', () => {
    const s = run([
      { type: 'OPEN_NEW', appId: 'terminal' },
      { type: 'OPEN_NEW', appId: 'terminal' },
      { type: 'OPEN', id: 'chat' },
      { type: 'FOCUS', id: 'terminal' },
    ]);
    expect(frontmostInstanceId(s.windows, 'terminal')).toBe('terminal');
    const raised = reducer(s, { type: 'FOCUS', id: 'terminal#2' });
    expect(frontmostInstanceId(raised.windows, 'terminal')).toBe('terminal#2');
  });
});

describe('dedupeById (hydration seed)', () => {
  test('drops later duplicates — first occurrence wins, order preserved', () => {
    const list = [
      { id: 'terminal' },
      { id: 'chat' },
      { id: 'terminal' },
      { id: 'terminal#2' },
      { id: 'chat' },
    ];
    expect(dedupeById(list).map((w) => w.id)).toEqual(['terminal', 'chat', 'terminal#2']);
  });

  test('leaves an already-unique list intact and handles empty input', () => {
    expect(dedupeById([])).toEqual([]);
    const list = [{ id: 'chat' }, { id: 'terminal' }];
    expect(dedupeById(list).map((w) => w.id)).toEqual(['chat', 'terminal']);
  });

  test('never mutates its input', () => {
    const list = Object.freeze([Object.freeze({ id: 'chat' }), Object.freeze({ id: 'chat' })]);
    expect(() => dedupeById(list)).not.toThrow();
    expect(list).toHaveLength(2);
  });
});

describe('isValidWindowId (hydration boundary)', () => {
  const registry = Object.freeze({
    terminal: Object.freeze({ multiInstance: true }),
    chat: Object.freeze({}),
    app3: Object.freeze({}),
  });

  test('bare registered ids survive; suffixed only for multiInstance apps', () => {
    expect(isValidWindowId(registry, 'terminal')).toBe(true);
    expect(isValidWindowId(registry, 'chat')).toBe(true);
    expect(isValidWindowId(registry, 'app3')).toBe(true); // digits in base ids are legal
    expect(isValidWindowId(registry, 'terminal#2')).toBe(true);
    expect(isValidWindowId(registry, 'terminal#10')).toBe(true);
    expect(isValidWindowId(registry, 'chat#2')).toBe(false); // not multiInstance
  });

  test('unknown bases and malformed ordinals are dropped', () => {
    const dropped = [
      'ghost',
      'ghost#2',
      'terminal#1',
      'terminal#0',
      'terminal#11', // above the hydratable cap
      'terminal#02',
      'terminal#abc',
      'terminal#',
      'terminal#2#3',
      '#2',
      '##2',
      '',
      ' terminal#2',
      'terminal#2 ',
    ];
    for (const id of dropped) expect(isValidWindowId(registry, id)).toBe(false);
  });

  test('hostile and non-string ids never throw and never pass', () => {
    const hostiles = [
      null,
      undefined,
      42,
      {},
      [],
      '__proto__', // must not resolve through the prototype chain
      'constructor',
      'terminal#2' + String.fromCharCode(0), // NUL-suffixed
      'terminal' + String.fromCharCode(8232) + '#2', // line separator in base
      String.fromCharCode(60, 115, 99, 114, 105, 112, 116, 62), // <script>
      'terminal#' + String.fromCharCode(65534), // non-character
    ];
    for (const id of hostiles) {
      expect(() => isValidWindowId(registry, id)).not.toThrow();
      expect(isValidWindowId(registry, id)).toBe(false);
    }
  });
});
