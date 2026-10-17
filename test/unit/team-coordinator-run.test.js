// team-coordinator-run.test.js — the coordination EXECUTION, proven with a
// scripted ask. runTeam is exercised through its injected `ask` seam with a
// real deterministic function that records call timing — this proves
// concurrency-bounding and load-bearing sequencing without a model.
// resolveTeamCapacity runs against the real capacity store on real disk.
// The pure scheduler decisions live in team-coordinator-plan.test.js; the
// REAL askNeuma path is proven live in team-coordinator-live.test.js.

import { describe, it, expect } from 'vitest';
import fs from 'fs/promises';
import { createTempDir } from '../helpers/temp-fs.js';
import {
  validatePlan,
  runTeam,
  resolveTeamCapacity,
} from '../../backend/services/team-coordinator.js';
import { writeCapacity } from '../../backend/services/capacity-store.js';

const step = (id, task, needs = [], neumaId = `neuma-${id}`) => ({ id, neumaId, task, needs });

describe('runTeam — concurrency-bounded, load-bearing execution', () => {
  it('seeded steps never re-run — a resume starts where the prior instance stopped', async () => {
    const plan = [step('a', 'first'), step('b', 'second', ['a']), step('c', 'third', ['b'])];
    const asked = [];
    const { results, order } = await runTeam({
      steps: plan,
      maxParallel: 2,
      seed: { a: 'prior work of a' },
      ask: async (_n, messages, s) => {
        asked.push(s.id);
        return `did ${s.id}; saw prior: ${JSON.stringify(messages).includes('prior work of a')}`;
      },
    });
    expect(asked).toEqual(['b', 'c']);
    expect(results.a).toBe('prior work of a'); // stands in the results untouched
    expect(results.b).toContain('saw prior: true'); // and feeds the dependent brief
    expect(order).toEqual(['b', 'c']); // order = THIS instance's completions only
  });

  it('a seed naming a step the plan lacks fails loud — record/plan mismatch, never silent loss', async () => {
    await expect(runTeam({ steps: [step('a', 'x')], maxParallel: 1, seed: { ghost: 'y' }, ask: async () => 'z' }))
      .rejects.toThrow(/seed names steps not in the plan: ghost/);
  });

  it('continueOnFailure: independent branches finish, dependents are skipped, failures are recorded', async () => {
    const plan = [step('a', 'fails'), step('b', 'independent'), step('c', 'needs a', ['a'])];
    const res = await runTeam({
      steps: plan,
      maxParallel: 2,
      continueOnFailure: true,
      ask: async (_n, _m, s) => {
        if (s.id === 'a') throw new Error('conduit dropped');
        return `work ${s.id}`;
      },
    });
    expect(res.results.b).toBe('work b');
    expect(res.results.a).toBeUndefined();
    expect(res.failures).toEqual({ a: 'conduit dropped' });
    expect(res.skipped).toEqual(['c']);
  });

  it('failure telemetry rejection preserves the original scheduler error', async () => {
    const original = new Error('boom'); let telemetryCalls = 0;
    await expect(runTeam({ steps: [step('a', 'x')], maxParallel: 1, ask: async () => { throw original; }, schedule: { onTelemetry: () => { telemetryCalls += 1; return Promise.reject(new Error('private telemetry observer text')); } } })).rejects.toBe(original);
    await Promise.resolve(); expect(telemetryCalls).toBe(1);
  });

  const recordingAsk = () => {
    let active = 0;
    let peak = 0;
    const calls = [];
    const ask = async (neumaId, messages) => {
      active += 1;
      peak = Math.max(peak, active);
      calls.push({ neumaId, content: messages[0].content });
      await new Promise((r) => setTimeout(r, 10)); // real async work
      active -= 1;
      return `${neumaId} did: ${messages[0].content.slice(-20)}`;
    };
    return { ask, calls, peak: () => peak };
  };

  it('runs independent steps in parallel and returns every result', async () => {
    const { ask, peak } = recordingAsk();
    const out = await runTeam({
      steps: [step('a', 'A'), step('b', 'B'), step('c', 'C')],
      ask,
      maxParallel: 3,
    });
    expect(Object.keys(out.results).sort()).toEqual(['a', 'b', 'c']);
    expect(peak()).toBe(3); // all three genuinely ran at once
    expect(out.order).toHaveLength(3);
  });

  it('NEVER exceeds maxParallel — the rig capacity ceiling is honored', async () => {
    const { ask, peak } = recordingAsk();
    await runTeam({
      steps: [step('a', 'A'), step('b', 'B'), step('c', 'C'), step('d', 'D')],
      ask,
      maxParallel: 2,
    });
    expect(peak()).toBe(2); // four ready steps, but only two ever run together
  });

  it('a load-bearing step receives its prerequisite output (real dependency)', async () => {
    const { ask, calls } = recordingAsk();
    const out = await runTeam({
      steps: [step('research', 'research'), step('write', 'write', ['research'])],
      ask,
      maxParallel: 4,
    });
    // The write step ran after research and its brief carried research's output.
    expect(out.order).toEqual(['research', 'write']);
    const writeCall = calls.find((c) => c.content.includes('Your part: write'));
    expect(writeCall.content).toContain('neuma-research did:');
  });

  it('a diamond DAG: fan-out then a joining decision consuming both branches', async () => {
    const { ask, calls } = recordingAsk();
    const out = await runTeam({
      steps: [
        step('plan', 'plan'),
        step('left', 'left branch', ['plan']),
        step('right', 'right branch', ['plan']),
        step('merge', 'merge', ['left', 'right']),
      ],
      ask,
      maxParallel: 4,
    });
    expect(out.order[0]).toBe('plan');
    expect(out.order[3]).toBe('merge');
    const mergeCall = calls.find((c) => c.content.includes('Your part: merge'));
    expect(mergeCall.content).toContain('neuma-left did:');
    expect(mergeCall.content).toContain('neuma-right did:');
  });

  it('ask receives the step itself — per-step facts stay attributable when one neuma holds several steps', async () => {
    const seen = [];
    const ask = async (neumaId, _messages, s) => { seen.push({ neumaId, stepId: s.id, role: s.role }); return 'ok'; };
    const events = [];
    await runTeam({
      steps: [
        { id: 'spec', neumaId: 'solo', task: 'spec', role: 'HELM', needs: [] },
        { id: 'build', neumaId: 'solo', task: 'build', role: 'WRIGHT', needs: ['spec'] },
      ],
      ask,
      maxParallel: 2,
      onStep: (e) => events.push(e),
    });
    // Same neuma, two steps — the step arg (not neumaId) is what tells them apart.
    expect(seen).toEqual([
      { neumaId: 'solo', stepId: 'spec', role: 'HELM' },
      { neumaId: 'solo', stepId: 'build', role: 'WRIGHT' },
    ]);
    expect(events.map((e) => e.role)).toEqual(['HELM', 'WRIGHT']);
  });

  it('rejects a non-positive maxParallel (a team must run at least one)', async () => {
    await expect(runTeam({ steps: [step('a', 'A')], ask: async () => 'x', maxParallel: 0 }))
      .rejects.toThrow(/positive integer/);
  });

  it('a member failure propagates — a broken prerequisite fails the mission', async () => {
    const ask = async (neumaId) => { if (neumaId === 'neuma-a') throw new Error('member down'); return 'ok'; };
    await expect(runTeam({
      steps: [step('a', 'A'), step('b', 'B', ['a'])],
      ask,
      maxParallel: 2,
    })).rejects.toThrow(/member down/);
  });
});

