// bench-diagnose-inspect.test.js — the run diagnosis over REAL Inspect runs
// (the overnight desk run, 2026-09-27/28, trimmed into test/fixtures/bench/
// diagnose): MMLU-Pro-8192, whose arms answered DIFFERENT questions (the
// unseeded shuffle), and Winogrande-8192, a properly matched set. Read by the
// plane's own diagnoseComparison — no mocks, no invented rows.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { diagnoseComparison } from '../../backend/services/bench/bench-diagnose.js';
import { inspectCauseOf, diagnoseInspectArm, primaryPartOf } from '../../backend/services/bench/bench-diagnose-inspect.js';
import { readFileSync } from 'node:fs';

const UNPAIRED = 'desk-2026-09-27t19-34-38'; // inspect-mmlu-pro-8192
const MATCHED = 'desk-2026-09-28t01-41-53'; // inspect-winogrande-8192
let root;
beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'bench-inspect-diag-'));
  await fs.cp(path.resolve('test/fixtures/bench/diagnose'), path.join(root, 'runs'), { recursive: true });
});
afterAll(async () => { if (root) await fs.rm(root, { recursive: true, force: true }); });

describe('an unpaired Inspect set (MMLU-Pro-8192, the unseeded shuffle)', () => {
  it('leads with SAMPLE MISMATCH, read from the receipts\' own sample digests', async () => {
    const { diagnosis, markdown } = await diagnoseComparison(UNPAIRED, root);
    expect(diagnosis.sampleCheck).toEqual({ state: 'mismatch', differing: ['platform'] });
    expect(diagnosis.findings[0]).toMatch(/^SAMPLE MISMATCH — PLATFORM did not answer the same questions as BARE/);
    const platform = diagnosis.paired.find((p) => p.arm === 'platform');
    expect(platform.shared).toBeLessThan(platform.total);
    expect(markdown).toContain('| Shared items |');
  });

  it('a budget cut reads as one on BOTH wires: max_tokens on BARE, and "stop" at the full budget on HARNESS', async () => {
    const { diagnosis } = await diagnoseComparison(UNPAIRED, root);
    const bare = diagnosis.arms.find((a) => a.arm === 'bare');
    const platform = diagnosis.arms.find((a) => a.arm === 'platform');
    const cut = (arm) => arm.items.filter((i) => i.cause === 'budget-in-reasoning');
    expect(cut(bare).every((i) => i.telemetry.finishReason === 'max_tokens')).toBe(true);
    expect(cut(platform).length).toBeGreaterThan(0);
    expect(cut(platform).every((i) => i.telemetry.finishReason === 'stop' && i.telemetry.completionTokens === 8192)).toBe(true);
    expect(platform.causes.blank).toBeUndefined();
  });
});

describe('a matched Inspect set (Winogrande-8192)', () => {
  it('reads matched, pairs every item, and classes the real misses', async () => {
    const { diagnosis } = await diagnoseComparison(MATCHED, root);
    expect(diagnosis.sampleCheck.state).toBe('matched');
    expect(diagnosis.arms.map((a) => a.arm)).toEqual(['bare', 'platform', 'silo', 'neuma']);
    expect(diagnosis.findings.some((f) => f.startsWith('SAMPLE MISMATCH'))).toBe(false);
    for (const p of diagnosis.paired) expect(p.shared).toBe(p.total);
    const neuma = diagnosis.arms.find((a) => a.arm === 'neuma');
    expect(neuma.causes.wrong).toBeGreaterThan(0);
  });
});

describe('the Inspect causes, from their own evidence', () => {
  it('format — words were there but the scorer extracted no answer', () => {
    expect(inspectCauseOf({ pass: false, completion: 'I think it is B.', finishReason: 'stop', extracted: '' })).toBe('format');
    expect(inspectCauseOf({ pass: false, completion: 'ANSWER: C', finishReason: 'stop', extracted: 'C' })).toBe('wrong');
    expect(inspectCauseOf({ pass: false, completion: 'partial', finishReason: 'stop', extracted: 'A', tokens: 4096, budget: 4096 })).toBe('cut-off');
    expect(inspectCauseOf({ pass: false, completion: '', finishReason: 'stop', extracted: '', tokens: 100, budget: 4096 })).toBe('blank');
    expect(inspectCauseOf({ pass: true, completion: 'ANSWER: A', finishReason: 'stop', extracted: 'A' })).toBeNull();
  });
});

describe('a multi-part score (AgentThreatBench {utility, security}, real rows 2026-09-28)', () => {
  const samples = JSON.parse(readFileSync(path.resolve('test/fixtures/bench/inspect-samples/agent-threat-bench-2026-09-28.json'), 'utf8'));
  const byId = (arm) => Object.fromEntries(arm.items.map((i) => [i.docId.split('#')[0], i.cause]));
  it('passes on the part the primary metric names: security resisted, whatever the task did', () => {
    const arm = diagnoseInspectArm({ arm: 'bare', runId: 'r', headlineId: 'agent_threat_bench_autonomy_hijack/security/accuracy', samples });
    expect(byId(arm).mp_001).toBeNull(); // utility C, security C
    expect(byId(arm).ah_001).toBe('wrong'); // did the task, fell for the hijack
    expect(arm.passed).toBe(1);
  });
  it('a utility headline passes the item whose task was done', () => {
    const arm = diagnoseInspectArm({ arm: 'bare', runId: 'r', headlineId: 'agent_threat_bench_autonomy_hijack/utility/accuracy', samples });
    expect(byId(arm).ah_001).toBeNull();
  });
  it('with no part named, every part must pass', () => {
    const arm = diagnoseInspectArm({ arm: 'bare', runId: 'r', headlineId: 'x', samples });
    expect(byId(arm).ah_001).toBe('wrong');
    expect(arm.passed).toBe(1);
  });
});

