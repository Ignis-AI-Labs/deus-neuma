/**
 * The pure core of the Explorer's FAVORITES/RECENTS shelf: the boundary
 * validator over anything claiming to be a shelf, the MRU recording the open
 * gesture rides, pin/unpin, dismiss, and the row label. Proven directly with
 * real inputs — no React, no mocks (RULE 0). Hostile payloads that need
 * control characters are built with String.fromCharCode (the harness mangles
 * literal escapes — feedback_harness_escape_mangling).
 */

import { describe, test, expect } from 'vitest';
import {
  RECENTS_CAP, FAVORITES_CAP,
  normalizeShelf, recordRecent, toggleFavorite, removeRecent, isFavorite,
  shelfEntryLabel, normalizeShelfSections,
} from '../../frontend/app/RelinkShell/folder-shelf.js';

const C = String.fromCharCode;
const EMPTY = normalizeShelf(null);

describe('normalizeShelf — the boundary validator', () => {
  test('a valid shelf passes, rebuilt by explicit field-picking (extras dropped)', () => {
    const out = normalizeShelf({ favorites: ['/a'], recents: ['/b', '/c'], smuggled: 1 });
    expect(out).toEqual({ favorites: ['/a'], recents: ['/b', '/c'] });
    expect(Object.keys(out)).toEqual(['favorites', 'recents']);
  });

  test('non-objects, null, and arrays degrade to an empty shelf', () => {
    for (const raw of [null, undefined, 'shelf', 42, true, ['/a']]) {
      expect(normalizeShelf(raw)).toEqual({ favorites: [], recents: [] });
    }
  });

  test('relative paths, control-char paths, and non-strings drop; valid entries survive in order', () => {
    const out = normalizeShelf({
      favorites: ['rel/x', `/tmp/a${C(0)}b`, '/keep', 7, null],
      recents: ['', '/first', { path: '/never' }, `/x${C(27)}`, '/second'],
    });
    expect(out).toEqual({ favorites: ['/keep'], recents: ['/first', '/second'] });
  });

  test('duplicates dedupe with first occurrence winning — MRU order survives the wash', () => {
    expect(normalizeShelf({ recents: ['/a', '/b', '/a'] }).recents).toEqual(['/a', '/b']);
  });

  test('recents cap holds; favorites cap only bounds hostile storage', () => {
    const flood = Array.from({ length: 100 }, (_, i) => `/r/${i}`);
    const out = normalizeShelf({ favorites: flood, recents: flood });
    expect(out.recents).toHaveLength(RECENTS_CAP);
    expect(out.favorites).toHaveLength(FAVORITES_CAP);
    expect(out.recents[0]).toBe('/r/0');
  });

  test('a hostile __proto__ key (as parsed JSON delivers it) pollutes nothing', () => {
    const raw = JSON.parse('{"favorites":["/a"],"__proto__":{"polluted":true}}');
    const out = normalizeShelf(raw);
    expect(out.favorites).toEqual(['/a']);
    expect({}.polluted).toBeUndefined();
  });

  test('the shelf and its lists come back frozen', () => {
    const out = normalizeShelf({ recents: ['/a'] });
    expect(Object.isFrozen(out)).toBe(true);
    expect(Object.isFrozen(out.recents)).toBe(true);
  });
});

describe('recordRecent — the open gesture writes MRU', () => {
  test('a fresh path lands at the head', () => {
    const s = recordRecent(recordRecent(EMPTY, '/a'), '/b');
    expect(s.recents).toEqual(['/b', '/a']);
  });

  test('a re-open bumps to the head, never duplicates', () => {
    const s = recordRecent(recordRecent(recordRecent(EMPTY, '/a'), '/b'), '/a');
    expect(s.recents).toEqual(['/a', '/b']);
  });

  test('the cap evicts the oldest, not the newest', () => {
    let s = EMPTY;
    for (let i = 0; i <= RECENTS_CAP; i += 1) s = recordRecent(s, `/r/${i}`);
    expect(s.recents).toHaveLength(RECENTS_CAP);
    expect(s.recents[0]).toBe(`/r/${RECENTS_CAP}`);
    expect(s.recents).not.toContain('/r/0');
  });

  test('an invalid path records nothing; favorites are never touched', () => {
    const base = toggleFavorite(recordRecent(EMPTY, '/a'), '/pin');
    for (const bad of ['rel/x', `/a${C(1)}`, '', 42]) {
      expect(recordRecent(base, bad)).toEqual(base);
    }
    expect(recordRecent(base, '/b').favorites).toEqual(['/pin']);
  });
});

