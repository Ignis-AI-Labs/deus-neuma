// bench-reports-view.test.js — REPORTS' sub-tabs, proven two ways: the pure
// view law (bench-summary-view.js), and SUMMARY / SHARE / the sub-tab frame
// rendered for real (react-dom/server) over a summary built by the SERVER'S
// OWN pure law from REAL captured receipts (test/fixtures/bench/runs/) — the
// exact shape GET /summary answers. No mocks (RULE 0).

import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { suitesSummary, notTakenCells, projectProof } from '../../backend/services/bench/bench-summary.js';
import { chartFromSeries, chartFromProof } from '../../backend/services/bench/bench-share-card.js';
import {
  libraryItems, stepLibrary, positionLabel, notTakenByTier,
  shareOptions, parseShareValue, defaultShareSource,
} from '../../frontend/app/RelinkShell/bench-summary-view.js';
import { BenchReports } from '../../frontend/app/RelinkShell/BenchReports.jsx';
import { BenchExplorer } from '../../frontend/app/RelinkShell/BenchExplorer.jsx';
import { BenchAtlas } from '../../frontend/app/RelinkShell/BenchAtlas.jsx';
import { BenchShare } from '../../frontend/app/RelinkShell/BenchShare.jsx';
import { benchMeaning, variantLine } from '../../frontend/app/RelinkShell/bench-glossary.js';
import {
  atlasRows, influence, seriesFor, pointsText, stepRow, rowReading, ratioText,
} from '../../frontend/app/RelinkShell/bench-atlas-view.js';
import {
  explorerList, setChips, armStats, historyTracks, identityNote,
} from '../../frontend/app/RelinkShell/bench-explorer-view.js';

const RUNS = path.resolve('test/fixtures/bench/runs');
const RECEIPTS = readdirSync(RUNS).map((id) => JSON.parse(readFileSync(path.join(RUNS, id, 'receipt.json'), 'utf8')));
const PROOF = projectProof(JSON.parse(readFileSync(path.resolve('test/fixtures/bench/proof/receipt.json'), 'utf8')));
const CELLS = [{ id: 'gsm8k-2568', tier: 't1' }, { id: 'inspect-mmlu', tier: 't2' }, { id: 'inspect-bbh', tier: 't2' }, { id: 'smoke', tier: 't0' }];

// The /summary body, built exactly as bench-share-routes.js builds it.
const SUITES = suitesSummary(RECEIPTS);
const SUMMARY = {
  suites: SUITES.map((s) => ({ ...s, tier: 't1', label: 'GSM8K — grade-school math word problems — 2568-token budget', series: s.series.map((x) => ({ ...x, chart: chartFromSeries(x) })) })),
  notTaken: notTakenCells(CELLS, SUITES),
  proofs: [{ ...PROOF, chart: chartFromProof(PROOF) }],
};
const noop = () => {};

describe('bench-summary-view — the LIBRARY list, pure', () => {
  const proofs = [{ id: 'p1', mtimeMs: 300 }];
  const bundles = [{ id: 'b-new', mtimeMs: 400 }, { id: 'b-old', mtimeMs: 100 }];

  it('merges proofs and bundles newest first; the filter narrows it', () => {
    expect(libraryItems(proofs, bundles).map((i) => i.key)).toEqual(['bundle:b-new', 'proof:p1', 'bundle:b-old']);
    expect(libraryItems(proofs, bundles, 'proof').map((i) => i.id)).toEqual(['p1']);
    expect(libraryItems(proofs, bundles, 'bundle').map((i) => i.id)).toEqual(['b-new', 'b-old']);
    expect(libraryItems(null, null)).toEqual([]);
  });

  it('‹ › steps through the list: nothing selected lands on the newest; null past either end', () => {
    const items = libraryItems(proofs, bundles);
    expect(stepLibrary(items, null, 1).id).toBe('b-new');
    expect(stepLibrary(items, { kind: 'bundle', id: 'b-new' }, 1).id).toBe('p1');
    expect(stepLibrary(items, { kind: 'proof', id: 'p1' }, -1).id).toBe('b-new');
    expect(stepLibrary(items, { kind: 'bundle', id: 'b-old' }, 1)).toBeNull();
    expect(stepLibrary([], null, 1)).toBeNull();
    expect(positionLabel(items, { kind: 'proof', id: 'p1' })).toBe('2 / 3');
    expect(positionLabel(items, null)).toBe('— / 3');
  });
});

