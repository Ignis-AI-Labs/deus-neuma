// security-threat-text.test.js — a threat's text reads as the operator needs it (Design note, 2026-10-26: […]). An OSV advisory is
// GitHub's own markdown; it renders as structure (headings, code), its Summary leads, its Details and PoC fold, a
// text the ledger cut says so with the door to the whole advisory, and the facts sit in one grid. The pure law with
// real inputs and the detail rendered for real (react-dom/server).

import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { threatTextParts, advisoryUrl, LEDGER_TEXT_KEPT } from '../../frontend/app/RelinkShell/security-view.js';
import { SUMMARY_MAX } from '../../backend/services/security/threat-lifecycle.js';
import { SecurityBody } from '../../frontend/app/RelinkShell/SecurityBody.jsx';

// the shape OSV serves for a GitHub advisory: CRLF line ends, ### sections, a fenced PoC
const ADVISORY = [
  '### Summary',
  'A **Decompression/parse DoS via unlimited input** vulnerability in `node-tar` allows an attacker to exhaust disk space.',
  '',
  '### Details',
  'The `node-tar` library does not enforce a hard upper bound on archive size.',
  '',
  '### PoC',
  '```javascript',
  "const t = require('tar');",
  '```',
].join('\r\n');

describe('threatTextParts — the lead first, the rest folded', () => {
  it('an advisory leads with its Summary section; Details and PoC are the rest', () => {
    const parts = threatTextParts(ADVISORY);
    expect(parts.lead).toBe('A **Decompression/parse DoS via unlimited input** vulnerability in `node-tar` allows an attacker to exhaust disk space.');
    expect(parts.rest.startsWith('### Details\n')).toBe(true);
    expect(parts.rest).toContain("```javascript\nconst t = require('tar');\n```");
    expect(parts.cut).toBe(false);
  });

  it('a preamble before the first heading leads', () => {
    expect(threatTextParts('Upgrade now.\n\n## Impact\nData loss.')).toEqual({ lead: 'Upgrade now.', rest: '## Impact\nData loss.', cut: false });
  });

  it('a text that opens on a section that is no summary is read whole, never filed under the wrong name', () => {
    const text = '### Details\nFirst.\n\n### PoC\nSecond.';
    expect(threatTextParts(text)).toEqual({ lead: text, rest: null, cut: false });
  });

  it('plain paragraphs: the first leads; a one-line finding of the watch\'s own is all lead', () => {
    expect(threatTextParts('One.\n\nTwo.\n\nThree.')).toEqual({ lead: 'One.', rest: 'Two.\n\nThree.', cut: false });
    expect(threatTextParts('A secret pattern matches inside .env.test.')).toEqual({ lead: 'A secret pattern matches inside .env.test.', rest: null, cut: false });
    expect(threatTextParts('')).toBeNull();
    expect(threatTextParts(null)).toBeNull();
  });

  it('a text that filled what the ledger keeps is marked cut — the frontend\'s count is the ledger\'s own', () => {
    expect(LEDGER_TEXT_KEPT).toBe(SUMMARY_MAX);
    expect(threatTextParts(`### Summary\nLead.\n\n### Details\n${'x'.repeat(SUMMARY_MAX)}`.slice(0, SUMMARY_MAX)).cut).toBe(true);
  });
});

describe('advisoryUrl — the door to the whole advisory', () => {
  it('an OSV finding opens at osv.dev; anything else has no source page', () => {
    expect(advisoryUrl({ source: 'osv', externalId: 'GHSA-23hp-3jrh-7fpw' })).toBe('https://osv.dev/vulnerability/GHSA-23hp-3jrh-7fpw');
    expect(advisoryUrl({ source: 'house', externalId: 'house:plaintext-secret:.env.test' })).toBeNull();
    expect(advisoryUrl({ source: 'osv', externalId: 'GHSA-x/../../evil' })).toBeNull();
  });
});

