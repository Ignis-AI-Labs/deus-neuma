/**
 * ONE SET'S REPORT (RULE 0) — what the operator reviews when a benchmark ends
 * (Design note, 2026-10-15: […]).
 * The real benchmarks repository on this machine (read only), the real
 * diagnosis, the real press (doc-press, the house kit, real Chromium), written
 * to a temp data root. Skips when no benchmarks repository is connected or it
 * holds no comparison yet.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { available, harnessRoot } from '../../backend/services/bench/bench-paths.js';
import { listRuns } from '../../backend/services/bench/bench-reports.js';
import { pressComparisonReport, reportHead } from '../../backend/services/bench/bench-comparison-report.js';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const saved = { data: process.env.NEUMA_DATA_ROOT, kits: process.env.NEUMA_BRAND_KITS_DIR };
let comparison = null;

beforeAll(async () => {
  process.env.NEUMA_DATA_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-report-'));
  process.env.NEUMA_BRAND_KITS_DIR = path.join(REPO, 'data', 'brand-kits');
  if (available(harnessRoot())) {
    const runs = await listRuns(undefined, 50);
    comparison = runs.find((r) => r.arm === 'bare' && r.status === 'succeeded' && runs.some((o) => o.comparisonId === r.comparisonId && o.arm !== 'bare'))?.comparisonId ?? null;
  }
});
afterAll(() => {
  fs.rmSync(process.env.NEUMA_DATA_ROOT, { recursive: true, force: true });
  for (const [k, env] of [['data', 'NEUMA_DATA_ROOT'], ['kits', 'NEUMA_BRAND_KITS_DIR']]) {
    if (saved[k] === undefined) delete process.env[env]; else process.env[env] = saved[k];
  }
});

describe('the report a settled set leaves for review', () => {
  test('the head names the set and every arm: status, score, items, tokens, time', () => {
    const head = reportHead('desk-1', 'smoke', [
      { arm: 'harness', status: 'succeeded', primaryMetric: { value: 1 }, efficiency: { promptTokens: 15025, requests: 5 }, durationMs: 60000, finishedAt: '2026-10-15T11:39:00Z' },
      { arm: 'bare', status: 'succeeded', primaryMetric: { value: 0.8 }, efficiency: { promptTokens: 6620, requests: 5 }, durationMs: 120000 },
    ], [{ arm: 'bare', total: 5 }, { arm: 'harness', total: 5 }]);
    expect(head).toContain('# Benchmark report — smoke');
    expect(head).toContain('| bare | succeeded | 80% | 5 | 1,324 | 2 min |');
    expect(head).toContain('| harness | succeeded | 100% | 5 | 3,005 | 1 min |');
    expect(head.indexOf('| bare')).toBeLessThan(head.indexOf('| harness')); // arms in their order
  });

  test.runIf(available(harnessRoot()))('a real set presses to a branded page and a PDF', async (ctx) => {
    if (!comparison) ctx.skip();
    const pressed = await pressComparisonReport(comparison);
    expect(pressed.html).toBe(path.join(process.env.NEUMA_DATA_ROOT, 'benchmarks', 'reports', `${comparison}.html`));
    const html = fs.readFileSync(pressed.html, 'utf8');
    expect(html).toContain('Benchmark report');
    expect(html).toContain(comparison);
    expect(fs.readFileSync(pressed.md, 'utf8')).toMatch(/\| bare \| succeeded \|/);
    if (pressed.pdf) expect(fs.readFileSync(pressed.pdf).subarray(0, 5).toString()).toBe('%PDF-');
  }, 120000);

  test('an unknown or malformed set has no report', async () => {
    expect(await pressComparisonReport('no-such-comparison-anywhere')).toBeNull();
    expect(await pressComparisonReport('../../etc/passwd')).toBeNull();
  });
});