describe('bench-summary-view — SUMMARY + SHARE law, pure', () => {
  it('NOT TAKEN YET groups by tier, in tier order', () => {
    expect(notTakenByTier(SUMMARY.notTaken)).toEqual([
      { tier: 'T0', ids: ['smoke'] },
      { tier: 'T2', ids: ['inspect-mmlu', 'inspect-bbh'] },
    ]);
  });

  it('the SHARE picker offers every proof and every comparable series; values round-trip', () => {
    const groups = shareOptions(SUMMARY);
    expect(groups.map((g) => g.group)).toEqual(['PROOF SUITE', 'GSM8K-2568']);
    expect(groups[1].options).toHaveLength(3);
    expect(groups[1].options[0].label).toBe('2026-09-15 · n=100 · BARE/HARNESS/SILO/NEUMA');
    const lead = SUMMARY.suites[0].series[0];
    expect(parseShareValue(`series|${lead.id}`)).toEqual({ kind: 'series', id: lead.id });
    expect(parseShareValue('chart|x')).toBeNull();
    expect(parseShareValue('')).toBeNull();
    expect(defaultShareSource(SUMMARY)).toEqual({ kind: 'proof', id: PROOF.id });
    expect(defaultShareSource({ suites: SUMMARY.suites, proofs: [] })).toEqual({ kind: 'series', id: lead.id });
  });
});

describe('bench-glossary — what each benchmark tests, pure', () => {
  it('the most specific family wins; every variant of a family shares its line', () => {
    expect(benchMeaning('gsm8k-platinum-2568')).toContain('cleaned-up GSM8K');
    expect(benchMeaning('gsm8k-2568')).toContain('Grade-school math word problems.');
    expect(benchMeaning('gsm8k-format-v4')).toBe(benchMeaning('gsm8k'));
    expect(benchMeaning('inspect-mmlu-pro')).toContain('ten answer choices');
    expect(benchMeaning('inspect-mmlu')).toContain('57');
    expect(benchMeaning('smoke')).toContain('does not measure the model');
    expect(benchMeaning('terminal-bench-rem2b')).toContain('terminal');
  });

  it('the variant line is the label\'s last segment — the family is not said twice', () => {
    expect(variantLine('GSM8K — grade-school math word problems, 8-shot chain of thought — 2568-token reasoning and final-answer budget'))
      .toBe('2568-token reasoning and final-answer budget');
    expect(variantLine('IFEval — 2048-token reasoning and final-answer budget')).toBe('2048-token reasoning and final-answer budget');
    expect(variantLine('SMOKE')).toBe('SMOKE');
    expect(variantLine(null)).toBeNull();
  });

  it('an unwritten family reads null — the harness label still stands', () => {
    expect(benchMeaning('some-new-suite')).toBeNull();
    expect(benchMeaning(null)).toBeNull();
  });
});

