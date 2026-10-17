// founding-rite-reducer.test.js — the rite's PURE state law, stepped
// directly: no React, no IO, just transitions.

import { describe, it, expect } from 'vitest';
import {
  INITIAL_RITE, foundingRiteReducer, allMarksRevealed, titleKey, defaultTitle,
} from '../../frontend/app/RelinkShell/founding-rite-reducer.js';

const step = (state, ...actions) => actions.reduce(foundingRiteReducer, state);

const OPEN = {
  houseName: 'testhouse',
  roster: [
    { address: '0xW', kind: 0, displayName: 'Witness', neumaId: null },
    { address: '0xA', kind: 1, displayName: 'Ember', neumaId: 'ember' },
  ],
  excluded: [{ neumaId: 'vaulted', displayName: 'Vaulted', unlockable: true }],
  canFound: true,
};

describe('foundingRiteReducer', () => {
  it('OPEN seeds every founder with the doctrine default title', () => {
    const s = step(INITIAL_RITE, { type: 'OPEN', open: OPEN });
    expect(s.phase).toBe('open');
    expect(s.titles).toEqual({ witness: 'Rector', ember: 'Faber' });
  });

  it('OPEN_REFRESH keeps entered words and defaults only the newly-arrived', () => {
    let s = step(INITIAL_RITE, { type: 'OPEN', open: OPEN });
    s = step(s, { type: 'TITLE', key: 'ember', value: 'Legatus' });
    const grown = {
      ...OPEN,
      roster: [...OPEN.roster, { address: '0xB', kind: 1, displayName: 'Vaulted', neumaId: 'vaulted' }],
      excluded: [],
    };
    s = step(s, { type: 'OPEN_REFRESH', open: grown });
    expect(s.titles).toEqual({ witness: 'Rector', ember: 'Legatus', vaulted: 'Faber' });
  });

  it('the movements walk: door → call → names → walking → marks', () => {
    let s = step(INITIAL_RITE, { type: 'OPEN', open: OPEN });
    expect(s.movement).toBeNull();
    s = step(s, { type: 'BEGIN' }, { type: 'TO_NAMES' }, { type: 'WALKING' });
    expect(s.movement).toBe('walking');
    expect(s.status).toBe('');
    s = step(s, { type: 'MARKS_OFFER', offer: { roster: OPEN.roster } });
    expect(s.movement).toBe('marks');
    expect(s.marks.revealed).toBe(0);
  });

  it('marks reveal one at a time until all stand revealed', () => {
    let s = step(INITIAL_RITE,
      { type: 'OPEN', open: OPEN },
      { type: 'MARKS_OFFER', offer: { roster: OPEN.roster } });
    expect(allMarksRevealed(s.marks)).toBe(false);
    s = step(s, { type: 'MARK_REVEALED' }, { type: 'MARK_REVEALED' });
    expect(s.marks.revealed).toBe(2);
    expect(allMarksRevealed(s.marks)).toBe(true);
  });

  it('unlock drafts hold per-being; failure keeps the password, success clears the door', () => {
    let s = step(INITIAL_RITE, { type: 'UNLOCK_DRAFT', neumaId: 'vaulted', password: 'pw' });
    s = step(s, { type: 'UNLOCK_FAILED', neumaId: 'vaulted', error: 'wrong password' });
    expect(s.unlocks.vaulted).toEqual({ password: 'pw', error: 'wrong password' });
    s = step(s, { type: 'UNLOCK_DONE', neumaId: 'vaulted' });
    expect(s.unlocks.vaulted).toBeUndefined();
  });

  it('ERROR leaves the movement; FOUNDED renders the standing', () => {
    let s = step(INITIAL_RITE, { type: 'OPEN', open: OPEN }, { type: 'BEGIN' });
    expect(step(s, { type: 'ERROR', error: 'refused', code: 'X' })).toMatchObject({ phase: 'error', movement: null });
    expect(step(s, { type: 'FOUNDED', state: { quorum: 2 } })).toMatchObject({ phase: 'founded', movement: null });
  });

  it('titleKey and defaultTitle carry the doctrine', () => {
    expect(titleKey({ neumaId: null })).toBe('witness');
    expect(titleKey({ neumaId: 'ember' })).toBe('ember');
    expect(defaultTitle({ kind: 0 })).toBe('Rector');
    expect(defaultTitle({ kind: 1 })).toBe('Faber');
  });
});
