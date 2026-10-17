// bench-summary.test.js — REPORTS' summary + share law, pure, judged on REAL
// receipts captured from the sovereign harness (test/fixtures/bench/runs/,
// 2026-09-25) and the real proof certificate (…/proof/, 2026-09-24).
// No mocks: every function here is pure, called with real inputs (RULE 0).

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { suitesSummary, notTakenCells, projectProof, seriesId } from '../../backend/services/bench/bench-summary.js';
import {
  chartFromSeries, chartFromProof, renderShareCardSvg, shareMarkdown, CARD_SIZES,
} from '../../backend/services/bench/bench-share-card.js';

const RUNS = path.resolve('test/fixtures/bench/runs');
const RECEIPTS = readdirSync(RUNS).map((id) => JSON.parse(readFileSync(path.join(RUNS, id, 'receipt.json'), 'utf8')));
const PROOF = JSON.parse(readFileSync(path.resolve('test/fixtures/bench/proof/receipt.json'), 'utf8'));

describe('suitesSummary — the comparability law', () => {
  const [gsm] = suitesSummary(RECEIPTS);

  it('a matched set stays whole when its identity arms pin a silo (their protocol digest differs by exactly that pin)', () => {
    // Live 2026-09-26: Founder's four-arm smoke set read as BARE/HARNESS and
    // SILO/NEUMA apart. The real 4-arm fixture, with the identity arms'
    // digest changed as the silo pin changes it:
    const set = RECEIPTS.filter((r) => r.comparisonId === 'night-20260915t150502z-gsm100-4arm')
      .map((r) => (r.arm === 'silo' || r.arm === 'neuma'
        ? { ...r, protocolSha256: 'f'.repeat(64), subject: { ...r.subject, silo: { neumaId: 'cael' } } }
        : r));
    expect(set).toHaveLength(4);
    const [suite] = suitesSummary(set);
    expect(suite.series).toHaveLength(1);
    const [whole] = suite.series;
    expect(whole.arms.map((a) => a.label)).toEqual(['BARE', 'HARNESS', 'SILO', 'NEUMA']);
    expect(whole.protocolKeys).toBe(2); // said, never hidden
    expect(whole.arms.filter((a) => a.identityPinned).map((a) => a.arm)).toEqual(['silo', 'neuma']);
    // Without a shared comparison id, differing digests stay apart (the harness's law).
    const strangers = set.map((r) => ({ ...r, comparisonId: `solo-${r.arm}` }));
    expect(suitesSummary(strangers)[0].series).toHaveLength(2);
  });

  it('each arm carries the deeper read: every metric, its time, its tokens, its acts', () => {
    const neuma = gsm.series[0].arms.find((a) => a.arm === 'neuma');
    const receipt = RECEIPTS.find((r) => r.runId === neuma.runId);
    expect(neuma.durationMs).toBe(receipt.timing.durationMs);
    expect(neuma.promptTokens).toBe(receipt.efficiency?.promptTokens ?? null);
    expect(neuma.metrics.length).toBe(receipt.metrics.filter((m) => typeof m.value === 'number').length);
    expect(neuma.metrics.some((m) => m.primary)).toBe(true);
  });

  it('the history lists every run of the series, oldest first', () => {
    const lead = gsm.series[0];
    const at = lead.history.map((h) => h.finishedAt);
    expect([...at].sort()).toEqual(at);
    // the older 09-14 bare attempt is history, not the standing bar
    expect(lead.history.some((h) => h.runId === 'night-20260914t160503z-gsm100-bare-a1-20260914171532780')).toBe(true);
  });

  it('groups one suite into its comparable series — never across question sets or protocols', () => {
    expect(gsm.suiteId).toBe('gsm8k-2568');
    // n=100 four-arm · n=25 NEUMA-only · n=50 bare under another protocol
    expect(gsm.series.map((s) => s.n)).toEqual([100, 50, 25]);
    for (const s of gsm.series) {
      expect(new Set(s.arms.map((a) => a.arm)).size).toBe(s.arms.length);
    }
  });

  it('the strongest comparison leads: a real comparison before a lone arm, then more questions', () => {
    const [lead, , solo] = gsm.series;
    expect(lead.arms.map((a) => a.label)).toEqual(['BARE', 'HARNESS', 'SILO', 'NEUMA']);
    expect(solo.arms.map((a) => a.label)).toEqual(['NEUMA']);
  });

  it('the latest succeeded attempt per arm stands; a failed run never scores', () => {
    const lead = gsm.series[0];
    const bare = lead.arms.find((a) => a.arm === 'bare');
    // The 09-14 bare attempt exists in the fixtures; the 09-15 one is newer.
    expect(bare.runId).toBe('night-20260915t150502z-gsm100-4arm-bare-a1-20260915152006653');
    expect(lead.arms.map((a) => a.value)).toEqual([0.67, 0.87, 0.74, 0.98]);
    const solo = gsm.series[2];
    expect(solo.arms[0].runId).toBe('night-20260920t230631z-heartbeat-neuma-a1-20260920230831179');
  });

  it('series ids are stable, URL-safe, and carry the digests', () => {
    const lead = gsm.series[0];
    const bare = RECEIPTS.find((r) => r.runId === lead.arms[0].runId);
    expect(lead.id).toBe(seriesId('gsm8k-2568', bare.protocolSha256, bare.sampleSelection.sha256));
    expect(lead.id.split('~').map((p) => p.length)).toEqual(['gsm8k-2568'.length, 12, 12]);
    expect(lead.id).toMatch(/^[A-Za-z0-9._~-]+$/);
  });

  it('notTakenCells names the catalog cells no run ever answered', () => {
    const cells = [{ id: 'gsm8k-2568', tier: 't1' }, { id: 'inspect-mmlu', label: 'MMLU', tier: 't2' }];
    expect(notTakenCells(cells, suitesSummary(RECEIPTS))).toEqual([{ id: 'inspect-mmlu', label: 'MMLU', tier: 't2' }]);
  });
});

