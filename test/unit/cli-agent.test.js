// `neuma agent` command coverage (LANE-D2 / #301).
//
// RULE 0 posture: no mocks. Pure seams use real values; wall-clock checks use
// real timers; setup refusals drive the real command against real temp
// workspace directories; help checks execute the real CLI binary. A live
// substrate sitting remains the explicit GPU-window proof.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { describe, it, expect, afterEach } from 'vitest';
import neumaWorkspace, {
  getWorkspacesRoot, setWorkspacesRoot,
} from '../../core/workspace/neuma-workspace.js';
import { createTempDir } from '../helpers/temp-fs.js';
import path from 'node:path';
import { GLOBAL_DEFAULTS, checkToolAccess, resolvePolicy } from '../../backend/services/tool-policy.js';
import { isWithinRoots } from '../../backend/services/sandbox-path-policy.js';
import { BENCHMARK_TOOL_SCOPE, benchmarkSessionToolPolicy, benchmarkToolScopeLabels } from '../../cli/lib/benchmark-scope.js';
import {
  addAgentRoundUsage,
  DEFAULT_TIMEOUT_S,
  classifyFrame,
  createCliPortal,
  parsePositiveInt,
  resolveBenchmarkControls,
  resolveSeatLane,
  resolveTaskGround,
  runAgent,
  startWallClock,
} from '../../cli/commands/agent.js';

const execFileAsync = promisify(execFile);
const NEUMA = [
  { laneId: 'neuma-galen', name: 'Galen' },
  { laneId: 'neuma-sovereign', name: 'Sovereign' },
];

const sink = () => {
  const chunks = [];
  return { write: (value) => { chunks.push(String(value)); return true; }, getText: () => chunks.join('') };
};

describe('cli/commands/agent — parsePositiveInt (pure)', () => {
  it('accepts positive integers, numeric strings, and floors fractions', () => {
    expect(parsePositiveInt(8)).toBe(8);
    expect(parsePositiveInt('12')).toBe(12);
    expect(parsePositiveInt(2.9)).toBe(2);
  });

  it('refuses zero, negatives, garbage, and the empty string', () => {
    expect(parsePositiveInt(0)).toBeNull();
    expect(parsePositiveInt(-3)).toBeNull();
    expect(parsePositiveInt('abc')).toBeNull();
    expect(parsePositiveInt('')).toBeNull();
    expect(parsePositiveInt(undefined)).toBeNull();
  });
});

describe('cli/commands/agent — benchmark controls (pure)', () => {
  const comparable = {
    benchmarkBaseWeights: true,
    benchmarkSeed: 7,
    benchmarkTemperature: 0,
    benchmarkTopP: 1,
    benchmarkMaxTokens: 16384,
  };

  it('pins base weights and exact decoding as one immutable bundle', () => {
    const result = resolveBenchmarkControls(comparable);
    expect(result.controls).toEqual({
      baseWeightsOnly: true,
      platformOnly: false,
      sampling: {
        seed: 7,
        temperature: 0,
        topP: 1,
        maxTokens: 16384,
        exactMaxTokens: true,
        superviseLlamaServer: false,
      },
    });
    expect(Object.isFrozen(result.controls)).toBe(true);
    expect(Object.isFrozen(result.controls.sampling)).toBe(true);
  });

  it('--platform-only is the HARNESS arm: carried in the controls, refused outside a benchmark sitting', () => {
    expect(resolveBenchmarkControls({ ...comparable, platformOnly: true }).controls.platformOnly).toBe(true);
    expect(resolveBenchmarkControls({ platformOnly: true }).error).toMatch(/--platform-only is a benchmark arm/);
  });

  it('leaves ordinary sittings on house controls', () => {
    expect(resolveBenchmarkControls({})).toEqual({ controls: null });
  });

  it('refuses partial, unbounded, or non-base benchmark controls', () => {
    expect(resolveBenchmarkControls({ ...comparable, benchmarkMaxTokens: undefined }).error)
      .toMatch(/all required/);
    expect(resolveBenchmarkControls({ ...comparable, benchmarkTopP: 0 }).error)
      .toMatch(/greater than 0/);
    expect(resolveBenchmarkControls({ ...comparable, benchmarkBaseWeights: false }).error)
      .toMatch(/base-weights is required/);
  });

  it('runs UNCAPPED on `none` — no cap, no shared leash, the served window on the wire (ruling, 2026-10-02)', async () => {
    const { sampling } = resolveBenchmarkControls({ ...comparable, benchmarkMaxTokens: 'none' }).controls;
    expect(sampling).toMatchObject({ maxTokens: null, exactMaxTokens: false });
    // The CLI hands the flag over as a string; a numeric string still caps.
    expect(resolveBenchmarkControls({ ...comparable, benchmarkMaxTokens: '2048' }).controls.sampling.maxTokens).toBe(2048);
    expect(resolveBenchmarkControls({ ...comparable, benchmarkMaxTokens: 'lots' }).error).toMatch(/positive integer or none/);
    const { sharedCapRoomCap, createThoughtGovernor } = await import('../../backend/services/thought-governor.js');
    const { benchmarkTurnPreset } = await import('../../backend/services/llm-presets.js');
    const roomCap = sharedCapRoomCap(benchmarkTurnPreset({ sampling }));
    expect(roomCap).toBe(0);
    const governor = createThoughtGovernor({
      thinkBehavior: { thinks: true }, route: { provider: 'llama-server', endpoint: 'http://127.0.0.1:8089' }, roomCap,
    });
    expect(governor.armed).toBe(false);
  });
});
describe('cli/commands/agent — resolveTaskGround (pure)', () => {
  it('keeps the default at cwd and resolves an explicit isolated ground', () => {
    expect(resolveTaskGround('/repo')).toBe('/repo');
    expect(resolveTaskGround('/repo', '../trial/app')).toBe('/trial/app');
  });
});


