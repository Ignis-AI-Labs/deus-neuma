/**
 * TRIAGE OVERVIEW — what is wrong, and where, at a glance; open criticals and
 * highs stand until settled. The counting under
 * the overview SECURITY and LEGAL share, proven with real inputs, and the
 * overview rendered for real (react-dom/server).
 */
import { describe, expect, test } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  OPEN, ageBuckets, ageTag, daysSince, mustAct, passesTriage, severityMatrix, toggleFilters, whereGroups,
} from '../../frontend/app/RelinkShell/triage-view.js';
import { TriageOverview } from '../../frontend/app/RelinkShell/TriageOverview.jsx';
import { THREAT_STATUSES, statusLabel, statusOwes, whereLabelThreat, whereOfThreat } from '../../frontend/app/RelinkShell/security-view.js';

const NOW = Date.parse('2026-10-21T12:00:00Z');
const ago = (d) => new Date(NOW - d * 86_400_000).toISOString();
const E = (severity, status, d, over = {}) => ({ severity, status, ingestedAt: ago(d), repo: 'neuma', layer: 'software', ...over });

const LEDGER = [
  E('critical', 'new', 12),
  E('critical', 'new', 2),
  E('critical', 'mitigated', 40),
  E('high', 'needs_operator', 0),
  E('high', 'new', 5, { repo: 'kenorie' }),
  E('medium', 'new', 45, { repo: null, layer: 'hardware' }),
  E('low', 'not_affected', 3),
];

describe('triage counting', () => {
  test('MUST ACT counts only OPEN criticals and highs, with the oldest wait of each', () => {
    expect(mustAct(LEDGER, statusOwes, NOW)).toEqual({ critical: 2, high: 2, open: 5, oldestCritical: 12, oldestHigh: 5 });
    expect(mustAct([], statusOwes, NOW)).toEqual({ critical: 0, high: 0, open: 0, oldestCritical: null, oldestHigh: null });
  });

  test('the matrix: open statuses first, every entry counted exactly once', () => {
    const m = severityMatrix(LEDGER, THREAT_STATUSES, statusOwes);
    expect(m.columns).toEqual(['new', 'confirmed', 'needs_operator', 'not_affected', 'mitigated']);
    expect(m.rows.map((r) => r.severity)).toEqual(['critical', 'high', 'medium', 'low']);
    expect(m.rows.reduce((a, r) => a + r.total, 0)).toBe(LEDGER.length);
    expect(m.rows[0].cells.find((c) => c.status === 'new').count).toBe(2);
    expect(m.max).toBe(2);
  });

  test('where: open work by severity, settled apart, criticals lead', () => {
    const g = whereGroups(LEDGER, statusOwes, whereOfThreat);
    expect(g.map((x) => x.where)).toEqual(['neuma', 'kenorie', 'hardware']);
    expect(g[0]).toMatchObject({ open: 3, settled: 2 });
    expect(g[0].bySeverity).toMatchObject({ critical: 2, high: 1 });
  });

  test('ages bucket the open work by days since first seen', () => {
    const b = ageBuckets(LEDGER, statusOwes, NOW);
    expect(b.map((x) => x.total)).toEqual([1, 2, 1, 1]);
    expect(b.reduce((a, x) => a + x.total, 0)).toBe(5);
  });

  test('a press filters exactly; the same press again returns the whole ledger', () => {
    const open = LEDGER.filter((e) => passesTriage(e, { severity: 'critical', status: OPEN }, statusOwes, whereOfThreat));
    expect(open).toHaveLength(2);
    expect(LEDGER.filter((e) => passesTriage(e, { where: 'hardware' }, statusOwes, whereOfThreat))).toHaveLength(1);
    const press = { severity: 'high', status: 'new' };
    expect(toggleFilters({}, press)).toEqual(press);
    expect(toggleFilters(press, press)).toEqual({});
    expect(toggleFilters({ where: 'neuma', status: OPEN }, press)).toEqual(press);
  });

  test('waits read in whole days', () => {
    expect(daysSince(ago(3.5), NOW)).toBe(3);
    expect(daysSince('not a time', NOW)).toBeNull();
    expect(ageTag(ago(0.2), NOW)).toBe('TODAY');
    expect(ageTag(ago(6), NOW)).toBe('6D');
  });
});

describe('the overview, rendered', () => {
  const render = (all, filters = {}) => renderToStaticMarkup(createElement(TriageOverview, {
    all, shown: all.length, statuses: THREAT_STATUSES, owes: statusOwes, statusLabel,
    whereOf: whereOfThreat, whereLabel: whereLabelThreat, filters, onFilter: () => {}, now: NOW, noun: 'THREATS',
  }));

  test('criticals and highs stand as MUST ACT, with their oldest wait', () => {
    const html = render(LEDGER);
    expect(html).toContain('role="alert"');
    expect(html).toContain('aria-label="2 critical open"');
    expect(html).toContain('OLDEST 12 DAYS');
    expect(html).toContain('CANNOT BE IGNORED');
  });

  test('with none open the banner says so, calmly', () => {
    const html = render([E('medium', 'new', 1)]);
    expect(html).toContain('NO CRITICAL OR HIGH THREATS OPEN');
    expect(html).not.toContain('role="alert"');
  });

  test('a filtered view names its filters and the way back', () => {
    const html = render(LEDGER, { severity: 'critical', status: OPEN });
    expect(html).toContain('CRITICAL · OPEN');
    expect(html).toContain('SHOW ALL');
  });
});
