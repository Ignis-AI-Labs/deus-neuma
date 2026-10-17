/**
 * THE REPORT OF ONE BENCHMARK SET — what the operator reviews when a set ends
 * (Design note, 2026-10-15: […]).
 *
 * One comparison, pressed with the house brand (doc-press, the ignis-research
 * kit): the scores of every arm (status, score, items, prompt tokens per
 * request, time) above the set's own diagnosis — what got in the way, misses
 * by cause, what each layer gained or lost against BARE on the same items, the
 * tools the agent arms touched, and examples (bench-diagnose.js). Written
 * under the data root as HTML (opens in the browser — the link) and PDF (the
 * pressed copy); a machine that cannot press keeps the HTML.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getDataRoot } from '../data-root.js';
import { buildDocumentHtml, loadBrandKit, pressBody, pressDocument } from '../doc-press/index.js';
import { COMPARISON_ID_RE, diagnoseComparison } from './bench-diagnose.js';
import { listRuns } from './bench-reports.js';
import { createLogger } from '../logger.js';

const log = createLogger('Bench');
const KIT = 'ignis-research';
const ARM_ORDER = ['bare', 'platform', 'harness', 'silo', 'neuma'];

/** Where one set's report lives. Pure (given the data root). */
export const reportPaths = (comparisonId) => {
  const dir = join(getDataRoot(), 'benchmarks', 'reports');
  return { dir, html: join(dir, `${comparisonId}.html`), pdf: join(dir, `${comparisonId}.pdf`), md: join(dir, `${comparisonId}.md`) };
};

const pct = (v) => (typeof v === 'number' ? (v <= 1 ? `${Math.round(v * 1000) / 10}%` : String(v)) : '—');
const perRequest = (r) => (r.efficiency?.promptTokens && r.efficiency?.requests ? Math.round(r.efficiency.promptTokens / r.efficiency.requests).toLocaleString('en-US') : '—');
const minutes = (r) => (r.durationMs ? `${Math.max(1, Math.round(r.durationMs / 60000))} min` : '—');

/** The report's head: the set, then every arm's line (items from the diagnosis). Pure. */
export const reportHead = (comparisonId, cell, runs, diagnosed = []) => [
  `# Benchmark report — ${cell}`,
  '',
  `Comparison \`${comparisonId}\` · ${String(runs[0]?.finishedAt || '').slice(0, 16).replace('T', ' ')} UTC`,
  '',
  '| Arm | Status | Score | Items | Prompt tokens / request | Time |',
  '| --- | --- | --- | --- | --- | --- |',
  ...[...runs].sort((a, b) => ARM_ORDER.indexOf(a.arm) - ARM_ORDER.indexOf(b.arm)).map((r) =>
    `| ${r.arm} | ${r.status} | ${pct(r.primaryMetric?.value ?? r.value)} | ${diagnosed.find((a) => a.arm === r.arm)?.total ?? '—'} | ${perRequest(r)} | ${minutes(r)} |`),
  '',
].join('\n');

/**
 * Write one set's report. impure.
 * @returns {Promise<?{html: string, pdf: ?string, md: string}>} null when no receipt carries the comparison
 */
export const pressComparisonReport = async (comparisonId) => {
  if (!COMPARISON_ID_RE.test(String(comparisonId))) return null;
  const [found, ledger] = await Promise.all([diagnoseComparison(comparisonId), listRuns(undefined, 300).catch(() => [])]);
  const runs = ledger.filter((r) => r.comparisonId === comparisonId);
  if (!found && !runs.length) return null;
  const cell = found?.diagnosis?.cell ?? runs[0]?.suiteId ?? '?';
  const markdown = `${reportHead(comparisonId, cell, runs, found?.diagnosis?.arms)}\n${found?.markdown ?? '_No scored samples on disk to diagnose._'}\n`;
  const paths = reportPaths(comparisonId);
  const title = `Benchmark report — ${cell} — ${comparisonId}`;
  await mkdir(paths.dir, { recursive: true });
  await writeFile(paths.md, markdown);
  // the house kit, else the neutral one — a machine without the kit still gets its report
  const kit = await loadBrandKit({ kitId: KIT }).catch(() => loadBrandKit({}));
  await writeFile(paths.html, buildDocumentHtml({ bodyHtml: pressBody(markdown, kit), kit, title }));
  const pdf = await pressDocument({ markdown, title, kitId: kit.id, outputPath: paths.pdf })
    .then(() => paths.pdf)
    .catch((err) => { log.warn('benchmark report not pressed to PDF — the HTML stands', { comparisonId, error: err.message }); return null; });
  return { html: paths.html, pdf, md: paths.md };
};
