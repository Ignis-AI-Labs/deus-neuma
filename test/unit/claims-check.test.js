/**
 * THE CLAIMS CHECK — the pure law of slice 12
 * (campaign plan §7). Real inputs, real outputs; nothing to fake.
 *
 * Proven: […] reads as a figure and a comparison to a named
 * product; a company's NEVER ASSERTED claim reads high and its MAY BE
 * ASSERTED claim reads approved (filed nowhere); token and health talk read
 * high, while a context-window "tokens" does not; the matter key changes when
 * the open claims change; the LEGAL chip says what it found and where the
 * legal office stands. (The AI disclosure, which rode here as a line in the
 * post's words, now lives in its metadata: disclosure-metadata.test.js.)
 */
import { describe, test, expect } from 'vitest';
import {
  claimHits, kitClaimsOf, openHits, severityOf, draftMatterId, draftMatter, legalReplyMatter,
} from '../../backend/services/marketing/claims-check.js';
import { areasOfCommit } from '../../backend/services/legal/regulated-areas.js';
import { legalChipWords } from '../../frontend/app/RelinkShell/legal-chip/legal-chip-words.js';

const kinds = (hits) => hits.map((h) => h.kind);

describe('claims check — what a draft claims', () => {
  test('"3x faster than X" is a figure and a comparison to a named product', () => {
    const hits = claimHits('Neuma is 3x faster than X on the same card.');
    expect(kinds(hits)).toEqual(['figure', 'comparison']);
    expect(hits.find((h) => h.kind === 'comparison').match).toBe('faster than X');
    expect(severityOf(hits)).toBe('medium');
  });

  test('the company\'s own lists: never asserted reads high, may be asserted reads approved', () => {
    const claims = kitClaimsOf({ claims: { approved: ['runs 100% on your own machine'], forbidden: ['clinically proven'] } });
    const hits = claimHits('Runs 100% on your own machine. Clinically proven calm.', claims);
    const figure = hits.find((h) => h.kind === 'figure');
    expect(figure).toMatchObject({ match: '100%', approved: true });
    expect(hits.find((h) => h.kind === 'forbidden')).toMatchObject({ match: 'clinically proven', severity: 'high', approved: false });
    expect(kinds(openHits(hits))).toEqual(['forbidden', 'health']);
    expect(severityOf(hits)).toBe('high');
    // Approved alone: nothing open, nothing to file.
    const ok = claimHits('Runs 100% on your own machine.', claims);
    expect(openHits(ok)).toEqual([]);
    expect(severityOf(ok)).toBe(null);
  });

  test('token and investment talk read high; a context window\'s tokens do not', () => {
    expect(severityOf(claimHits('Join the airdrop before the token launch.'))).toBe('high');
    expect(claimHits('The being\'s first prompt is 2,700 tokens now.')).toEqual([]);
    expect(kinds(claimHits('Free for everyone — the best local AI. Enter to win a prize!')))
      .toEqual(['free', 'superlative', 'giveaway', 'giveaway']);
  });

  test('plain words make no claims', () => {
    expect(claimHits('We shipped the new desk today. Made with AI.')).toEqual([]);
  });

  test('the matter: one per draft and claim set, filed under marketing with the company and its law', () => {
    const entry = { id: 'abc123', channelId: 'x', accountId: 'x-2', text: 'Neuma is 3x faster than X.' };
    const hits = claimHits(entry.text);
    const matter = draftMatter({ entry, hits, companyId: 'acme', companyName: 'Acme' });
    expect(matter).toMatchObject({
      area: 'marketing', source: 'campaign-review', companyId: 'acme', severity: 'medium',
      externalId: draftMatterId('abc123', hits),
    });
    expect(matter.title).toBe('A x draft for Acme makes 2 claim(s) to check');
    expect(matter.regimes.join(' ')).toMatch(/FTC Act §5/);
    expect(matter.summary).toContain('"faster than X"');
    // New claims in an edit are a new matter; the same claims are the same one.
    expect(draftMatterId('abc123', claimHits('Neuma is 3x faster than X!'))).toBe(matter.externalId);
    expect(draftMatterId('abc123', claimHits('Neuma is 4x faster than X.'))).not.toBe(matter.externalId);
    expect(legalReplyMatter({ postId: '99', username: 'angry', text: 'my lawyer will sue' }))
      .toMatchObject({ externalId: 'reply:99', severity: 'high', area: 'marketing', source: 'campaign-review' });
  });

  test('the build watch knows the marketing-claims area', () => {
    const [hit] = areasOfCommit({ subject: 'feat: the claims check', files: ['backend/services/marketing/claims-check.js'] })
      .filter((h) => h.area.id === 'marketing-claims');
    expect(hit.paths).toEqual(['backend/services/marketing/claims-check.js']);
  });
});

describe('the LEGAL chip', () => {
  const hits = claimHits('Neuma is 3x faster than X.');
  test('open claims, not filed yet, then filed, then cleared', () => {
    const base = { hits, open: 2, severity: 'medium' };
    expect(legalChipWords({ ...base, matter: null })).toMatchObject({ text: 'LEGAL · 2 CLAIMS', loud: false });
    expect(legalChipWords({ ...base, matter: null }).title).toMatch(/Not filed with the legal office yet/);
    expect(legalChipWords({ ...base, matter: { id: 'lm_1', status: 'new' } }).title).toMatch(/waiting for its reading/);
    expect(legalChipWords({ ...base, matter: { id: 'lm_1', status: 'concern' } })).toMatchObject({ loud: true });
    expect(legalChipWords({ ...base, matter: { id: 'lm_1', status: 'no_issue' } })).toMatchObject({ text: 'LEGAL · CLEARED', loud: false });
    expect(legalChipWords({ hits: [], open: 0 })).toBe(null);
  });
});

