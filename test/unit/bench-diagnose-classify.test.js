// bench-diagnose-classify.test.js — the run diagnosis's pure half (#557),
// judged over REAL lm-eval sample rows and proxy telemetry captured from the
// 2026-09-26 validation night (test/fixtures/bench/diagnose). Every cause is
// produced from the evidence that defines it; no mocks, no invented rows.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import {
  foldDocs, causeOf, linkTelemetry, diagnoseArm, pairAgainstBare, findingsOf, lastNumber, parseMetricId,
  summarizeToolTrail,
} from '../../backend/services/bench/bench-diagnose-classify.js';
import { renderDiagnosis } from '../../backend/services/bench/bench-diagnose-report.js';

const FIX = path.resolve('test/fixtures/bench/diagnose');
const load = (prefix, arm) => {
  const runId = readdirSync(FIX).find((d) => d.startsWith(prefix) && d.includes(`-${arm}-a`));
  const receipt = JSON.parse(readFileSync(path.join(FIX, runId, 'receipt.json'), 'utf8'));
  const rows = readFileSync(path.join(FIX, runId, 'raw/model/samples_fixture.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  const telFile = readdirSync(path.join(FIX, runId, 'raw')).find((n) => n.endsWith('-telemetry.json'));
  const perRequest = telFile ? JSON.parse(readFileSync(path.join(FIX, runId, 'raw', telFile), 'utf8')).perRequest : null;
  return { arm, runId, headlineId: receipt.metrics.find((m) => m.primary).id, rows, perRequest };
};
const GSM = 'validate-20260925t193750z-gsm100-4arm';
const IFEVAL = 'validate-20260925t193750z-ifeval50-4arm';
const itemOf = (diag, docId) => diag.items.find((i) => i.docId === docId);

describe('the causes, each from its own evidence (GSM8K x100, real rows)', () => {
  const platform = diagnoseArm(load(GSM, 'platform'));
  const silo = diagnoseArm(load(GSM, 'silo'));
  const bare = diagnoseArm(load(GSM, 'bare'));

  it('format — SILO writes the right number without the #### marker', () => {
    const doc10 = itemOf(silo, 10);
    expect(doc10.cause).toBe('format');
    expect(doc10.gold).toBe('366');
    expect(doc10.answerTail).toContain('**366**');
  });

  it('budget-in-reasoning — a blank answer whose request ended on the length cut', () => {
    const doc93 = itemOf(platform, 93);
    expect(doc93.cause).toBe('budget-in-reasoning');
    expect(doc93.telemetry.finishReason).toBe('length');
    expect(doc93.telemetry.contentChars).toBe(0);
    expect(doc93.telemetry.reasoningChars).toBeGreaterThan(0);
  });

  it('cut-off — words on the wire, then the budget ended the answer', () => {
    const doc85 = itemOf(platform, 85);
    expect(doc85.cause).toBe('cut-off');
    expect(doc85.answerTail).toBe('He has been vacation');
  });

  it('without per-request telemetry the same blank reads as plain blank, and says so', () => {
    expect(itemOf(bare, 93).cause).toBe('blank');
    expect(bare.telemetry).toBe('none');
    expect(findingsOf([bare], [])[0]).toContain('budget cuts (blank or cut-off answers) are invisible');
  });

  it('grader-rejected-equal — $26.00 against gold 26 is a grader miss, not a model miss', () => {
    const doc24 = itemOf(bare, 24);
    expect(doc24.cause).toBe('grader-rejected-equal');
    expect(doc24.answerTail).toContain('$26.00');
  });

  it('wrong — a genuinely wrong number stays wrong', () => {
    const doc12 = diagnoseArm(load(GSM, 'bare'));
    expect(doc12.items.filter((i) => i.cause === 'wrong').length).toBeGreaterThan(0);
  });
});

describe('IFEval (real rows)', () => {
  it('broke-instruction names the instruction ids that failed; the placeholder gold never reads as a number', () => {
    const neuma = diagnoseArm(load(IFEVAL, 'neuma'));
    const broke = neuma.items.filter((i) => i.cause === 'broke-instruction');
    expect(broke.length).toBeGreaterThan(0);
    expect(broke[0].brokenInstructions.every((id) => id.includes(':'))).toBe(true);
    expect(neuma.items.some((i) => i.cause === 'grader-rejected-equal')).toBe(false);
  });
});

describe('pairing against BARE', () => {
  it('SILO lost items by cause and gained others; the harness equals BARE item for item', () => {
    const arms = ['bare', 'platform', 'silo', 'neuma'].map((a) => diagnoseArm(load(GSM, a)));
    const paired = pairAgainstBare(arms);
    const silo = paired.find((p) => p.arm === 'silo');
    expect(silo.lostBy.format).toBeGreaterThan(0);
    const neuma = paired.find((p) => p.arm === 'neuma');
    expect(neuma.lost).toBe(0);
    expect(neuma.gained).toBeGreaterThan(0);
    const md = renderDiagnosis({ comparisonId: GSM, cell: 'gsm8k-2568', arms, paired, findings: findingsOf(arms, paired), skipped: [] });
    expect(md).toContain('## BENCH RUN DIAGNOSIS — gsm8k-2568');
    expect(md).toContain('### Against BARE');
    expect(md).toContain('right answer, wrong format');
  });
});

describe('telemetry linking', () => {
  it('links by content hash when the proxy recorded one, exactly', () => {
    const docs = [{ docId: 1, response: 'same length A' }, { docId: 2, response: 'same length B' }];
    const sha = (t) => createHash('sha256').update(t, 'utf8').digest('hex');
    const perRequest = [
      { finishReason: 'length', contentChars: 13, contentSha256: sha('same length B') },
      { finishReason: 'stop', contentChars: 13, contentSha256: sha('same length A') },
    ];
    const links = linkTelemetry(docs, perRequest);
    expect(links.get(1).finishReason).toBe('stop');
    expect(links.get(2).finishReason).toBe('length');
    expect(links.get(1).linkedBy).toBe('hash');
  });

  it('flags an equal-length link whose finish reasons differ as ambiguous', () => {
    const links = linkTelemetry([{ docId: 1, response: 'abc' }], [
      { finishReason: 'stop', contentChars: 3 }, { finishReason: 'length', contentChars: 3 },
    ]);
    expect(links.get(1).ambiguous).toBe(true);
    expect(links.get(1).linkedBy).toBe('length');
  });
});

describe('small parsers', () => {
  it('lastNumber strips currency and thousands separators', () => {
    expect(lastNumber('Her salary is **$57,500**.')).toBe(57500);
    expect(lastNumber('no digits here')).toBeNull();
  });
  it('parseMetricId splits task/metric,filter', () => {
    expect(parseMetricId('gsm8k/exact_match,strict-match')).toEqual({ metric: 'exact_match', filter: 'strict-match' });
  });
  it('a passing doc has no cause', () => {
    const [doc] = foldDocs([{ doc_id: 0, filter: 'none', metrics: ['exact_match'], exact_match: 1, resps: [['x']], target: '1' }], 'x/exact_match,none');
    expect(causeOf(doc, null)).toBeNull();
  });
});

describe('what the being touched (#564)', () => {
  // Real receipt shapes: the 8192 IFEval run's receipts carried only a count;
  // a trail-era receipt carries every call.
  const counted = [{ toolCalls: 5 }, { toolCalls: 0 }];
  const trailed = [
    { toolCalls: 2, toolTrail: [
      { tool: 'web/web_fetch', target: 'https://en.wikipedia.org/wiki/Tang_dynasty', status: 'ok' },
      { tool: 'fs/write', target: 'notes/draft.md', status: 'ok' },
    ] },
    { toolCalls: 1, toolTrail: [{ tool: 'fs/write', target: null, status: 'error' }] },
    { toolCalls: 0, toolTrail: [] },
  ];

  it('receipts that predate the trail are only counted, and say so', () => {
    const t = summarizeToolTrail(counted);
    expect(t).toMatchObject({ recorded: false, calls: 5, answersWithTools: 1, answers: 2 });
    const arm = { ...diagnoseArm(load(IFEVAL, 'neuma')), toolUse: t };
    expect(renderDiagnosis({ comparisonId: IFEVAL, cell: 'ifeval', arms: [arm], paired: [], findings: [], skipped: [] }))
      .toContain('predate the tool trail');
  });

  it('a trail names every web and write target and counts what failed', () => {
    const t = summarizeToolTrail(trailed);
    expect(t).toMatchObject({ recorded: true, calls: 3, answersWithTools: 2, failed: 1 });
    expect(t.byTool).toEqual({ 'web/web_fetch': 1, 'fs/write': 2 });
    expect(t.webTargets).toEqual(['https://en.wikipedia.org/wiki/Tang_dynasty']);
    expect(t.writeTargets).toEqual(['notes/draft.md']);
    const arm = { ...diagnoseArm(load(IFEVAL, 'neuma')), toolUse: t };
    const md = renderDiagnosis({ comparisonId: IFEVAL, cell: 'ifeval', arms: [arm], paired: [], findings: [], skipped: [] });
    expect(md).toContain('### What the being touched (audit)');
    expect(md).toContain('`https://en.wikipedia.org/wiki/Tang_dynasty`');
  });
});

describe('whose miss — model, harness or identity (ruling, 2026-10-03)', () => {
  const arm = (name, misses) => ({ arm: name, items: ['a', 'b', 'c', 'd'].map((h) => ({ docHash: h, cause: misses[h] ?? null })) });
  it('BARE also missed → model; BARE answered → harness (with its cause); HARNESS answered → identity', async () => {
    const { verdictsOf, verdictFindingsOf } = await import('../../backend/services/bench/bench-diagnose-classify.js');
    const verdicts = verdictsOf([
      arm('bare', { a: 'wrong' }),
      arm('harness', { a: 'wrong', b: 'unrunnable' }),
      arm('neuma', { a: 'wrong', b: 'unrunnable', c: 'wrong' }),
    ]);
    expect(verdicts).toEqual([
      { arm: 'harness', model: 1, harness: 1, identity: 0, unjudged: 0, harnessBy: { unrunnable: 1 } },
      { arm: 'neuma', model: 1, harness: 1, identity: 1, unjudged: 0, harnessBy: { unrunnable: 1 } },
    ]);
    const [h, n] = verdictFindingsOf(verdicts);
    expect(h).toContain('harness 1 (1 unrunnable)');
    expect(n).toContain('identity 1');
    expect(verdictsOf([arm('harness', { a: 'wrong' })])).toEqual([]);
  });
});

