// bench-why-view.test.js — THE WHY, proven over REAL evidence (RULE 0):
//   WHY IT MISSED — neuma-38's diagnosis (#557) of the real validation GSM8K
//     ×100 four-arm set (test/fixtures/bench/diagnose, captured 2026-09-26),
//     read by the plane's own diagnoseComparison, shaped by diagnosisView and
//     rendered by the real panel.
//   WHAT HAPPENED — the real failed heartbeat run (its receipt and its real
//     stderr, sha-matched to the receipt's artifact), read by the plane's own
//     readRunEvidence, shaped by evidenceView and rendered.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { addBenchRunFixtures } from '../helpers/bench-fixture-tree.js';
import { diagnoseComparison } from '../../backend/services/bench/bench-diagnose.js';
import { readRunEvidence, tailLines } from '../../backend/services/bench/bench-run-evidence.js';
import { diagnosisView, evidenceView, CAUSE_WORDS } from '../../frontend/app/RelinkShell/bench-why-view.js';
import { WhyItMissed, WhatHappened } from '../../frontend/app/RelinkShell/BenchWhy.jsx';

const SET = 'validate-20260925t193750z-gsm100-4arm';
const FAILED = 'night-20260921t031900z-heartbeat-neuma-a1-20260921032101811';
let root;
let DIAG;
let EVIDENCE;

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'bench-why-'));
  await fs.cp(path.resolve('test/fixtures/bench/diagnose'), path.join(root, 'runs'), { recursive: true });
  await addBenchRunFixtures(root);
  DIAG = await diagnoseComparison(SET, root);
  EVIDENCE = await readRunEvidence(FAILED, root);
});
afterAll(async () => { if (root) await fs.rm(root, { recursive: true, force: true }); });

describe('WHY IT MISSED over the real GSM8K ×100 set', () => {
  it('diagnosisView — every arm in ladder order, causes in judging order, counts that add up', () => {
    const v = diagnosisView(DIAG.diagnosis, 'silo');
    expect(v.rows.map((r) => r.name)).toEqual(['BARE MODEL', 'PLATFORM WIRE', 'SILO', 'FULL BEING']);
    const order = Object.keys(CAUSE_WORDS);
    expect(v.causes.map((c) => order.indexOf(c.id))).toEqual([...v.causes.map((c) => order.indexOf(c.id))].sort((a, b) => a - b));
    for (const r of v.rows) expect(r.counts.reduce((a, b) => a + b, 0)).toBe(r.missed);
    const silo = v.rows.find((r) => r.arm === 'silo');
    expect(silo.focus).toBe(true);
    const fmt = v.causes.findIndex((c) => c.id === 'format');
    expect(silo.counts[fmt]).toBeGreaterThan(silo.missed / 2); // SILO's gap is mostly format
    expect(silo.vsBare.lost).toBeGreaterThan(0);
    expect(silo.vsBare.lostBy).toContain('right answer, wrong format');
    expect(silo.examples.find((e) => e.id === 'format').items.length).toBeGreaterThan(0);
    expect(v.rows.find((r) => r.arm === 'bare').vsBare).toBeNull();
    // One line per arm, then one whose-miss line per agent arm with misses (2026-10-03).
    expect(v.findings.filter((f) => !f.includes('misses by owner')).length).toBe(4);
    expect(v.findings.filter((f) => f.includes('misses by owner')).every((f) => /model \d+ .* harness \d+/.test(f))).toBe(true);
  });

  it('the panel renders the findings, the table, the bars and COPY; a loading entry says so', () => {
    const html = renderToStaticMarkup(createElement(WhyItMissed, {
      comparisonId: SET, entry: { state: 'ready', data: DIAG, error: null }, onRequest: () => {}, focusArm: 'silo',
    }));
    expect(html).toContain('WHY IT MISSED');
    expect(html).toContain('why-findings');
    expect(html).toContain('Right answer, wrong format');
    expect(html).toContain('why-bar-part is-format');
    expect(html).toContain('<tr class="is-on">'); // the focused arm's row
    expect(html).toContain('WHAT IT ACTUALLY WROTE');
    expect(renderToStaticMarkup(createElement(WhyItMissed, { comparisonId: SET, entry: null, onRequest: () => {} }))).toContain('READING THE DIAGNOSIS');
    expect(renderToStaticMarkup(createElement(WhyItMissed, { comparisonId: SET, entry: { state: 'error', error: 'Could not diagnose the set: 404' }, onRequest: () => {} })))
      .toContain('TRY AGAIN');
  });

  it('a set no adapter can diagnose says so, arm by arm', () => {
    const v = diagnosisView({ comparisonId: 'x', cell: 'bfcl-smoke', arms: [], paired: [], findings: [], skipped: [{ arm: 'bare', runId: 'r', reason: 'adapter bfcl is not diagnosable yet' }] });
    expect(v.rows).toEqual([]);
    expect(v.skipped).toEqual([{ arm: 'bare', name: 'BARE MODEL', reason: 'adapter bfcl is not diagnosable yet', runId: 'r' }]);
  });
});