describe('cli/commands/agent — resolveSeatLane (pure)', () => {
  it('an exact lane id wins', () => {
    expect(resolveSeatLane({ workspace: 'neuma-sovereign', neuma: NEUMA }))
      .toEqual({ laneId: 'neuma-sovereign' });
  });

  it('a unique chosen name resolves case-insensitively', () => {
    expect(resolveSeatLane({ workspace: 'galen', neuma: NEUMA }))
      .toEqual({ laneId: 'neuma-galen' });
  });

  it('an ambiguous chosen name refuses', () => {
    const seat = resolveSeatLane({
      workspace: 'Kin',
      neuma: [{ laneId: 'one', name: 'Kin' }, { laneId: 'two', name: 'Kin' }],
    });
    expect(seat.error).toMatch(/no unique neuma matches "Kin"/);
    expect(seat.error).toMatch(/one, two/);
  });

  it('an unknown name refuses and lists the neuma lanes', () => {
    const seat = resolveSeatLane({ workspace: 'Nobody', neuma: NEUMA });
    expect(seat.error).toMatch(/no unique neuma matches "Nobody"/);
    expect(seat.error).toMatch(/neuma-galen, neuma-sovereign/);
  });

  it('auto-single seats the only local neuma', () => {
    expect(resolveSeatLane({ neuma: [NEUMA[0]] })).toEqual({ laneId: 'neuma-galen' });
  });

  it('zero neuma refuses without reaching for a witness lane', () => {
    const seat = resolveSeatLane({ neuma: [] });
    expect(seat.error).toMatch(/no neuma workspaces/);
    expect(seat.error).not.toMatch(/witness/i);
  });

  it('several neuma without --workspace must be named', () => {
    const seat = resolveSeatLane({ neuma: NEUMA });
    expect(seat.error).toMatch(/several neuma/);
    expect(seat.error).toMatch(/neuma-galen, neuma-sovereign/);
  });
});