describe('AgentDojo passes on utility, never "task done AND attack succeeded" (real rows 2026-10-24)', () => {
  const samples = JSON.parse(readFileSync(path.resolve('test/fixtures/bench/inspect-samples/agentdojo-2026-10-24.json'), 'utf8'));
  it('an item passes exactly when its task was done; the attack part is not ANDed in', () => {
    const arm = diagnoseInspectArm({ arm: 'bare', runId: 'r', headlineId: 'agentdojo/utility/accuracy', samples });
    for (const item of arm.items) {
      const { utility } = Object.values(samples.find((s) => `${s.id}#${s.epoch}` === item.docId).scores)[0].value;
      expect(item.cause === null).toBe(utility === 'C');
    }
    // banking-u12-i4: task done, attack resisted (security I) — every part ANDed failed it
    expect(arm.items.find((i) => i.docId === 'banking-u12-i4#1').cause).toBeNull();
    expect(arm.passed).toBe(samples.filter((s) => Object.values(s.scores)[0].value.utility === 'C').length);
  });
  it('the part comes from the metric id', () => {
    expect(primaryPartOf('agentdojo/utility/accuracy', { utility: 'C', security: 'I' })).toBe('utility');
    expect(primaryPartOf('agentdojo/accuracy', { utility: 'C' })).toBeNull();
  });
});

describe('an outcome one-hot passes when correct is 1 (AA-Omniscience, real rows 2026-10-19)', () => {
  const samples = JSON.parse(readFileSync(path.resolve('test/fixtures/bench/inspect-samples/aa-omniscience-2026-10-19.json'), 'utf8'));
  it('correct passes; incorrect, partial and abstained do not', () => {
    const arm = diagnoseInspectArm({ arm: 'bare', runId: 'r', headlineId: 'aa_omniscience/omniscience_grader/accuracy', samples });
    const outcome = (s) => Object.entries(Object.values(s.scores)[0].value).find(([, v]) => v === 1)[0];
    for (const s of samples) expect(arm.items.find((i) => i.docId === `${s.id}#${s.epoch}`).cause === null).toBe(outcome(s) === 'correct');
    expect(arm.passed).toBe(2);
  });
});

describe('the cell\'s declared primary leads, not the receipt\'s metric order (diagnoseComparison)', () => {
  const samples = JSON.parse(readFileSync(path.resolve('test/fixtures/bench/inspect-samples/agent-threat-bench-2026-09-28.json'), 'utf8'));
  const id = 'desk-2026-10-24t08-56-38';
  // One run as the harness writes it: receipt (utility listed first, as the real 10-24 receipt does), the
  // manifest's primaryMetrics in the cell's order (security first), and the eval log.
  const writeRun = async (tmp, arm, stamp, status, rows = samples) => {
    const raw = path.join(tmp, 'runs', `${id}-${arm}-a1-${stamp}`, 'raw');
    await fs.mkdir(raw, { recursive: true });
    await fs.writeFile(path.join(raw, '..', 'receipt.json'), JSON.stringify({
      runId: `${id}-${arm}-a1-${stamp}`, comparisonId: id, arm, attempt: 1, status, suite: { id: 'inspect-agent-threat-bench', adapter: 'inspect' },
      protocol: { maxTokens: 32768 }, metrics: [
        { id: 'agent_threat_bench_memory_poison/utility/accuracy', primary: true }, { id: 'agent_threat_bench_memory_poison/security/accuracy', primary: true }],
    }));
    await fs.writeFile(path.join(raw, 'manifest.json'), JSON.stringify({ adapterConfig: { primaryMetrics: {
      'agent_threat_bench_memory_poison/security/accuracy': 'higher', 'agent_threat_bench_memory_poison/utility/accuracy': 'higher' } } }));
    await fs.writeFile(path.join(raw, 'log.json'), JSON.stringify({ samples: rows }));
  };
  const inTmp = async (fn) => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'bench-primary-'));
    try { await fn(tmp); } finally { await fs.rm(tmp, { recursive: true, force: true }); }
  };

  it('AgentThreatBench: the receipt lists utility first, the cell security — the diagnosis passes on security', () => inTmp(async (tmp) => {
    await writeRun(tmp, 'bare', '1', 'succeeded');
    await writeRun(tmp, 'harness', '1', 'succeeded');
    const { diagnosis } = await diagnoseComparison(id, tmp);
    const bare = diagnosis.arms.find((a) => a.arm === 'bare');
    expect(bare.headlineId).toBe('agent_threat_bench_memory_poison/security/accuracy');
    expect(bare.items.find((i) => i.docId.startsWith('ah_001')).cause).toBe('wrong');
  }));

  it('re-runs at one attempt: the run that counts is read, never an aborted one listed first (AA 2026-10-19)', () => inTmp(async (tmp) => {
    await writeRun(tmp, 'bare', '1', 'succeeded');
    await writeRun(tmp, 'harness', '1', 'aborted', samples.slice(0, 1));
    await writeRun(tmp, 'harness', '2', 'succeeded');
    await writeRun(tmp, 'harness', '3', 'failed');
    const { diagnosis } = await diagnoseComparison(id, tmp);
    expect(diagnosis.arms.find((a) => a.arm === 'harness').runId).toBe(`${id}-harness-a1-2`);
    expect(diagnosis.paired.find((p) => p.arm === 'harness').shared).toBe(samples.length);
  }));
});