const ENTRY = {
  id: 'th_text0001', layer: 'software', source: 'osv', repo: 'neuma', externalId: 'GHSA-23hp-3jrh-7fpw',
  title: 'dev-only: node-tar: Decompression/parse DoS via unlimited input', severity: 'critical', status: 'new',
  summary: ADVISORY, remedy: 'upgrade tar 6.2.1 → ≥7.5.19 (dev-only, via electron-builder)',
  affected: [{ package: 'tar', version: '6.2.1' }, { package: 'tar', version: '7.5.9' }], surfaces: [],
  ingestedAt: '2026-08-06T14:31:00Z', lastSeenAt: '2026-10-25T17:56:00Z', history: [],
};

const render = (detail) => renderToStaticMarkup(createElement(SecurityBody, {
  posture: { cso: null, counts: { byStatus: {} } }, scan: { lastRunAt: null, host: null, runs: [] }, watch: { repos: [] },
  all: [detail], entries: [detail], detail, busy: false, error: null, now: Date.parse('2026-10-26T00:00:00Z'),
  onPickThreat: () => {}, onCloseDetail: () => {}, onRunScan: () => {}, filters: {}, onFilter: () => {},
}));

describe('the threat detail, rendered for real', () => {
  it('the remedy stands before the facts, the facts before the advisory, the advisory before the verdicts', () => {
    const html = render(ENTRY);
    const at = (s) => html.indexOf(s);
    expect(at('REMEDY — ')).toBeGreaterThan(-1);
    expect(at('REMEDY — ')).toBeLessThan(at('class="sec-facts"'));
    expect(at('class="sec-facts"')).toBeLessThan(at('class="sec-detail-text"'));
    expect(at('class="sec-detail-text"')).toBeLessThan(at('THE OFFICE&#x27;S REPORTS'));
  });

  it('the facts are one grid of label and value: affected, seen, and the source door', () => {
    const html = render(ENTRY);
    expect(html).toContain('<dt class="label-data">AFFECTED</dt><dd>tar@6.2.1 · tar@7.5.9</dd>');
    expect(html).toMatch(/<dt class="label-data">SEEN<\/dt><dd>[^<]+ → [^<]+<\/dd>/);
    expect(html).toContain('<a href="https://osv.dev/vulnerability/GHSA-23hp-3jrh-7fpw" target="_blank" rel="noreferrer">osv.dev/vulnerability/GHSA-23hp-3jrh-7fpw</a>');
  });

  it('the advisory renders as structure — no raw ### or ** — its Summary leads and its Details fold', () => {
    const html = render(ENTRY);
    expect(html).not.toContain('###');
    expect(html).not.toContain('**');
    expect(html).toContain('<strong>Decompression/parse DoS via unlimited input</strong>');
    expect(html).toMatch(/<details class="sec-detail-more"><summary class="label-data">THE DETAILS<\/summary>.*<h3>Details<\/h3>/s);
    expect(html).toContain('<pre>');
    expect(at(html, '<strong>')).toBeLessThan(at(html, '<details'));
    expect(html).not.toContain('CUT AT');
  });

  it('a text the ledger cut says so, with the source named; a short house finding has no fold and no source', () => {
    const cutText = `### Summary\nLead.\n\n### Details\n${'word '.repeat(SUMMARY_MAX)}`.slice(0, SUMMARY_MAX);
    expect(render({ ...ENTRY, summary: cutText })).toContain(`CUT AT ${SUMMARY_MAX.toLocaleString('en-US')} CHARACTERS — WHOLE AT THE SOURCE`);
    const house = render({ ...ENTRY, source: 'house', layer: 'house', repo: null, externalId: 'house:plaintext-secret:.env.test', summary: 'A secret pattern matches inside .env.test.', remedy: '', affected: [] });
    expect(house).toContain('A secret pattern matches inside .env.test.');
    expect(house).not.toContain('<details');
    expect(house).not.toContain('>SOURCE</dt>');
    expect(house).not.toContain('>AFFECTED</dt>');
  });
});

const at = (html, s) => html.indexOf(s);