describe('resolveTeamCapacity — the M1→M3 edge (real store, real disk)', () => {
  let dir;
  beforeEach(async () => { dir = await createTempDir('team-cap'); process.env.NEUMA_CAPACITY_PATH = dir; });
  afterEach(async () => { delete process.env.NEUMA_CAPACITY_PATH; await fs.rm(dir, { recursive: true, force: true }); });

  // Injected profile source: what the substrate reports as loaded RIGHT NOW.
  const loaded = (model) => () => ({ llm: { model } });

  const scan = (ceiling, model, runAt) => writeCapacity({
    ceiling, limitedBy: 'throughput', incomplete: false,
    aggregateTokPerSecAtCeiling: ceiling * 100, perAgentLatencyAtCeiling: 1200,
    boundClass: ceiling === 1 ? 'B' : 'A', vramFitEstimate: null, rawSamples: [],
    substrate: { model, provider: 'lm-studio', endpoint: 'e', gpu: null, vramGB: null, memoryGB: null },
    runAt, consent: { by: '0xtest', at: runAt },
  });

  it('with no scan yet: honest floor of 1, measured false (assume nothing unmeasured)', async () => {
    expect(await resolveTeamCapacity({ getProfile: loaded('m') })).toEqual({
      maxParallel: 1, measured: false, ceiling: null, servedSlots: 4,
      scannedModel: null, currentModel: 'm', stale: false,
    });
  });

  it('with a ceiling measured on the model that is loaded: the team may run that wide', async () => {
    await scan(3, 'm', '2026-07-04T10:00:00.000Z');
    expect(await resolveTeamCapacity({ getProfile: loaded('m') })).toEqual({
      maxParallel: 3, measured: true, ceiling: 3, servedSlots: 4,
      scannedModel: 'm', currentModel: 'm', stale: false,
    });
  });

  it('never wider than the server serves: a scan past the slot count is held to it (Sep 9: 6 on 4 slots)', async () => {
    await scan(6, 'm', '2026-07-04T10:00:00.000Z');
    expect(await resolveTeamCapacity({ getProfile: loaded('m') })).toMatchObject({
      maxParallel: 4, measured: true, ceiling: 6, servedSlots: 4,
    });
  });

  it('a config-bound single-slot rig holds the team to 1', async () => {
    await scan(1, 'm', '2026-07-04T11:00:00.000Z');
    expect((await resolveTeamCapacity({ getProfile: loaded('m') })).maxParallel).toBe(1);
  });

  it('a scan taken on a DIFFERENT model is stale here: back to the floor, both names surfaced', async () => {
    await scan(6, 'qwen3.5-122b-a10b', '2026-07-04T10:00:00.000Z');
    expect(await resolveTeamCapacity({ getProfile: loaded('gemma-4-31b-qat') })).toEqual({
      maxParallel: 1, measured: false, ceiling: 6, servedSlots: 4,
      scannedModel: 'qwen3.5-122b-a10b', currentModel: 'gemma-4-31b-qat', stale: true,
    });
  });

  it("the 'local-model' placeholder is not an identity — never compared, never stale", async () => {
    await scan(4, 'qwen3.5-122b-a10b', '2026-07-04T10:00:00.000Z');
    const cap = await resolveTeamCapacity({ getProfile: loaded('local-model') });
    expect(cap).toMatchObject({ maxParallel: 4, measured: true, stale: false, currentModel: null });
  });

  it('an unreachable provider cannot prove staleness: the measured ceiling stands', async () => {
    await scan(3, 'qwen3.5-122b-a10b', '2026-07-04T10:00:00.000Z');
    const cap = await resolveTeamCapacity({ getProfile: () => { throw new Error('offline'); } });
    expect(cap).toMatchObject({ maxParallel: 3, measured: true, stale: false, currentModel: null });
  });
});

