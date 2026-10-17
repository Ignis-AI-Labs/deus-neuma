// security-view.test.js — the SECURITY window's display law, proven two
// ways: the pure helpers with real inputs and outputs (RULE 0), and the
// whole pane rendered for real (react-dom/server) over data shaped exactly
// like the server's own responses — the seat, the posture strip, the
// filtered ledger, the report with the office's verdicts, the watch.

import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  severityLoud, statusOwes, statusLabel, filterThreats,
  postureCountsLine, runLine, seatLine, hostLine, THREAT_STATUSES, THREAT_LAYERS,
} from '../../frontend/app/RelinkShell/security-view.js';
import { SecurityBody } from '../../frontend/app/RelinkShell/SecurityBody.jsx';

const T = (over = {}) => ({
  id: `th_${Math.random().toString(16).slice(2, 10)}`,
  layer: 'software', source: 'osv', repo: 'neuma',
  externalId: 'GHSA-x', title: 'fixture threat', severity: 'medium',
  status: 'new', summary: 'a fixture', affected: [], surfaces: [],
  ingestedAt: '2026-08-09T00:00:00Z', lastSeenAt: '2026-08-09T12:00:00Z',
  history: [],
  ...over,
});

describe('security-view — the display law, pure', () => {
  it('loudness: critical/high hurt, the rest stay quiet; new/confirmed/needs_operator owe', () => {
    expect(severityLoud('critical')).toBe(true);
    expect(severityLoud('high')).toBe(true);
    expect(severityLoud('low')).toBe(false);
    expect(statusOwes('new')).toBe(true);
    expect(statusOwes('confirmed')).toBe(true);
    expect(statusOwes('mitigated')).toBe(false);
    expect(statusLabel('needs_operator')).toBe('NEEDS OPERATOR');
  });

  it('filterThreats narrows and orders — the office\'s debt first', () => {
    const entries = [
      T({ externalId: 'GHSA-low', severity: 'low', status: 'new' }),
      T({ externalId: 'GHSA-crit', severity: 'critical', status: 'mitigated', repo: 'kenorie' }),
      T({ externalId: 'GHSA-high', severity: 'high', status: 'new' }),
      T({ externalId: 'GHSA-med', severity: 'medium', status: 'confirmed' }),
    ];
    const ordered = filterThreats(entries, {});
    expect(ordered.map((e) => e.externalId)).toEqual(['GHSA-crit', 'GHSA-high', 'GHSA-med', 'GHSA-low']);
    expect(filterThreats(entries, { status: 'new' }).map((e) => e.externalId)).toEqual(['GHSA-high', 'GHSA-low']);
    expect(filterThreats(entries, { repo: 'kenorie' })).toHaveLength(1);
    expect(filterThreats(null, {})).toEqual([]);
  });

  it('postureCountsLine speaks office order, or says the ledger is empty', () => {
    expect(postureCountsLine({ byStatus: { new: 3, confirmed: 1, mitigated: 2 } }))
      .toBe('NEW 3 · CONFIRMED 1 · MITIGATED 2');
    expect(postureCountsLine({ byStatus: {} })).toBe('THE LEDGER HOLDS NOTHING');
  });

  it('runLine, seatLine, hostLine — the strip\'s honest sentences', () => {
    expect(runLine({
      startedAt: '2026-08-09T17:33:27Z', added: 1, seen: 150,
      repos: [{ repo: 'neuma', checked: 863, hits: 113 }],
    })).toContain('1 NEW, 150 known');
    expect(runLine(null)).toBeNull();
    expect(seatLine({ laneId: 'dovan', designatedAt: '2026-08-06T13:56:32Z' })).toContain('DOVAN');
    expect(seatLine(null)).toBe('THE OFFICE STANDS EMPTY — THE WATCH STILL STANDS');
    expect(hostLine({ kernel: '7.1.7', nvidiaDriver: '610.57.04', listeners: [1, 2] }))
      .toBe('KERNEL 7.1.7 · NVIDIA 610.57.04 · 2 LISTENERS');
    expect(hostLine(null)).toBeNull();
  });

  it('the status and layer vocab stays in lockstep with the ledger\'s own law', () => {
    expect(THREAT_STATUSES).toEqual(['new', 'not_affected', 'confirmed', 'mitigated', 'needs_operator']);
    expect(THREAT_LAYERS).toEqual(['software', 'hardware', 'house']);
  });
});