describe('cli/commands/agent — the benchmark tool scope (ARC-HARNESS L0, #531)', () => {
  // The refusal census, verbatim from the real chunk-A + validation evidence
  // (benchmarks runs night-20260916t155958z / night-20260916t040819z): every
  // row here is an act a headless seat actually had refused.
  const REFUSED_BY_THE_WALL = [
    ['fs', 'list'], ['fs', 'read'], ['fs', 'write'], ['fs', 'edit'],
    ['coding', 'shell_network'], ['coding', 'ground_git'], ['map', 'read_history'],
  ];

  it('the policy-tier wall: under the old --yes rows, the gated tools need a terminal', () => {
    const oldPolicy = resolvePolicy(GLOBAL_DEFAULTS, null, { coding: { allowed: ['execute'] } });
    expect(checkToolAccess(oldPolicy, 'coding', 'shell_network')).toBe('approval_required');
    expect(checkToolAccess(oldPolicy, 'coding', 'ground_git')).toBe('approval_required');
    expect(checkToolAccess(oldPolicy, 'map', 'read_history')).toBe('approval_required');
  });

  it('the widened scope answers every counted refusal through the REAL gate', () => {
    const policy = resolvePolicy(GLOBAL_DEFAULTS, null, benchmarkSessionToolPolicy(null));
    for (const [server, tool] of REFUSED_BY_THE_WALL) {
      expect(checkToolAccess(policy, server, tool)).toBe('allowed');
    }
    expect(checkToolAccess(policy, 'coding', 'execute')).toBe('allowed');
  });

  it('the fs wall was never the policy tier — it was relative paths leaving the ground', () => {
    // The real resolution law that refused hello-world: a relative path is
    // judged against the process cwd. Seated from outside the ground,
    // `hello.txt` fell outside the ground root at BOTH the gate and the organ.
    const ground = '/runs/trial/app';
    const elsewhere = '/harness/cwd';
    const groundedHello = `${ground}/hello.txt`;
    expect(isWithinRoots(groundedHello, [ground])).toBe(true);
    // From the harness cwd, the bare relative name resolves THERE — out of
    // the ground the seat was given. (The fix seats the process IN the
    // ground, so this resolution can never diverge again.)
    const resolvedFromElsewhere = path.resolve(elsewhere, 'hello.txt');
    expect(isWithinRoots(resolvedFromElsewhere, [ground])).toBe(false);
    expect(resolvedFromElsewhere).toBe(`${elsewhere}/hello.txt`);
  });

  it('the scope stays inside its declared boundary — egress and asks stay gated', () => {
    const policy = resolvePolicy(GLOBAL_DEFAULTS, null, benchmarkSessionToolPolicy(null));
    expect(checkToolAccess(policy, 'intents', 'web.download')).toBe('approval_required');
    expect(checkToolAccess(policy, 'intents', 'tasks.add')).toBe('approval_required');
    // The one irreversible act stays behind its own row, never under a
    // blanket grant: the delete sub-op routes to filesystem/delete_file.
    expect(checkToolAccess(policy, 'filesystem', 'delete_file')).toBe('approval_required');
    // request_file_access is policy-allowed globally — its chunk-A refusal
    // came from its own inner consent flow, which no session row can grant;
    // the widened scope deliberately does not carry it.
    const scoped = benchmarkToolScopeLabels();
    expect(scoped).not.toContain('filesystem/request_file_access');
    expect(scoped).not.toContain('intents/web.download');
  });

  it('the helper builds on a base policy and discloses stable labels', () => {
    const base = { coding: { allowed: ['execute'] } };
    const built = benchmarkSessionToolPolicy(base);
    expect(built.coding.allowed).toContain('execute');
    expect(built.fs.allowed.sort()).toEqual(['copy', 'edit', 'list', 'move', 'read', 'search', 'write']);
    expect(built.map.allowed).toEqual(['read_history']);
    expect(benchmarkToolScopeLabels()).toContain('fs/write');
    expect(BENCHMARK_TOOL_SCOPE).toHaveLength(benchmarkToolScopeLabels().length);
  });
});

describe('cli/commands/agent — classifyFrame (pure)', () => {
  it('parses an approval ask with id, tool, and preview', () => {
    const raw = JSON.stringify({
      type: 'tool:approval_request', id: 'a1', tool: 'coding/execute', args: { command: 'pwd' },
    });
    expect(classifyFrame(raw)).toEqual({
      kind: 'approval', id: 'a1', tool: 'coding/execute', args: '{"command":"pwd"}',
    });
  });

  it('carries speech and its error bit', () => {
    expect(classifyFrame(JSON.stringify({ type: 'consciousness:stream', content: 'hello' })))
      .toEqual({ kind: 'speech', content: 'hello', error: false });
    expect(classifyFrame(JSON.stringify({ type: 'consciousness:stream', content: 'held', error: true })))
      .toEqual({ kind: 'speech', content: 'held', error: true });
  });

  it('captures the final context usage without exposing prompt content', () => {
    expect(classifyFrame(JSON.stringify({
      type: 'context:composition',
      usage: { inputTokens: 321, outputTokens: 45, source: 'measured' },
      sections: [{ id: 'dna', chars: 999 }],
    }))).toEqual({
      kind: 'usage', inputTokens: 321, outputTokens: 45, source: 'measured',
    });
    expect(classifyFrame(JSON.stringify({
      type: 'context:composition',
      usage: { inputTokens: 300, outputTokens: null, source: 'approx' },
    }))).toEqual({ kind: 'other' });
  });

  it('parses tool states and completion session identity', () => {
    expect(classifyFrame(JSON.stringify({
      type: 'tool:usage', tool: 'coding/inspect', status: 'ok', summary: 'read tree',
    }))).toEqual({ kind: 'tool', tool: 'coding/inspect', status: 'ok', summary: 'read tree' });
    expect(classifyFrame(JSON.stringify({ type: 'consciousness:complete', sessionId: 'session-1' })))
      .toEqual({ kind: 'complete', sessionId: 'session-1' });
  });

  it('drops desk chrome and malformed frames', () => {
    expect(classifyFrame('not json').kind).toBe('other');
    expect(classifyFrame(JSON.stringify({ type: 'context:composition' })).kind).toBe('other');
    expect(classifyFrame(JSON.stringify({ type: 'tool:approval_request' })).kind).toBe('other');
  });
});