describe('SAMPLE MISMATCH leads the panel (the real unpaired MMLU-Pro-8192 set)', () => {
  it('the banner names the arms, the finding is not repeated, and the shared count shows', async () => {
    const d = await diagnoseComparison('desk-2026-09-27t19-34-38', root);
    const v = diagnosisView(d.diagnosis);
    expect(v.mismatch).toEqual({ arms: ['PLATFORM WIRE'] });
    expect(v.findings.some((f) => f.startsWith('SAMPLE MISMATCH'))).toBe(false);
    expect(v.rows.find((r) => r.arm === 'platform').vsBare.shared).toMatch(/^\d+\/\d+ shared$/);
    const html = renderToStaticMarkup(createElement(WhyItMissed, {
      comparisonId: 'desk-2026-09-27t19-34-38', entry: { state: 'ready', data: d, error: null }, onRequest: () => {},
    }));
    expect(html).toContain('data-testid="why-sample-mismatch"');
    expect(html).toContain('did not answer the same questions');
  });

  it('a matched set shows no banner', () => {
    expect(diagnosisView(DIAG.diagnosis).mismatch).toBeNull();
  });
});

describe('WHAT HAPPENED over the real failed heartbeat run', () => {
  it('readRunEvidence — the stage that died and the real stderr tail, the cause in it', () => {
    expect(EVIDENCE.executions).toEqual([expect.objectContaining({ stage: 'lm-eval', exitCode: 1, ok: false, timedOut: false })]);
    expect(EVIDENCE.logs.map((l) => l.kind)).toEqual(['stderr']); // the empty stdout is not evidence
    expect(EVIDENCE.logs[0].tail).toContain('502 Server Error: Bad Gateway');
  });

  it('evidenceView + the panel — EXIT 1 in the alert register, the log, a paste-ready block', () => {
    const v = evidenceView(EVIDENCE);
    expect(v.stages).toEqual([expect.objectContaining({ stage: 'LM-EVAL', text: 'EXIT 1', register: 'loud' })]);
    expect(v.copyText).toContain(`WHAT HAPPENED · ${FAILED}`);
    expect(v.copyText).toContain('502 Server Error');
    const html = renderToStaticMarkup(createElement(WhatHappened, { runId: FAILED, entry: { state: 'ready', data: EVIDENCE }, onRequest: () => {} }));
    expect(html).toContain('why-stage is-loud');
    expect(html).toContain('Bad Gateway');
  });

  it('a crafted id never leaves the tree; an unknown run reads null', async () => {
    await expect(readRunEvidence('../../etc', root)).rejects.toMatchObject({ code: 'BENCH_BAD_ID' });
    expect(await readRunEvidence('no-such-run', root)).toBeNull();
  });

  it('tailLines — colour codes stripped, a cut first line dropped, trailing blanks trimmed', () => {
    expect(tailLines('half line\nkeep\n\u001b[31mred\u001b[0m\n\n', { cut: true })).toBe('keep\nred');
    expect(tailLines('a\nb\nc', { lines: 2 })).toBe('b\nc');
  });
});