describe('THE ATLAS — every benchmark on one line, the architecture\u2019s influence, pure', () => {
  it('a row per benchmark: the newest set by default, the strongest on request, arms as points', () => {
    const [latest] = atlasRows(SUMMARY, 'latest');
    expect(latest.suiteId).toBe('gsm8k-2568');
    expect(latest.n).toBe(25); // the newest set is the NEUMA-only heartbeat
    expect(latest.points.map((p) => p.arm)).toEqual(['neuma']);
    const [strong] = atlasRows(SUMMARY, 'strongest');
    // The three core arms only (ruling, 2026-10-01): the diagnostic wire and silo never plot here.
    expect(strong.points.map((p) => [p.arm, p.display])).toEqual([['bare', '67%'], ['neuma', '98%']]);
    expect(strong.low).toBe(0.67);
    expect(strong.high).toBe(0.98);
    expect(strong.bestDelta).toBe('+31.0');
    expect(seriesFor({ series: [] })).toBeNull();
    expect(atlasRows(SUMMARY, 'latest', 't2')).toEqual([]);
  });

  it('a HARNESS arm plots as its own point between bare and the full being', () => {
    const summary = { suites: [{ suiteId: 'humaneval-8192', tier: 't2', series: [{ id: 's', n: 20, finishedAt: '2026-09-30T19:49:00Z',
      arms: [{ arm: 'bare', value: 0.9 }, { arm: 'platform', value: 0.85 }, { arm: 'harness', value: 0.95 }, { arm: 'neuma', value: 1 }] }] }] };
    const [row] = atlasRows(summary);
    expect(row.points.map((p) => [p.arm, p.display])).toEqual([['bare', '90%'], ['harness', '95%'], ['neuma', '100%']]);
    expect(row.bestDelta).toBe('+10.0');
  });

  it('the influence pairs each layer with the bare run it shared questions with — whatever the row mode', () => {
    // The headline layers only: HARNESS and FULL BEING against BARE (three-arm focus, Design note, 2026-09-29.
    const layers = influence(SUMMARY);
    expect(layers.map((l) => l.name)).toEqual(['HARNESS', 'FULL BEING']);
    const [harness, being] = layers;
    // HARNESS (the platform agent) has no runs in this fixture yet — it reads empty, never borrowed from the wire.
    expect(harness).toMatchObject({ name: 'HARNESS', count: 0, meanText: '—' });
    expect(being).toMatchObject({ name: 'FULL BEING', count: 1, meanText: '+31.0' });
    // T0 smoke proves the road and never counts.
    const smokeOnly = { suites: SUMMARY.suites.map((x) => ({ ...x, tier: 't0' })) };
    expect(influence(smokeOnly).map((l) => l.count)).toEqual([0, 0]);
    expect(influence(smokeOnly)[0].meanText).toBe('—');
  });

  it('the reading says better or worse in words, and a score outside 0–1 is left out and named', () => {
    const series = (id, bare, neuma) => ({
      suiteId: id, tier: 't2',
      series: [{ id: `${id}-1`, finishedAt: '2026-10-15T00:00:00Z', arms: [{ arm: 'bare', value: bare }, { arm: 'neuma', value: neuma }] }],
    });
    // 2026-10-15: SciCode's bare arm sealed "20" (a percentage) — averaged in, it turned +5 into −35
    const layers = influence({ suites: [series('mmlu', 0.8, 0.9), series('gsm8k', 0.6, 0.7), series('inspect-scicode', 20, 0)] });
    const being = layers.find((l) => l.arm === 'neuma');
    expect(being).toMatchObject({ count: 2, meanText: '+10.0', verdict: 'better than', excluded: ['inspect-scicode'] });
    const worse = influence({ suites: [series('mmlu', 0.9, 0.7)] }).find((l) => l.arm === 'neuma');
    expect(worse).toMatchObject({ meanText: '−20.0', verdict: 'worse than', excluded: [] });
    expect(influence({ suites: [series('mmlu', 0.9, 0.9)] }).find((l) => l.arm === 'neuma').verdict).toBe('level with');
  });

  it('points, ratios, the keyboard walk, and the reading line', () => {
    expect(pointsText(0.31)).toBe('+31.0');
    expect(pointsText(-0.04)).toBe('−4.0');
    expect(pointsText(0)).toBe('±0.0');
    expect(pointsText(NaN)).toBe('—');
    expect(ratioText(13.2, 'PROMPT TOKENS')).toBe('×13 PROMPT TOKENS');
    expect(ratioText(1.26, 'TIME')).toBe('×1.3 TIME');
    expect(ratioText(null, 'TIME')).toBeNull();
    const rows = [{ suiteId: 'a' }, { suiteId: 'b' }, { suiteId: 'c' }];
    expect(stepRow(rows, null, 'ArrowDown')).toBe('a');
    expect(stepRow(rows, 'a', 'ArrowDown')).toBe('b');
    expect(stepRow(rows, 'c', 'ArrowDown')).toBe('c');
    expect(stepRow(rows, 'b', 'ArrowUp')).toBe('a');
    expect(stepRow(rows, 'a', 'End')).toBe('c');
    expect(rowReading(atlasRows(SUMMARY, 'strongest')[0])).toBe('GSM8K-2568 · bare model 67% · full being 98% · best +31.0 pts vs bare · n=100');
  });

  it('renders for real: the influence instruments, the chart rows, the table on request', () => {
    const html = renderToStaticMarkup(createElement(BenchAtlas, { summary: SUMMARY, onOpen: noop }));
    expect(html).toContain('THE ATLAS');
    expect(html).toContain('1 BENCHMARK TAKEN · 3 NOT TAKEN YET');
    expect(html).toContain('PROOF SUITE — 90.7%');
    expect(html).toContain('+31.0<span class="atlas-layer-unit"> pts</span>');
    expect(html).toContain('role="listbox"');
    expect(html).toContain('gsm8k-2568');
    expect(html).toContain('3 NOT TAKEN YET — DECLARED IN THE CATALOG, NEVER RUN');
    const table = renderToStaticMarkup(createElement(BenchAtlas, { summary: SUMMARY, onOpen: noop, startView: 'table' }));
    expect(table).toContain('atlas-table');
    expect(renderToStaticMarkup(createElement(BenchAtlas, { summary: null, onOpen: noop }))).toContain('READING EVERY RECEIPT');
  });
});