const FIXTURE = {
  posture: {
    cso: { laneId: 'dovan', designatedAt: '2026-08-06T13:56:32Z' },
    counts: { total: 3, byStatus: { new: 2, confirmed: 1 }, byLayer: { software: 2, house: 1 } },
  },
  scan: {
    lastRunAt: '2026-08-09T17:33:27Z',
    host: { kernel: '7.1.7', nvidiaDriver: '610.57.04', listeners: [3333] },
    runs: [{ startedAt: '2026-08-09T17:33:27Z', added: 1, seen: 150, repos: [{ repo: 'neuma', checked: 863, hits: 113 }] }],
  },
  watch: {
    repos: [{ id: 'neuma', path: '/workspace/repos/neuma', hasLockfile: true }, { id: 'evm-contracts', path: '/x', hasLockfile: false }],
    host: { expectedPorts: [3333, 7777] },
  },
  threats: [
    T({ externalId: 'GHSA-high-1', severity: 'high', status: 'new', title: 'a high fixture' }),
    T({ externalId: 'GHSA-crit-1', severity: 'critical', status: 'confirmed', title: 'a critical fixture', history: [
      { status: 'confirmed', assessment: 'it bites the fixture surface', assessedBy: 'dovan', assessedAt: '2026-08-09T18:00:00Z' },
    ] }),
    T({ externalId: 'GHSA-low-1', severity: 'low', status: 'new', layer: 'house', title: 'a house fixture' }),
  ],
};

const renderBody = (over = {}) => renderToStaticMarkup(createElement(SecurityBody, {
  posture: FIXTURE.posture,
  scan: FIXTURE.scan,
  watch: FIXTURE.watch,
  entries: filterThreats(FIXTURE.threats, {}),
  detail: null,
  busy: false,
  error: null,
  onPickThreat: () => {},
  onCloseDetail: () => {},
  onRunScan: () => {},
  statusFilter: '', layerFilter: '', repoFilter: '',
  onStatus: () => {}, onLayer: () => {}, onRepo: () => {},
  ...over,
}));

describe('SecurityBody — the office, rendered for real', () => {
  it('names the seated CSO, the last scan, the host, and the counts', () => {
    const html = renderBody();
    expect(html).toContain('THE SEAT — DOVAN');
    expect(html).toContain('LAST SCAN');
    expect(html).toContain('KERNEL 7.1.7 · NVIDIA 610.57.04 · 1 LISTENERS');
    expect(html).toContain('NEW 2 · CONFIRMED 1');
    expect(html).toContain('SOFTWARE 2 · HOUSE 1');
  });

  it('the ledger rows carry severity, status, id and title — debt sorted first', () => {
    const html = renderBody();
    expect(html.indexOf('GHSA-crit-1')).toBeLessThan(html.indexOf('GHSA-high-1'));
    expect(html).toContain('a house fixture');
    expect(html).toContain('CRITICAL');
  });

  it('THE REPORT shows the office\'s verdicts — the CSO\'s handling, in order', () => {
    const html = renderBody({ detail: FIXTURE.threats[1] });
    expect(html).toContain('THE OFFICE&#x27;S REPORTS');
    expect(html).toContain('it bites the fixture surface');
    expect(html).toContain('BY DOVAN');
  });

  it('an unread threat says so — no verdict pretended', () => {
    const html = renderBody({ detail: FIXTURE.threats[0] });
    expect(html).toContain('NO VERDICT YET');
  });

  it('the watch names its repos, sweep-only marks, ports, and recent runs', () => {
    const html = renderBody();
    expect(html).toContain('EVM-CONTRACTS — /x (NO LOCKFILE — SWEEP ONLY)');
    expect(html).toContain('EXPECTED PORTS — 3333 · 7777');
    expect(html).toContain('1 NEW, 150 known');
  });

  it('the empty office is honest — no seat, no scan, nothing held', () => {
    const html = renderBody({ posture: { cso: null, counts: { byStatus: {} } }, scan: { lastRunAt: null, host: null, runs: [] }, entries: [] });
    expect(html).toContain('THE OFFICE STANDS EMPTY');
    expect(html).toContain('THE WATCH HAS NEVER RUN');
    expect(html).toContain('THE LEDGER HOLDS NOTHING');
  });
});