describe('the chart model — the one law the desk and the card both draw', () => {
  const [gsm] = suitesSummary(RECEIPTS);

  it('a ladder series: NEUMA highlighted, deltas in points against BARE, ordinal layers', () => {
    const chart = chartFromSeries(gsm.series[0]);
    expect(chart.title).toBe('GSM8K-2568');
    expect(chart.ordinal).toBe(true);
    expect(chart.bars.map((b) => [b.label, b.display, b.delta, b.highlight])).toEqual([
      ['BARE', '67.0%', null, false],
      ['HARNESS', '87.0%', '+20.0 pts', false],
      ['SILO', '74.0%', '+7.0 pts', false],
      ['NEUMA', '98.0%', '+31.0 pts', true],
    ]);
    expect(chart.footnote).toBe('Every bar answered the same 100 questions under the same protocol');
  });

  it('a lone arm says so — no comparison is claimed', () => {
    const chart = chartFromSeries(gsm.series[2]);
    expect(chart.deltaHeader).toBeNull();
    expect(chart.footnote).toContain('One arm measured on 25 questions');
  });

  it('a proof: sections are nominal (one gray), TOTAL highlighted, integrity cited', () => {
    const chart = chartFromProof(projectProof(PROOF));
    expect(chart.ordinal).toBe(false);
    expect(chart.bars.map((b) => b.display)).toEqual(['92.0%  23/25', '83.3%  10/12', '100.0%  6/6', '90.7%  39/43']);
    expect(chart.bars.at(-1).highlight).toBe(true);
    expect(chart.cite).toBe(`integrity sha256 ${PROOF.integrity.slice(0, 12)}…`);
  });
});

describe('the share outputs', () => {
  const chart = chartFromSeries(suitesSummary(RECEIPTS)[0].series[0]);

  it('Markdown: a table forums render, the highlight bolded, provenance in the footer', () => {
    const md = shareMarkdown(chart);
    expect(md).toContain('| Arm | Score | Δ vs BARE |');
    expect(md).toContain('| **NEUMA** | **98.0%** | +31.0 pts |');
    expect(md).toContain('protocol sha256 77c9023ef362…');
    expect(md).toContain('measured with NEUMA Bench');
  });

  it('SVG: every size draws at its own dimensions with a 0–100% axis', () => {
    for (const [size, dims] of Object.entries(CARD_SIZES)) {
      const { svg, width, height } = renderShareCardSvg(chart, { size });
      expect([width, height]).toEqual([dims.width, dims.height]);
      expect(svg).toContain(`viewBox="0 0 ${dims.width} ${dims.height}"`);
      expect(svg).toContain('>100%<');
      expect(svg).toContain('#5FE9FF');
    }
  });

  it('SVG: text is escaped — a hostile suite id cannot become markup', () => {
    const { svg } = renderShareCardSvg({ ...chart, title: '<script>x</script>' });
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&lt;script&gt;');
  });
});