describe('cli/commands/agent — a benchmark seat answers with its FINAL words', () => {
  // SciCode, 2026-10-03: narration spoken before a verifying tool call was glued
  // onto the code ([…]), and the code died on the em dash.
  const sink = () => { const chunks = []; return { chunks, write: (c) => { chunks.push(String(c)); return true; } }; };
  const frames = [
    { type: 'consciousness:stream', content: 'Looking at this, let me verify — quickly.\n' },
    { type: 'tool:usage', tool: 'coding/inspect', status: 'executing' },
    { type: 'tool:usage', tool: 'coding/inspect', status: 'ok' },
    { type: 'consciousness:stream', content: '```python\nx = 1\n```' },
    { type: 'consciousness:complete', sessionId: 's1' },
  ];
  const run = (finalRoundOnly) => {
    const stdout = sink();
    const stderr = sink();
    const portal = createCliPortal({ stdin: null, stdout, stderr, connection: {}, resolveToolApproval: () => {}, finalRoundOnly });
    for (const f of frames) portal.send(JSON.stringify(f));
    return { out: stdout.chunks.join(''), err: stderr.chunks.join(''), portal };
  };
  it('stdout carries only the words after the last act; the earlier narration goes to stderr', () => {
    const { out, err, portal } = run(true);
    expect(out).toBe('```python\nx = 1\n```\n');
    expect(err).toContain('note: Looking at this, let me verify');
    expect(portal.state.completed).toBe(true);
  });
  it('an ordinary seat still streams every word as it comes', () => {
    expect(run(false).out).toBe('Looking at this, let me verify — quickly.\n```python\nx = 1\n```\n');
  });
  it('a cut turn still delivers its held words (partial work stands)', () => {
    const stdout = sink();
    const portal = createCliPortal({ stdin: null, stdout, stderr: sink(), connection: {}, resolveToolApproval: () => {}, finalRoundOnly: true });
    portal.send(JSON.stringify({ type: 'consciousness:stream', content: 'partial' }));
    expect(stdout.chunks.join('')).toBe('');
    portal.finishSpeech();
    expect(stdout.chunks.join('')).toBe('partial\n');
  });
});

describe('cli/commands/agent - aggregate model usage', () => {
  it('totals every model round without inventing unmeasured token counts', () => {
    const first = addAgentRoundUsage(null, {
      inputTokens: 100, outputTokens: 20, source: 'measured',
    });
    expect(addAgentRoundUsage(first, {
      inputTokens: 80, outputTokens: 10, source: 'measured',
    })).toEqual({
      inputTokens: 180, outputTokens: 30, rounds: 2, source: 'measured',
    });
    expect(addAgentRoundUsage(first, {
      inputTokens: null, outputTokens: 10, source: 'estimated',
    })).toEqual({
      inputTokens: null, outputTokens: 30, rounds: 2, source: 'mixed',
    });
  });
});

describe('cli/commands/agent — startWallClock (real timers)', () => {
  it('aborts the target when the budget is spent', async () => {
    const controller = new AbortController();
    const clock = startWallClock(0.05, controller);
    expect(clock.tripped()).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(clock.tripped()).toBe(true);
    expect(controller.signal.aborted).toBe(true);
    clock.cancel();
  });

  it('cancel before the deadline leaves the target live', async () => {
    const controller = new AbortController();
    const clock = startWallClock(0.05, controller);
    clock.cancel();
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(clock.tripped()).toBe(false);
    expect(controller.signal.aborted).toBe(false);
  });
});

