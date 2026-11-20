/**
 * EACH SITTING CARRIES ITS OWN WORKING GROUND.
 *
 * Design note, 2026-08-29: […]
 *
 * The ground is not decoration: it scopes a portal's frames and its REACH
 * (docs — the focus-ground permission model). So the laws here are about a
 * permission boundary, not a view:
 *
 *   1. a tab's ground is its own, and null means it rides the window's lens
 *      — which every tab starts as, so an untouched desk is untouched;
 *   2. switching WHO sits in a tab keeps the ground — the folder is where the
 *      OPERATOR is working, not something the being brought with it;
 *   3. the ground survives a restart with its sitting;
 *   4. a stored ground is UNTRUSTED, and the model fails CLOSED without a
 *      validator rather than restoring an unchecked path off disk.
 *
 * Pure model, real inputs, no mocks. The validator used here is the REAL one
 * the desk uses (desk-focus.js), never a stand-in.
 */
import { describe, test, expect } from 'vitest';
import {
  emptyTabs, openTab, setTabFocus, retargetTab, tabById, focusTab, focusedTab,
  serializeTabs, normalizeTabs, tearOutPayload, bindSession,
} from '../../core/runtime/tabs-model.js';
import { TAB_KIND } from '../../core/runtime/tab-budget.js';
import { normalizeFocus, groundMark } from '../../frontend/app/RelinkShell/desk-focus.js';

const tab = (id, neumaId = `n-${id}`) => ({
  id, kind: TAB_KIND.local, neumaId, name: `Tab ${id}`, createdAt: '2026-08-29T10:00:00.000Z',
});
const withTabs = (...ids) => ids.reduce((s, id) => openTab(s, tab(id)), emptyTabs());

const REPO = Object.freeze({ kind: 'folder', path: '/workspace/repos/neuma' });
const SITE = Object.freeze({ kind: 'folder', path: '/workspace/repos/project-finikum' });
// A ground saved before Projects were removed (Design note, 2026-11-10 — it loads as nothing.
const SAVED_PROJECT = Object.freeze({ kind: 'project', id: 'acme-site' });

describe('LAW: a sitting’s ground is its own', () => {
  test('a fresh tab rides the window’s lens — an untouched desk is untouched', () => {
    // The whole feature has to be invisible until the operator uses it.
    expect(openTab(emptyTabs(), tab('a')).tabs[0].focus).toBeNull();
  });

  test('THE ASK: two tabs, two grounds, at the same time', () => {
    // […] — this is that, as data.
    let s = withTabs('a', 'b');
    s = setTabFocus(s, 'a', REPO);
    s = setTabFocus(s, 'b', SITE);
    expect(tabById(s, 'a').focus).toEqual(REPO);
    expect(tabById(s, 'b').focus).toEqual(SITE);
  });

  test('switching tabs is what switches the Explorer — the ground rides focus', () => {
    // […]
    // The desk reads the FOCUSED tab's ground; nothing else has to fire.
    let s = withTabs('a', 'b');
    s = setTabFocus(s, 'a', REPO);
    s = setTabFocus(s, 'b', SITE);
    expect(focusedTab(focusTab(s, 'a')).focus).toEqual(REPO);
    expect(focusedTab(focusTab(s, 'b')).focus).toEqual(SITE);
  });

  test('setting one ground touches no other sitting', () => {
    let s = withTabs('a', 'b', 'c');
    s = setTabFocus(s, 'b', REPO);
    expect(tabById(s, 'a').focus).toBeNull();
    expect(tabById(s, 'c').focus).toBeNull();
  });

  test('null hands the sitting back to the window’s lens', () => {
    let s = setTabFocus(withTabs('a'), 'a', REPO);
    s = setTabFocus(s, 'a', null);
    expect(tabById(s, 'a').focus).toBeNull();
  });

  test('a ground for a tab that is gone changes nothing', () => {
    const s = withTabs('a');
    expect(setTabFocus(s, 'ghost', REPO)).toBe(s);
  });

  test('setting the same ground twice is a no-op, not a new state', () => {
    // Identity matters: a fresh object every render would re-run every effect
    // that watches the ground, including the portal frames.
    const s = setTabFocus(withTabs('a'), 'a', REPO);
    expect(setTabFocus(s, 'a', REPO)).toBe(s);
  });
});

describe('LAW: a switch of being keeps the ground', () => {
  test('THE OPERATOR’S FOLDER, not the being’s — swapping who sits keeps it', () => {
    // Changing who is in the chair must not silently move the Explorer out
    // from under the work. The session drops (it belonged to the old being);
    // the ground does not.
    let s = setTabFocus(withTabs('a'), 'a', REPO);
    s = retargetTab(s, 'a', { neumaId: 'cael', name: 'Cael', kind: TAB_KIND.local });
    expect(tabById(s, 'a').neumaId).toBe('cael');
    expect(tabById(s, 'a').sessionId).toBeNull();  // the sitting is the being's
    expect(tabById(s, 'a').focus).toEqual(REPO);   // the ground is the operator's
  });
});