describe('the EXPLORER — list, comparisons, every arm\u2019s stats and history, pure', () => {
  const suite = SUMMARY.suites[0];

  it('the list filters by query and tier; each row previews its newest set', () => {
    expect(explorerList(SUMMARY).map((r) => r.suiteId)).toEqual(['gsm8k-2568']);
    expect(explorerList(SUMMARY, 'grade-school').length).toBe(1); // matches the plain meaning too
    expect(explorerList(SUMMARY, 'zzz')).toEqual([]);
    expect(explorerList(SUMMARY, '', 't2')).toEqual([]);
    expect(explorerList(SUMMARY)[0].dots.map((d) => d.arm)).toEqual(['bare', 'platform', 'harness', 'silo', 'neuma']);
  });

  it('comparisons step newest first; the stats read every arm against bare', () => {
    const chips = setChips(suite);
    expect(chips.map((c) => c.n)).toEqual([25, 100, 50]);
    const four = chips.find((c) => c.n === 100).series;
    const stats = armStats(four);
    expect(stats.map((r) => [r.name, r.score, r.delta])).toEqual([
      ['BARE MODEL', '67%', null], ['PLATFORM WIRE', '87%', '+20.0'], ['SILO', '74%', '+7.0'], ['FULL BEING', '98%', '+31.0'],
    ]);
    expect(stats.every((r) => r.metrics.length >= 1)).toBe(true);
    expect(identityNote(four)).toBeNull(); // this fixture set shares one digest
    expect(identityNote({ protocolKeys: 2 })).toContain('silo pin');
  });

  it('the history places every run in time, per arm', () => {
    const four = setChips(suite).find((c) => c.n === 100).series;
    const { tracks, span } = historyTracks(four);
    expect(span.runs).toBe(four.history.length);
    expect(tracks.map((t) => t.arm)).toEqual(['bare', 'platform', 'silo', 'neuma']);
    for (const t of tracks) for (const p of t.points) { expect(p.x).toBeGreaterThanOrEqual(0); expect(p.x).toBeLessThanOrEqual(1); }
    expect(historyTracks({ history: [] }).span).toBeNull();
  });
});

