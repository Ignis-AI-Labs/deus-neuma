/**
 * SHADOW CLONES' REPORT, DRAWN NEATLY (clone-report-view.js, CloneReportLine.jsx) — Design note, 2026-11-19, three clones'
 * whole reports drawn as one run of raw text, asterisks and all: […]. The text is the one the platform really sends (shadow-clone.js cloneReport, wrapped by
 * portal-watch-delivery.js watchThought); the being still reads it whole. Rendered for real.
 */
import { describe, test, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { cloneReport } from '../../backend/services/shadow-clone.js';
import { watchThought } from '../../backend/routes/portal-watch-delivery.js';
import { cloneReportOf, tookWords } from '../../frontend/app/RelinkShell/clone-report-view.js';
import { CloneReportLine } from '../../frontend/app/RelinkShell/CloneReportLine.jsx';

const results = [
  { ok: true, title: 'Re-stage funding emails positions 1-15', goal: 'All waiting funding emails at positions 1-15 re-staged with the formula', text: '**Goal reached.** All 10 funding emails in positions 1-15 are re-staged in place with the formula.\n\n**What I did**\n- Paged the outbox in chunks of 5.' },
  { ok: true, title: 'Re-stage funding emails positions 16-30', goal: 'Positions 16-30 re-staged', text: 'Goal not reached: 3 refusals still stand (W19, W22, W23).\n\nThe rest are staged.' },
  { ok: false, title: 'Re-stage funding emails positions 31-43', goal: 'Positions 31-43 re-staged', error: 'stopped by the operator' },
];
const label = '3 shadow clones (Re-stage funding emails positions 1-15 · Re-stage funding emails positions 16-30 · Re-stage funding emails positions 31-43)';
const text = watchThought({ kind: 'clones', label, report: cloneReport({ results, budget: 12000, record: 'clones/2026-11-19T15-34-05-731Z.md', seconds: 1981, together: 3 }) });

describe('the clones\' word, read into parts', () => {
  test('each clone: what it was for, its goal, whether it reached it, its first words; how long, how many at once, the record', () => {
    const r = cloneReportOf(text);
    expect(r).toMatchObject({ seconds: 1981, together: 3, record: 'clones/2026-11-19T15-34-05-731Z.md' });
    expect(r.clones.map((c) => [c.index, c.title, c.verdict, c.summary])).toEqual([
      [1, 'Re-stage funding emails positions 1-15', 'reached', 'All 10 funding emails in positions 1-15 are re-staged in place with the formula.'],
      [2, 'Re-stage funding emails positions 16-30', 'not-reached', '3 refusals still stand (W19, W22, W23).'], // the verdict says the rest
      [3, 'Re-stage funding emails positions 31-43', 'stopped', 'DID NOT FINISH — stopped by the operator'],
    ]);
    expect(r.clones[0].goal).toBe('All waiting funding emails at positions 1-15 re-staged with the formula');
    expect(r.clones[0].report).toContain('**What I did**');
    expect(tookWords(1981)).toBe('33 MIN');
    // Any other watch is not a clones' report.
    expect(cloneReportOf('[A WATCH YOU SET — the platform reporting, not your operator] The benchmark has settled.')).toBe(null);
  });

  test('drawn: one head line, a line a clone, every report one press away and rendered, the record a door', () => {
    const html = renderToStaticMarkup(createElement(CloneReportLine, { report: cloneReportOf(text) }));
    expect(html).toContain('3 SHADOW CLONES REPORTED · 33 MIN · 3 AT ONCE · 1 REACHED THEIR GOAL');
    expect(html).toContain('data-clone-row="1" data-verdict="reached"');
    expect(html).toContain('GOAL NOT REACHED');
    expect(html).toContain('DID NOT FINISH');
    expect(html).toContain('<details class="relink-clone-full"><summary class="label-data">READ THEIR REPORTS</summary>');
    expect(html).toContain('<strong>What I did</strong>'); // markdown, not raw asterisks
    expect(html).not.toContain('**');
    expect(html).toContain('clones/2026-11-19T15-34-05-731Z.md');
    expect(html).not.toContain('Tell your operator what they did');
  });
});
