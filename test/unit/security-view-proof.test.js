// security-view-proof.test.js — the SECURITY window shows the FIX and its
// PROOF: the remedy, the watch's verified stamp, the event a report row
// records (VERIFIED, FIX FILED, REOPENED), and the attack-surface grounds a
// not_affected verdict carries. The pure helpers with real inputs, and the
// detail rendered for real (react-dom/server) over a ledger entry shaped the
// way threat-ledger.js writes one.

import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { reportLabel, evidenceLine } from '../../frontend/app/RelinkShell/security-view.js';
import { SecurityBody } from '../../frontend/app/RelinkShell/SecurityBody.jsx';

const EVIDENCE = {
  kind: 'attack-surface', measuredAt: '2026-10-20T00:00:00.000Z',
  contexts: [{ package: 'tar', version: '6.2.1', exposure: 'build_or_development_time', roots: ['builder [development]'], importers: 0, routes: 0 }],
};

const ENTRY = {
  id: 'th_proof0001', layer: 'software', source: 'osv', repo: 'neuma', externalId: 'GHSA-proof-0001',
  title: 'dev-only: tar path traversal', severity: 'high', status: 'mitigated', summary: 'a fixture',
  remedy: 'upgrade tar 6.2.1 → ≥7.5.21 (dev-only, via builder)',
  affected: [{ package: 'tar', version: '6.2.1', shipped: false }], surfaces: [],
  ingestedAt: '2026-10-19T00:00:00Z', lastSeenAt: '2026-10-20T00:00:00Z', verifiedAt: '2026-10-20T01:00:00Z',
  history: [
    { status: 'not_affected', assessment: 'build-time only', assessedBy: 'bizulen', assessedAt: '2026-10-19T01:00:00Z', evidence: EVIDENCE },
    { event: 'fix-filed', status: 'not_affected', assessment: 'fix filed to the operator\'s task list by bizulen', assessedBy: 'bizulen', assessedAt: '2026-10-19T02:00:00Z' },
    { status: 'mitigated', assessment: 'upgraded', assessedBy: 'bizulen', assessedAt: '2026-10-20T00:30:00Z' },
    { event: 'verified', status: 'mitigated', assessment: 'verified by the osv scan at 2026-10-20T01:00:00Z', assessedBy: 'watch', assessedAt: '2026-10-20T01:00:00Z' },
  ],
};

const renderDetail = (detail) => renderToStaticMarkup(createElement(SecurityBody, {
  posture: null, scan: null, watch: null, entries: [detail], detail, busy: false, error: null,
  onPickThreat: () => {}, onCloseDetail: () => {}, onRunScan: () => {}, onReopenThreat: () => {},
  statusFilter: '', layerFilter: '', repoFilter: '', onStatus: () => {}, onLayer: () => {}, onRepo: () => {},
}));

describe('the desk shows the fix and its proof', () => {
  it('a row names what happened: VERIFIED, FIX FILED, REOPENED; otherwise its status', () => {
    expect(reportLabel({ event: 'verified', status: 'mitigated' })).toBe('VERIFIED');
    expect(reportLabel({ event: 'fix-filed', status: 'confirmed' })).toBe('FIX FILED');
    expect(reportLabel({ event: 'reopened', status: 'new' })).toBe('REOPENED');
    expect(reportLabel({ status: 'not_affected' })).toBe('NOT AFFECTED');
  });

  it('evidence reads as the exposure per package and its route in; a failed map says so; none is null', () => {
    expect(evidenceLine(EVIDENCE)).toBe('tar@6.2.1: build or development time (via builder [development]) · 0 importer(s) · 0 route(s)');
    expect(evidenceLine({ kind: 'attack-surface', error: 'no watched repo neuma' })).toBe('ATTACK SURFACE NOT MAPPED — no watched repo neuma');
    expect(evidenceLine(undefined)).toBeNull();
  });

  it('the detail carries the remedy, the verified stamp, each row\'s event, and the WHY of the judgement', () => {
    const html = renderDetail(ENTRY);
    expect(html).toContain('REMEDY — </span>upgrade tar 6.2.1 → ≥7.5.21 (dev-only, via builder)');
    expect(html).toContain('VERIFIED BY THE WATCH');
    expect(html).toContain('>FIX FILED<');
    expect(html).toContain('>VERIFIED<');
    expect(html).toContain('WHY — tar@6.2.1: build or development time');
    // A claim not yet proven shows no stamp; an entry without a remedy no remedy line.
    const unproven = renderDetail({ ...ENTRY, verifiedAt: null, remedy: '' });
    expect(unproven).not.toContain('VERIFIED BY THE WATCH');
    expect(unproven).not.toContain('REMEDY');
  });
});
