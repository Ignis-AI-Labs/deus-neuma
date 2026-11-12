// What a batch titling job says on the desk (titling-view.js) and the ALL register's merge and
// search (all-chats-view.js). Pure functions on real values.
import { describe, expect, it } from 'vitest';
import { timeLeft, titlingNote } from '../../frontend/app/RelinkShell/titling-view.js';
import { mergeAllChats, searchAllRows } from '../../frontend/app/RelinkShell/all-chats-view.js';

const at = Date.parse('2026-11-12T12:00:00Z');
const job = (over) => ({ state: 'running', done: 0, total: 10, titled: 0, failed: 0, skipped: 0, skipReason: null, startedAt: '2026-11-12T12:00:00Z', ...over });

describe('titlingNote', () => {
  it('counts while it runs, with the time left once two have landed', () => {
    expect(titlingNote(job({ done: 1 }), null, at + 5_000)).toBe('NAMING 1 / 10');
    expect(titlingNote(job({ done: 2 }), null, at + 10_000)).toBe('NAMING 2 / 10 · ABOUT 40 S LEFT');
    expect(titlingNote(job({ done: 2 }), null, at + 20_000)).toBe('NAMING 2 / 10 · ABOUT 1 MIN LEFT');
    expect(titlingNote(job({ done: 2 }), null, at + 60_000)).toBe('NAMING 2 / 10 · ABOUT 4 MIN LEFT');
  });
  it('says how it ended, and never reads a failure as nothing to name', () => {
    expect(titlingNote(job({ state: 'done', done: 3, total: 3, titled: 3 }), null, at)).toBe('NAMED 3 CHATS');
    expect(titlingNote(job({ state: 'done', done: 1, total: 1, titled: 1 }), null, at, ['COUNCIL', 'COUNCILS'])).toBe('NAMED 1 COUNCIL');
    expect(titlingNote(job({ state: 'done', done: 3, total: 3, titled: 2, failed: 1 }), null, at)).toBe('NAMED 2 CHATS · 1 FAILED');
    expect(titlingNote(job({ state: 'done', done: 0, total: 0 }), null, at)).toBe('NOTHING TO NAME');
    expect(titlingNote(job({ state: 'done', done: 2, total: 2, skipped: 2, skipReason: 'empty' }), null, at)).toBe('NOTHING TO NAME');
    expect(titlingNote(job({ state: 'done', done: 2, total: 2, skipped: 2, skipReason: 'no-route' }), null, at)).toMatch(/NO MODEL TO NAME WITH/);
    expect(titlingNote(job({ state: 'cancelled', done: 2, titled: 2 }), null, at)).toBe('STOPPED — NAMED 2 CHATS');
    expect(titlingNote(job({ state: 'failed', error: 'disk full' }), null, at)).toBe('TITLING FAILED — DISK FULL');
    expect(titlingNote(null, 'could not reach the platform', at)).toBe('TITLING FAILED — COULD NOT REACH THE PLATFORM');
    expect(titlingNote(null, null, at)).toBe('');
  });
  it('no time left before two have landed, or once all have', () => {
    expect(timeLeft(job({ done: 1 }), at + 10_000)).toBe('');
    expect(timeLeft(job({ done: 10 }), at + 10_000)).toBe('');
  });
});

describe('the ALL register', () => {
  const lists = [
    { member: { neumaId: 'a', name: 'Ash' }, sessions: ['session-1000', 'session-3000', 'council-9'] },
    { member: { neumaId: 'b', name: 'Birch' }, sessions: ['session-2000'] },
  ];
  it('every neuma\'s one-on-ones together, newest first, each naming whose it is', () => {
    const rows = mergeAllChats(lists, { 'b:session-2000': 'Roots' });
    expect(rows.map((r) => `${r.name}:${r.id}`)).toEqual(['Ash:session-3000', 'Birch:session-2000', 'Ash:session-1000']);
    expect(rows[1]).toMatchObject({ neumaId: 'b', label: 'Roots', named: true });
  });
  it('a search keeps a title, a neuma\'s name, or that neuma\'s own content match', () => {
    const rows = mergeAllChats(lists, { 'b:session-2000': 'Roots' });
    expect(searchAllRows(rows, 'roots', new Map()).map((r) => r.id)).toEqual(['session-2000']);
    expect(searchAllRows(rows, 'ash', new Map()).map((r) => r.id)).toEqual(['session-3000', 'session-1000']);
    const found = searchAllRows(rows, 'void', new Map([['a:session-1000', { excerpt: '…the void…' }]]));
    expect(found).toEqual([expect.objectContaining({ id: 'session-1000', excerpt: '…the void…' })]);
  });
});