describe('REPORTS sub-tabs, rendered for real', () => {
  it('the frame offers EXPLORER · LIBRARY · SHARE and shows the chosen one', () => {
    const html = renderToStaticMarkup(createElement(BenchReports, {
      sub: 'explorer', onSub: noop,
      explorer: { summary: SUMMARY, selectedSuite: null, onSelectSuite: noop, selectedSet: {}, onSet: noop, onShare: noop },
      library: {}, share: {},
    }));
    expect(html).toContain('>EXPLORER<');
    expect(html).toContain('>LIBRARY<');
    expect(html).toContain('>SHARE<');
    expect(html).toContain('Search benchmarks');
  });

  it('EXPLORER: the selected benchmark in depth — meaning, comparisons, chart, stats', () => {
    const four = setChips(SUMMARY.suites[0]).find((c) => c.n === 100);
    const html = renderToStaticMarkup(createElement(BenchExplorer, {
      summary: SUMMARY, selectedSuite: 'gsm8k-2568', onSelectSuite: noop,
      selectedSet: { 'gsm8k-2568': four.id }, onSet: noop, onShare: noop,
    }));
    expect(html).toContain(benchMeaning('gsm8k-2568'));
    expect(html).toContain('THIS CELL — 2568-token budget');
    expect(html).toContain('+31.0 pts');
    expect(html).toContain('width:98%');
    expect(html).toContain('EVERY ARM');
    expect(html).toContain('HISTORY —');
    expect(html).toContain('SHARE THIS');
    expect(renderToStaticMarkup(createElement(BenchExplorer, { summary: null }))).toContain('READING EVERY RECEIPT');
  });

  it('SHARE: picker, sizes, the three exports, the PNG preview, and the Markdown as it copies', () => {
    const lead = SUMMARY.suites[0].series[0];
    const html = renderToStaticMarkup(createElement(BenchShare, {
      summary: SUMMARY, source: { kind: 'series', id: lead.id }, size: '4x5', onSource: noop, onSize: noop,
      pngUrl: 'blob:card', markdown: '| **NEUMA** | **98.0%** |', busy: false, notice: 'IMAGE COPIED — PASTE IT INTO YOUR POST', refusal: null,
      onCopyImage: noop, onSavePng: noop, onCopyMarkdown: noop,
    }));
    expect(html).toContain('16:9');
    expect(html).toContain('4:5');
    expect(html).toContain('COPY IMAGE');
    expect(html).toContain('SAVE PNG');
    expect(html).toContain('COPY MARKDOWN');
    expect(html).toContain('src="blob:card"');
    expect(html).toContain('is-4x5');
    expect(html).toContain('IMAGE COPIED');
    expect(html).toContain('| **NEUMA** | **98.0%** |');
  });

  it('SHARE: a refused render reads verbatim; nothing to share says so', () => {
    const refused = renderToStaticMarkup(createElement(BenchShare, {
      summary: SUMMARY, source: { kind: 'proof', id: PROOF.id }, size: '16x9', onSource: noop, onSize: noop,
      pngUrl: null, markdown: null, busy: false, notice: null, refusal: 'Failed to render the card: no chromium',
      onCopyImage: noop, onSavePng: noop, onCopyMarkdown: noop,
    }));
    expect(refused).toContain('Failed to render the card: no chromium');
    const empty = renderToStaticMarkup(createElement(BenchShare, { summary: { suites: [], proofs: [], notTaken: [] } }));
    expect(empty).toContain('NOTHING TO SHARE YET');
  });
});
