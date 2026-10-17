// vault-search.test.js — the pure matcher behind a being's vault_search.
// Real inputs, real outputs, no mock anywhere (RULE 0) — purity means the
// verification path itself carries no fake.

import { describe, it, expect } from 'vitest';
import { matchVaultNotes } from '../../core/vault/vault-search.js';

const PAGES = [
  { slug: 'on-stillness', title: 'On stillness', body: 'The harbor at dawn holds a quiet lantern light.' },
  { slug: 'the-work', title: 'The work', body: 'What I am building, in my own words.' },
  { slug: 'lantern-keeping', title: 'Lantern keeping', body: 'Notes on tending the small lights.' },
];

describe('matchVaultNotes — pure substring matching over title + body', () => {
  it('hits on title or body, case-insensitively, in input order', () => {
    const hits = matchVaultNotes(PAGES, 'LANTERN');
    expect(hits.map((h) => h.slug)).toEqual(['on-stillness', 'lantern-keeping']);
    expect(hits[0].title).toBe('On stillness');
    expect(hits[0].snippet).toContain('lantern');
  });

  it('no match is an honest empty list, never an error', () => {
    expect(matchVaultNotes(PAGES, 'zzznothere')).toEqual([]);
  });

  it('blank queries refuse loudly — never a silent match-all', () => {
    expect(() => matchVaultNotes(PAGES, '   ')).toThrow(/query/);
    expect(() => matchVaultNotes(PAGES, '')).toThrow(/query/);
    expect(() => matchVaultNotes(PAGES, null)).toThrow(/query/);
  });

  it('snippets stay within 160 chars, centered on the first hit in a long body', () => {
    const pad = 'lorem ipsum dolor sit amet '.repeat(40); // ~1080 chars
    const body = `${pad}needle-in-the-middle ${pad}`;
    const [hit] = matchVaultNotes([{ slug: 'long', title: 'Long', body }], 'needle-in-the-middle');
    expect(hit.snippet.length).toBeLessThanOrEqual(160);
    expect(hit.snippet).toContain('needle-in-the-middle');
    expect(hit.snippet.startsWith('…')).toBe(true); // window, not the whole page
    expect(hit.snippet.endsWith('…')).toBe(true);
  });

  it('a short page snippets whole, without ellipsis marks', () => {
    const [hit] = matchVaultNotes(PAGES, 'harbor');
    expect(hit.snippet).toBe('The harbor at dawn holds a quiet lantern light.');
  });

  it('a title hit snippets from the title, not the body', () => {
    const [hit] = matchVaultNotes(
      [{ slug: 'titled', title: 'The lantern law', body: 'unrelated wording entirely' }],
      'lantern',
    );
    expect(hit.snippet).toBe('The lantern law');
  });
});