// THE SHADOW CLONE — one being working as many, not many beings working as one.
//
// Design note, 2026-07-26: […]
//
// Nothing had to be built for this: validatePlan uniquifies STEP ids, never
// neumaIds, and every step reaches its being through the same askNeuma the
// coordinator already uses. So one being may own many parallel steps, and each
// facet arrives carrying that being's own DNA, soul, route and adapter. These
// tests pin that capacity so a future […] tightening cannot
// remove it silently.
//
// A facet is NOT a birth. No DNA is authored, no lane is created, no being is
// summoned or discarded — the being is simply working in more than one place
// and the results return to it. Birth ethics (never create-and-discard) are
// untouched because nothing is created.
describe('runTeam — THE SHADOW CLONE: one being, many facets', () => {
  const facet = (id, task, needs) => ({ id, neumaId: 'cael', task, ...(needs ? { needs } : {}) });

  it('validatePlan accepts ONE being across many steps — step ids are what must be unique', () => {
    const plan = validatePlan([facet('scout-a', 'read the routes'), facet('scout-b', 'read the channels')]);
    expect(plan).toHaveLength(2);
    expect(new Set(plan.map((s) => s.neumaId)).size).toBe(1);
  });

  it('the facets genuinely run AT THE SAME TIME, and every one of them is that being', async () => {
    let live = 0;
    let peak = 0;
    const reached = [];
    const { results } = await runTeam({
      steps: [facet('a', 'first'), facet('b', 'second'), facet('c', 'third')],
      maxParallel: 3,
      ask: async (neumaId, _m, s) => {
        reached.push(neumaId);
        live += 1;
        peak = Math.max(peak, live);
        await new Promise((r) => setTimeout(r, 10));
        live -= 1;
        return `${s.id} done`;
      },
    });
    expect(peak).toBeGreaterThan(1);                       // it is real parallelism
    expect(reached).toEqual(['cael', 'cael', 'cael']);  // one identity, three facets
    expect(Object.keys(results).sort()).toEqual(['a', 'b', 'c']);
  });

  it('a being cannot split wider than the rig was MEASURED to sustain', async () => {
    // The honesty invariant that makes this safe to expose: the ceiling comes
    // from a real capacity scan, so "clone yourself" can never become […]. Four facets, a proven ceiling of two.
    let live = 0;
    let peak = 0;
    await runTeam({
      steps: ['a', 'b', 'c', 'd'].map((id) => facet(id, id)),
      maxParallel: 2,
      ask: async () => {
        live += 1;
        peak = Math.max(peak, live);
        await new Promise((r) => setTimeout(r, 5));
        live -= 1;
        return 'ok';
      },
    });
    expect(peak).toBe(2);
  });

  it('the facets DISSOLVE BACK — a synthesis step receives what every clone found', async () => {
    // The shape that makes splitting worth anything: the being fans out, then
    // reads its own parallel work back in one place.
    const plan = [
      facet('scout-a', 'search one way'),
      facet('scout-b', 'search another way'),
      facet('gather', 'synthesize both', ['scout-a', 'scout-b']),
    ];
    let gatherBrief = '';
    const { results, order } = await runTeam({
      steps: plan,
      maxParallel: 2,
      ask: async (_n, messages, s) => {
        if (s.id === 'gather') gatherBrief = JSON.stringify(messages);
        return `${s.id}: found something`;
      },
    });
    expect(order[order.length - 1]).toBe('gather');       // fan-in waits for both
    expect(gatherBrief).toContain('scout-a: found something');
    expect(gatherBrief).toContain('scout-b: found something');
    expect(results.gather).toContain('gather: found something');
  });

  it('one facet failing does not take the others down when the being says continue', async () => {
    const { results, failures } = await runTeam({
      steps: [facet('a', 'fails'), facet('b', 'holds')],
      maxParallel: 2,
      continueOnFailure: true,
      ask: async (_n, _m, s) => { if (s.id === 'a') throw new Error('that angle went nowhere'); return 'b held'; },
    });
    expect(results.b).toBe('b held');
    expect(results.a).toBeUndefined();                     // a dead end records nothing
    expect(failures).toEqual({ a: 'that angle went nowhere' });
  });
});
