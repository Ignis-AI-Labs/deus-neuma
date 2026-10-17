// The unsent-draft store's DECISIONS — pure functions called with real inputs
// and real outputs. There is no mock here because there is no IO here: the
// storage shell around these (`loadDraft`/`saveDraft`) is proven where it
// actually lives, in a real browser with real localStorage and a real reload
// (test/e2e/session-restore.spec.js). RULE 0: neither half is claimed by the
// other.

import { describe, it, expect } from 'vitest';
import { draftKeyFor, nextDrafts, DRAFT_UNBOUND } from '../../frontend/app/windowing/window-storage.js';

const A = 'kagipem:session-1754000000001';
const B = 'rugevil:session-1754000000002';

describe('which chat a draft belongs to', () => {
  it('keys by BEING and SITTING, so two chats never share one', () => {
    expect(draftKeyFor('kagipem', 'session-1754000000001')).toBe(A);
    expect(draftKeyFor('kagipem', 'session-1754000000001'))
      .not.toBe(draftKeyFor('kagipem', 'session-1754000000002'));
    expect(draftKeyFor('kagipem', 'session-1')).not.toBe(draftKeyFor('rugevil', 'session-1'));
  });

  it('gives a chat that has not minted a session somewhere to draft', () => {
    // Text typed before the first message must survive a reload too, so an
    // unbound chat drafts into its own bucket rather than nowhere.
    expect(draftKeyFor('kagipem', null)).toBe(`kagipem:${DRAFT_UNBOUND}`);
    expect(draftKeyFor('kagipem', '')).toBe(`kagipem:${DRAFT_UNBOUND}`);
  });

  it('two chats that have not spoken yet do not share one bucket', () => {
    // The composer scopes an unbound chat by its TAB. Without that, opening two
    // fresh tabs on the same being and typing in one would put those words in
    // the other's composer — they would key to the same `<being>:__unbound__`.
    const one = draftKeyFor('kagipem#tab-1', null);
    const two = draftKeyFor('kagipem#tab-2', null);
    expect(one).not.toBe(two);
    expect(one).toBe(`kagipem#tab-1:${DRAFT_UNBOUND}`);
    // Once a sitting exists it is the identity, and the tab drops out of the key
    // — the same chat torn into another window keeps its unsent words.
    expect(draftKeyFor('kagipem', 'session-1754000000001'))
      .toBe(draftKeyFor('kagipem', 'session-1754000000001'));
  });

  it('no being means no chat to draft into', () => {
    expect(draftKeyFor(null, 'session-1')).toBeNull();
    expect(draftKeyFor('', 'session-1')).toBeNull();
    expect(draftKeyFor(undefined, undefined)).toBeNull();
  });
});

describe('what one edit does to the draft map', () => {
  it('keeps the text under its own chat, leaving the others alone', () => {
    const next = nextDrafts({ [B]: 'for rugevil' }, A, 'for kagipem');
    expect(next).toEqual({ [B]: 'for rugevil', [A]: 'for kagipem' });
  });

  it('SENDING LEAVES NOTHING BEHIND — empty text removes the entry', () => {
    const next = nextDrafts({ [A]: 'about to send this', [B]: 'other' }, A, '');
    expect(next).toEqual({ [B]: 'other' });
    expect(A in next).toBe(false);
  });

  it('clearing a draft that was never there writes nothing at all', () => {
    // null is the "no-op" answer — the shell must not touch storage for it.
    expect(nextDrafts({}, A, '')).toBeNull();
    expect(nextDrafts({ [B]: 'x' }, A, '')).toBeNull();
  });

  it('caps the store, dropping the least recently touched', () => {
    let map = {};
    for (let i = 0; i < 60; i += 1) map = nextDrafts(map, `being:session-${i}`, `draft ${i}`, 50);
    const keys = Object.keys(map);
    expect(keys).toHaveLength(50);
    expect(keys[0]).toBe('being:session-10');
    expect(keys.at(-1)).toBe('being:session-59');
  });

  it('re-touching an old draft rescues it from the next prune', () => {
    let map = { [A]: 'the one I keep coming back to' };
    for (let i = 0; i < 5; i += 1) map = nextDrafts(map, `filler:session-${i}`, `x${i}`, 6);
    // A is the OLDEST by insertion and would fall out next; touching it makes
    // it the newest, because own-key order IS the recency the cap reads.
    map = nextDrafts(map, A, 'still working on this', 6);
    for (let i = 5; i < 10; i += 1) map = nextDrafts(map, `filler:session-${i}`, `x${i}`, 6);
    expect(map[A]).toBe('still working on this');
  });

  it('a corrupt or hostile map is treated as empty, never thrown on', () => {
    for (const junk of [null, undefined, 'not an object', 42, []]) {
      expect(() => nextDrafts(junk, A, 'recovered')).not.toThrow();
      expect(nextDrafts(junk, A, 'recovered')).toEqual({ [A]: 'recovered' });
    }
  });

  it('never mutates the map it was given', () => {
    const before = { [A]: 'original' };
    const frozen = Object.freeze({ ...before });
    expect(() => nextDrafts(frozen, B, 'new')).not.toThrow();
    expect(frozen).toEqual(before);
  });
});
