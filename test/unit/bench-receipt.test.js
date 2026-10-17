// bench-receipt.test.js — an invalidated run never scores on the desk.
// The harness strikes a run by writing runs/<id>/invalidation.json beside the
// kept receipt (benchmarks runtime/benchmark-store.js invalidateRun); every
// desk reader must read that run as the harness does: failed, the audit
// attached. Proven over the REAL fixture receipts (test/fixtures/bench/runs —
// the four-arm GSM8K n=100 set) copied into a temp harness tree, with the
// audit written in the harness's own shape (RULE 0: nothing hand-built but
// the strike itself, which is the thing under test).

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { addBenchRunFixtures } from '../helpers/bench-fixture-tree.js';
import { applyInvalidation, readRunReceipt } from '../../backend/services/bench/bench-receipt.js';
import { readAllRunReceipts, suitesSummary } from '../../backend/services/bench/bench-summary.js';
import { listRuns } from '../../backend/services/bench/bench-reports.js';
import { runFocus, ledgerCounts } from '../../frontend/app/RelinkShell/bench-ledger-view.js';

const SET = 'night-20260915t150502z-gsm100-4arm';
const BARE = `${SET}-bare-a1-20260915152006653`;
const AUDIT = { runId: BARE, reason: 'BARE received the harness stop list before BONES-1 (8644d58b).', by: 'founder', at: '2026-09-26T02:00:00.000Z' };

let root;
beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'bench-receipt-'));
  await addBenchRunFixtures(root);
  await fs.writeFile(path.join(root, 'runs', BARE, 'invalidation.json'), `${JSON.stringify(AUDIT, null, 2)}\n`, { flag: 'wx' });
});
afterAll(async () => { if (root) await fs.rm(root, { recursive: true, force: true }); });

describe('the one door', () => {
  it('an audited run reads failed with its audit; the receipt itself is kept', async () => {
    const r = await readRunReceipt(root, BARE);
    expect(r.status).toBe('failed');
    expect(r.originalStatus).toBe('succeeded');
    expect(r.invalidation).toEqual(AUDIT);
    expect(r.failure).toEqual({ code: 'BENCHMARK_INVALIDATED', stage: 'review', message: AUDIT.reason });
    expect(r.metrics.length).toBeGreaterThan(0); // the measurement is preserved, only excluded
  });

  it('an unaudited run reads exactly as written', async () => {
    const id = `${SET}-neuma-a1-20260915160626075`;
    const raw = JSON.parse(await fs.readFile(path.join(root, 'runs', id, 'receipt.json'), 'utf8'));
    expect(await readRunReceipt(root, id)).toEqual(raw);
  });

  it('a malformed audit still strikes the run — it never lets it score', () => {
    const r = applyInvalidation({ status: 'succeeded' }, { runId: 'someone-else' }, 'x');
    expect(r.status).toBe('failed');
    expect(r.invalidation.reason).toMatch(/malformed/);
  });
});

describe('every desk reader honors the strike', () => {
  it('the summary (Atlas, Explorer, share cards): the struck run stands in no series and no history', async () => {
    const suites = suitesSummary(await readAllRunReceipts(root));
    const all = suites.flatMap((s) => s.series);
    expect(all.flatMap((x) => x.arms.map((a) => a.runId))).not.toContain(BARE);
    expect(all.flatMap((x) => (x.history ?? []).map((h) => h.runId))).not.toContain(BARE);
    // The set's other arms still stand (the fixture's older n=100 bare, not
    // struck here, is what the series now measures against).
    const series = all.find((x) => x.arms.some((a) => a.runId?.startsWith(SET)));
    expect(series.arms.filter((a) => a.runId?.startsWith(SET)).map((a) => a.arm).sort()).toEqual(['neuma', 'platform', 'silo']);
  });

  it('the RUNS ledger: INVALIDATED, the score never shown as a reading, never counted as landed', async () => {
    const runs = await listRuns(root);
    const row = runs.find((r) => r.runId === BARE);
    expect(row.status).toBe('failed');
    expect(row.invalidation.reason).toBe(AUDIT.reason);
    const f = runFocus(row, runs, Date.parse('2026-09-26T03:00:00Z'));
    expect(f.status).toBe('invalidated');
    expect(f.mark).toBe('INVALIDATED');
    expect(f.score).toBe('—');
    expect(f.invalidation.was).toBe('SUCCEEDED 67.0%');
    expect(f.failure.code).toBe('BENCHMARK_INVALIDATED');
    // Its siblings lose their "vs bare": the floor they stood on is struck.
    const neuma = runs.find((r) => r.comparisonId === SET && r.arm === 'neuma');
    expect(runFocus(neuma, runs, Date.parse('2026-09-26T03:00:00Z')).delta).toBeNull();
    const c = ledgerCounts(runs);
    expect(c.invalidated).toBe(1);
    expect(c.succeeded).toBe(6);
  });
});