describe('LAW: the ground survives a restart with its sitting', () => {
  test('a round trip through storage returns every ground', () => {
    let s = withTabs('a', 'b', 'c');
    s = setTabFocus(s, 'a', REPO);
    s = setTabFocus(s, 'c', SITE);
    const wire = JSON.parse(JSON.stringify(serializeTabs(s)));
    const back = normalizeTabs(wire, { normalizeFocus });
    expect(back.tabs.map((t) => t.focus)).toEqual([REPO, null, SITE]);
  });
});

describe('LAW: a stored ground is untrusted, and the default fails closed', () => {
  const stored = (focus) => ({
    tabs: [{ ...tab('a'), focus }], focusedId: 'a',
  });

  test('THE FAIL-CLOSED DEFAULT: no validator supplied → no ground restored', () => {
    // A caller that forgets must not get an unchecked filesystem lens off
    // disk. Silence is the safe answer; the tab simply rides the window.
    expect(normalizeTabs(stored(REPO)).tabs[0].focus).toBeNull();
  });

  test('with the REAL validator, a real ground comes back', () => {
    expect(normalizeTabs(stored(REPO), { normalizeFocus }).tabs[0].focus).toEqual(REPO);
  });

  test('a ground saved on a PROJECT costs the ground, never the tab', () => {
    const back = normalizeTabs(stored(SAVED_PROJECT), { normalizeFocus });
    expect(back.tabs).toHaveLength(1);
    expect(back.tabs[0].focus).toBeNull();
  });

  test('a HOSTILE stored ground is refused, and costs the ground, never the tab', () => {
    // localStorage is writable by anything. A relative path, a control
    // character, a wrong shape, a prototype trick — each degrades to "no
    // ground", and the sitting itself survives.
    const hostile = [
      { kind: 'folder', path: '../../etc/passwd' },      // not absolute
      { kind: 'folder', path: '/tmp/x\x00y' },          // control character
      { kind: 'folder' },                                  // no path
      { kind: 'project', id: '' },                         // empty id
      { kind: 'sideways', path: '/tmp' },                  // unknown kind
      'string', 42, [], null,
    ];
    for (const focus of hostile) {
      const back = normalizeTabs(stored(focus), { normalizeFocus });
      expect(back.tabs, JSON.stringify(focus)).toHaveLength(1); // the tab lives
      expect(back.tabs[0].focus, JSON.stringify(focus)).toBeNull();
    }
  });

  test('the validator never lets hostile extras ride along', () => {
    // normalizeFocus field-picks rather than spreading, so nothing else on the
    // stored object can reach the tab.
    const back = normalizeTabs(
      stored({ kind: 'folder', path: REPO.path, evil: 'yes', __proto__: { polluted: true } }),
      { normalizeFocus },
    );
    expect(back.tabs[0].focus).toEqual(REPO);
    expect(Object.keys(back.tabs[0].focus)).toEqual(['kind', 'path']);
  });
});

describe('LAW: a tear-out carries its ground with it (2026-09-01)', () => {
  test('THE LEAK: the payload a sitting opens its own window with names ITS ground', () => {
    // A torn-out sitting used to land on whatever lens the DESK's focused tab
    // held — a different sitting's ground. The payload is where the ground
    // crosses, so the model owns the shape and the law is pinned here.
    let s = withTabs('a');
    s = setTabFocus(s, 'a', REPO);
    s = bindSession(s, 'a', 'sess-1');
    const payload = tearOutPayload(tabById(s, 'a'));
    expect(payload.focus).toEqual(REPO);
    expect(payload.sessionId).toBe('sess-1');
    expect(payload.neumaId).toBe('n-a');
  });

  test('an ungrounded sitting tears out with NO ground — never an invented one', () => {
    const payload = tearOutPayload(tabById(withTabs('a'), 'a'));
    expect(payload.focus).toBeNull();
    expect(payload.sessionId).toBeNull();
  });
});

describe('the strip says WHERE, in one word, and only where there is something to say', () => {
  test('THE CLEANLINESS LAW: a tab riding the window’s lens wears NOTHING', () => {
    // Design note, 2026-08-29: […] Most tabs have no
    // ground of their own, so most strips carry no mark at all and read
    // exactly as they always did. This is the property that makes the feature
    // free to have.
    expect(groundMark(null)).toBeNull();
    expect(groundMark(undefined)).toBeNull();
  });

  test('a folder is its BASENAME — never a path on the strip', () => {
    const m = groundMark(REPO);
    expect(m.short).toBe('neuma');
    expect(m.short).not.toContain('/');
    // ...and the whole truth is one hover away, because two folders called
    // `src` are told apart only by the path.
    expect(m.full).toBe('/workspace/repos/neuma');
  });

  test('a ground saved on a project says nothing rather than inventing a name', () => {
    // Projects are gone (2026-11-10). An honest blank beats a label for
    // something that no longer exists.
    expect(groundMark(SAVED_PROJECT)).toBeNull();
  });

  test('the short mark stays SHORT — it is a word, not a sentence', () => {
    // The strip has a hard budget: the being's name must always win the room.
    for (const focus of [REPO, SITE]) {
      const m = groundMark(focus);
      if (!m) continue;
      expect(m.short.length, m.short).toBeLessThanOrEqual(24);
      expect(m.short).not.toContain('\n');
    }
  });
});