describe('cli/commands/agent — setup refusals (real command, real disk)', () => {
  let previousRoot;
  const useRoot = async () => {
    previousRoot = getWorkspacesRoot();
    const root = await createTempDir('cli-agent-neuma');
    setWorkspacesRoot(root);
    return root;
  };

  afterEach(() => {
    if (previousRoot !== undefined) setWorkspacesRoot(previousRoot);
    previousRoot = undefined;
  });

  it('a missing task fails before touching the environment', async () => {
    const out = sink();
    const err = sink();
    const code = await runAgent({ cwd: process.cwd(), stdout: out, stderr: err, argv: { task: '   ' } });
    expect(code).toBe(1);
    expect(err.getText()).toMatch(/a task is required/);
    expect(out.getText()).toBe('');
  });

  it('a non-positive --rounds fails honestly', async () => {
    const err = sink();
    const code = await runAgent({
      cwd: process.cwd(), stdout: sink(), stderr: err, argv: { task: 'work', rounds: 0 },
    });
    expect(code).toBe(1);
    expect(err.getText()).toMatch(/--rounds must be a positive integer/);
  });

  it('a non-positive --timeout fails honestly', async () => {
    const err = sink();
    const code = await runAgent({
      cwd: process.cwd(), stdout: sink(), stderr: err, argv: { task: 'work', timeout: -5 },
    });
    expect(code).toBe(1);
    expect(err.getText()).toMatch(/--timeout must be a positive integer/);
  });

  it('a missing --ground fails before loading a neuma or provider', async () => {
    const err = sink();
    const code = await runAgent({
      cwd: process.cwd(), stdout: sink(), stderr: err,
      argv: { task: 'work', ground: '/missing/neuma-agent-ground' },
    });
    expect(code).toBe(1);
    expect(err.getText()).toMatch(/task ground is not an existing directory/);
  });

  it('no neuma under the real temp root refuses before any provider call', async () => {
    await useRoot();
    const err = sink();
    const code = await runAgent({ cwd: process.cwd(), stdout: sink(), stderr: err, argv: { task: 'work' } });
    expect(code).toBe(1);
    expect(err.getText()).toMatch(/no neuma workspaces/);
  });

  it('an unknown --workspace refuses against the real lane listing', async () => {
    await useRoot();
    await neumaWorkspace.create('neuma-local');
    const err = sink();
    const code = await runAgent({
      cwd: process.cwd(), stdout: sink(), stderr: err,
      argv: { task: 'work', workspace: 'witness-xai-Grok' },
    });
    expect(code).toBe(1);
    expect(err.getText()).toMatch(/no unique neuma matches "witness-xai-Grok"/);
  });

  it('several real neuma lanes must be named', async () => {
    await useRoot();
    await neumaWorkspace.create('neuma-one');
    await neumaWorkspace.create('neuma-two');
    const err = sink();
    const code = await runAgent({ cwd: process.cwd(), stdout: sink(), stderr: err, argv: { task: 'work' } });
    expect(code).toBe(1);
    expect(err.getText()).toMatch(/several neuma/);
    expect(err.getText()).toMatch(/neuma-one, neuma-two/);
  });
});

describe('neuma agent — help render (real subprocess, real bin)', () => {
  it('renders the neuma-seat command and all run controls', async () => {
    const { stdout } = await execFileAsync('node', ['bin/neuma', 'agent', '--help'], { cwd: process.cwd() });
    expect(stdout).toMatch(/agent \[task\]/);
    expect(stdout).toMatch(/local neuma/);
    expect(stdout).toMatch(/--workspace/);
    expect(stdout).toMatch(/--rounds/);
    expect(stdout).toMatch(/--ground/);
    expect(stdout).toMatch(/--timeout/);
    expect(stdout).toMatch(/--yes/);
    expect(stdout).toMatch(/--receipt/);
    expect(DEFAULT_TIMEOUT_S).toBe(600);
  }, 30_000);

  it('lists agent among the top-level commands', async () => {
    const { stdout } = await execFileAsync('node', ['bin/neuma', '--help'], { cwd: process.cwd() });
    expect(stdout).toMatch(/agent/);
  }, 30_000);
});