describe('toggleFavorite / removeRecent / isFavorite', () => {
  test('pin lands at the head of favorites; unpin removes exactly it', () => {
    const pinned = toggleFavorite(toggleFavorite(EMPTY, '/a'), '/b');
    expect(pinned.favorites).toEqual(['/b', '/a']);
    expect(isFavorite(pinned, '/a')).toBe(true);
    const unpinned = toggleFavorite(pinned, '/a');
    expect(unpinned.favorites).toEqual(['/b']);
    expect(isFavorite(unpinned, '/a')).toBe(false);
  });

  test('pinning never touches recents; dismissing a recent never unpins', () => {
    let s = recordRecent(EMPTY, '/a');
    s = toggleFavorite(s, '/a');
    expect(s.recents).toEqual(['/a']);
    s = removeRecent(s, '/a');
    expect(s.recents).toEqual([]);
    expect(s.favorites).toEqual(['/a']);
  });

  test('removeRecent of an absent path is a clean no-op', () => {
    const s = recordRecent(EMPTY, '/a');
    expect(removeRecent(s, '/never')).toEqual(s);
  });
});

describe('shelfEntryLabel — what a row shows', () => {
  test('name is the basename, hint is the parent path', () => {
    expect(shelfEntryLabel('/workspace/repos/neuma')).toEqual({ name: 'neuma', hint: '/workspace/repos' });
  });

  test('trailing slashes tolerated; a root-level folder hints nothing', () => {
    expect(shelfEntryLabel('/repos/voice/')).toEqual({ name: 'voice', hint: '/repos' });
    expect(shelfEntryLabel('/solo')).toEqual({ name: 'solo', hint: '' });
  });
});

describe('normalizeShelfSections — both open by default, folds persist', () => {
  test('malformed input degrades to both open', () => {
    for (const raw of [null, 'x', 9, ['a'], { favorites: 'yes' }]) {
      expect(normalizeShelfSections(raw)).toEqual({ favorites: true, recents: true });
    }
  });

  test('explicit booleans survive; extras drop', () => {
    expect(normalizeShelfSections({ favorites: false, recents: true, junk: 1 }))
      .toEqual({ favorites: false, recents: true });
  });
});

// UX-006 (#227) — WITNESSED 2026-07-30: the operator had `C:\repos\Neuma Testing`
// open and visible in the Explorer while the panel directly beneath it read
// […] and […].
// `validFolderPath` required `startsWith('/')`, so cleanList silently dropped
// every Windows folder it was ever given.
describe('WINDOWS folders survive the shelf (#227)', () => {
  const WIN = 'C:\\repos\\Neuma Testing';

  test('a Windows favourite is kept, not silently discarded', () => {
    const out = normalizeShelf({ favorites: [WIN], recents: [WIN] });
    expect(out.favorites).toEqual([WIN]);
    expect(out.recents).toEqual([WIN]);
  });

  test('a UNC share is kept too', () => {
    expect(normalizeShelf({ favorites: ['\\\\srv\\share\\docs'] }).favorites)
      .toEqual(['\\\\srv\\share\\docs']);
  });

  test('pin and recent still work end to end on a Windows path', () => {
    let shelf = recordRecent(EMPTY, WIN);
    shelf = toggleFavorite(shelf, WIN);
    expect(isFavorite(shelf, WIN)).toBe(true);
    expect(shelf.recents).toContain(WIN);
  });

  test('the label names the folder and hints its parent', () => {
    // `lastIndexOf('/')` gave a Windows path the whole string as its "name"
    // and an empty hint.
    expect(shelfEntryLabel(WIN)).toEqual({ name: 'Neuma Testing', hint: 'C:\\repos' });
  });

  test('a relative path is still refused — absolute only', () => {
    expect(normalizeShelf({ favorites: ['repos/thing', 'notes\\draft'] }).favorites).toEqual([]);
  });

  test('control characters are still refused on either platform', () => {
    expect(normalizeShelf({ favorites: ['C:\\repos\\bad\u0007name'] }).favorites).toEqual([]);
  });
});
