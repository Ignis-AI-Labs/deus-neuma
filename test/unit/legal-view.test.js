// legal-view.test.js — the LEGAL window's display law, proven two ways: the
// pure helpers with real inputs and outputs (RULE 0), and the whole pane
// rendered for real (react-dom/server) over matters made by the REAL ledger
// on real temp disk — the seat, the strip, the ordered ledger, a matter's
// readings with the law they cite.
import { describe, it, expect } from 'vitest';
import path from 'path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createTempDir } from '../helpers/temp-fs.js';
import { createMatterLedger, matterCounts } from '../../backend/services/legal/matter-ledger.js';
import {
  filterMatters, whereLabelMatter, seatLine, holderNameFor, statusOwes, severityLoud, areaLabel, runLine, reportsOf,
} from '../../frontend/app/RelinkShell/legal-view.js';
import { LegalBody } from '../../frontend/app/RelinkShell/LegalBody.jsx';

const realLedger = async () => {
  const ledger = createMatterLedger({ path: path.join(await createTempDir('legal-view'), 'matters.json') });
  const { added } = await ledger.ingest([
    { area: 'posture', source: 'posture-probe', repo: 'neuma', externalId: 'posture:no-privacy-policy', title: 'neuma builds an installed app with no privacy notice', severity: 'high', regimes: ['privacy'] },
    { area: 'license', source: 'license-scan', repo: 'neuma', externalId: 'license-family:LGPL-3.0-or-later', title: '14 shipped package(s) under LGPL-3.0-or-later (weak-copyleft)', severity: 'low', affected: ['@img/sharp-libvips-linux-x64@1.2.0'] },
    { area: 'product', source: 'build-watch', repo: 'neuma', externalId: 'build:voice-likeness@416b75de123c', title: 'New work touches voice and likeness — 5 commit(s) in neuma', severity: 'medium', summary: 'Whose voice?\nWhere to start reading: ELVIS Act.' },
  ]);
  await ledger.assess([added[1].id], {
    status: 'no_issue', assessment: 'Dynamically loaded; the notice and relink right are met.',
    citations: ['https://www.gnu.org/licenses/lgpl-3.0.html §4'], reviewBy: '2027-01-01', assessedBy: 'praetorlane',
  });
  return ledger.load();
};

describe('legal-view — the display law, pure', () => {
  it('what owes action sorts first, then what can hurt', async () => {
    const entries = await realLedger();
    const ordered = filterMatters(entries);
    expect(ordered.map((m) => m.externalId)).toEqual([
      'posture:no-privacy-policy', 'build:voice-likeness@416b75de123c', 'license-family:LGPL-3.0-or-later',
    ]);
    expect(filterMatters(entries, { where: 'license:neuma' })).toHaveLength(1);
    expect(filterMatters(entries, { status: '@open', severity: 'high' }).map((m) => m.externalId)).toEqual(['posture:no-privacy-policy']);
    expect(whereLabelMatter('product:neuma')).toBe('NEW WORK · NEUMA');
    expect(filterMatters(entries, { status: 'no_issue' })[0].citations[0]).toContain('lgpl-3.0');
  });

  it('the seat, the loudness, the words', () => {
    const clo = { laneId: 'praetorlane', designatedAt: '2026-10-01T00:00:00Z' };
    expect(seatLine(clo, 'Galen')).toBe('THE PRAETOR — GALEN · SINCE 2026-10-01');
    expect(seatLine(null)).toMatch(/NO PRAETOR SEATED/);
    expect(holderNameFor(clo, [{ neumaId: 'praetorlane', name: 'Galen' }])).toBe('Galen');
    expect(holderNameFor(clo, [])).toBe('praetorlane');
    expect(statusOwes('needs_counsel')).toBe(true);
    expect(statusOwes('no_issue')).toBe(false);
    expect(severityLoud('critical')).toBe(true);
    expect(areaLabel('product')).toBe('NEW WORK');
    expect(runLine({ startedAt: 'T', added: 2, seen: 1, repos: [{ repo: 'neuma', shipped: 626, commits: 69 }] }))
      .toBe('T — 2 NEW, 1 known · neuma: 626 shipped, 69 commits');
  });
});

describe('the LEGAL window, rendered', () => {
  it('shows the seat, the strip, the ordered ledger, and a reading with its citation', async () => {
    const entries = await realLedger();
    const settled = entries.find((m) => m.status === 'no_issue');
    expect(reportsOf(settled)).toHaveLength(1);
    const html = renderToStaticMarkup(createElement(LegalBody, {
      posture: { clo: { laneId: 'praetorlane', designatedAt: '2026-10-01T00:00:00Z' }, counts: matterCounts(entries), dueForReview: 0, lastRunAt: '2026-10-01T01:00:00Z' },
      watch: { runs: [{ startedAt: '2026-10-01T01:00:00Z', added: 3, seen: 0, repos: [{ repo: 'neuma', shipped: 626, commits: 69 }] }] },
      lanes: [{ neumaId: 'praetorlane', name: 'Galen' }],
      all: entries,
      entries: filterMatters(entries),
      now: Date.now(),
      filters: {}, onFilter: () => {},
      detail: settled,
      busy: false, error: null, pick: '', seatBusy: false, confirmClear: false,
      onPick: () => {}, onSeat: () => {}, onAskClear: () => {}, onClear: () => {}, onCancelClear: () => {},
      onPickMatter: () => {}, onCloseDetail: () => {}, onRunWatch: () => {},
    }));
    expect(html).toContain('THE PRAETOR — GALEN');
    expect(html).toContain('MUST ACT');
    expect(html).toContain('SHOWING <b>3</b> OF 3 MATTERS');
    expect(html).toContain('OUR PAPERS · NEUMA');
    expect(html).toContain('RUN WATCH');
    expect(html.indexOf('no privacy notice')).toBeLessThan(html.indexOf('voice and likeness'));
    expect(html).toContain('THE PRAETOR&#x27;S READINGS');
    expect(html).toContain('https://www.gnu.org/licenses/lgpl-3.0.html §4');
    expect(html).toContain('REVIEW BY 2027-01-01');
    expect(html).toContain('626 shipped, 69 commits');
  });

  it('an empty office says so, and never hides the watch', () => {
    const html = renderToStaticMarkup(createElement(LegalBody, {
      posture: { clo: null, counts: { total: 0, byStatus: {}, byArea: {} }, dueForReview: 0, lastRunAt: null },
      watch: { runs: [] }, lanes: [], entries: [], detail: null, busy: false, error: 'Could not read the matters ledger.',
      pick: '', seatBusy: false, confirmClear: false,
      onPick: () => {}, onSeat: () => {}, onAskClear: () => {}, onClear: () => {}, onCancelClear: () => {},
      onPickMatter: () => {}, onCloseDetail: () => {}, onRunWatch: () => {},
      all: [], now: Date.now(), filters: {}, onFilter: () => {},
    }));
    expect(html).toContain('NO PRAETOR SEATED');
    expect(html).toContain('NO CRITICAL OR HIGH MATTERS OPEN');
    expect(html).toContain('THE LEGAL WATCH HAS NEVER RUN');
    expect(html).toContain('Could not read the matters ledger.');
    expect(html).toContain('EVERY 24 HOURS');
  });
});
