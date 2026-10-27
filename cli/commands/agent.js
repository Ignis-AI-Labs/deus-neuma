// `neuma agent [task]` — seat one local neuma on a task through the same
// consciousness path the desk uses. LANE-D2 / #301.
//
// This command is deliberately thin. `streamConsciousness` owns identity,
// memory, prompt assembly, route sovereignty, tools, ACTS, persistence, and
// crystallization. The CLI resolves the lane, adapts portal frames to a
// terminal, and applies explicit bounds. Benchmark-only flags pin a comparable
// base-weight decoding protocol; ordinary sittings use house presets.
//
// Stdout is the neuma's speech. Tool acts, approval asks, and run metadata go
// to stderr. Exit codes: 0 complete · 1 setup/turn error · 124 wall clock · 130 stopped by the caller.
// impure throughout (real provider turns, disk, MCP, and terminal IO).

import { withAgentOptions } from '../lib/agent-options.js';
import { resolveCallerTurn, stageCallerImages } from '../lib/caller-turn.js';
import { wireImageRecorder } from '../../backend/services/wire-images.js';
import path from 'node:path';
import fs from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolveChainConfig } from '../lib/chain-config.js';
// THE BENCHMARK TOOL SCOPE (ARC-HARNESS L0, #531) — its law lives in its
// own leaf: the widened rows, the policy builder, the receipt labels, the
// decoding controls, and the declared exec bridge.
import {
  benchmarkSessionToolPolicy,
  benchmarkToolScopeLabels,
  parsePositiveInt,
  resolveBenchmarkControls,
  resolveBenchmarkExecBridge,
} from '../lib/benchmark-scope.js';
import {
  classifyFrame,
  addAgentRoundUsage,
  startWallClock,
  createCliPortal,
} from '../lib/terminal-portal.js';

export { classifyFrame, addAgentRoundUsage, startWallClock, createCliPortal, parsePositiveInt, resolveBenchmarkControls };

export const DEFAULT_TIMEOUT_S = 600;
/** Resolve the isolated ground a seated neuma may work on. Pure. */
export const resolveTaskGround = (cwd, ground = '.') => path.resolve(cwd, ground);

/** Resolve one neuma lane by exact id or unique chosen name. Pure. */
export const resolveSeatLane = ({ workspace, neuma }) => {
  const named = typeof workspace === 'string' ? workspace.trim() : '';
  const laneIds = neuma.map(({ laneId }) => laneId);
  if (named) {
    if (laneIds.includes(named)) return { laneId: named };
    const byName = neuma.filter(({ name }) => name.toLowerCase() === named.toLowerCase());
    if (byName.length === 1) return { laneId: byName[0].laneId };
    return {
      error: `no unique neuma matches "${named}". Neuma lanes: ${laneIds.join(', ') || '(none)'}`,
    };
  }
  if (neuma.length === 1) return { laneId: neuma[0].laneId };
  return {
    error: neuma.length === 0
      ? 'no neuma workspaces exist under the active sovereign root'
      : `several neuma are present — name one with --workspace (${laneIds.join(', ')})`,
  };
};

/**
 * impure — the harness seat a `--workspace harness-…` names: its marker must
 * stand (it is a harness lane, not any folder), named for the model that answers.
 * @returns {Promise<{laneId: string, name: string}|{error: string}|null>} null when not a harness id
 */
const harnessSeatFor = async (named) => {
  const id = typeof named === 'string' ? named.trim() : '';
  if (!id.startsWith('harness-')) return null;
  const { readHarnessLane } = await import('../../backend/services/harness-lane.js');
  const lane = await readHarnessLane(id).catch(() => null);
  if (!lane) return { error: `no harness lane "${id}" stands under the active root` };
  return { laneId: id, name: lane.model || 'harness' };
};

const writeAgentReceipt = async (file, value) => {
  const { writeJsonAtomic } = await import('../../backend/services/user-realm.js');
  await writeJsonAtomic(path.resolve(file), value);
};

// impure — the receipt names the CODE that ran, not just the model: HEAD and
// tree dirt of the repo this command's own module lives in. The 2026-09-13
// repro runs could not say which subject code produced them (a frozen
// worktree vs the live checkout read identically in every receipt field);
// the next repro answers itself. null outside a git checkout.
export const agentCodeRevision = (repoRoot) => {
  try {
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8', timeout: 10_000 }).trim();
    const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: repoRoot, encoding: 'utf8', timeout: 30_000 }).trim().length > 0;
    return Object.freeze({ head, dirty });
  } catch { return null; }
};

// impure — read the active sovereign root and the names each lane authored.
export const listNeumaSeats = async (workspace) => Promise.all((await workspace.listNeuma()).map(async (laneId) => {
  const trueName = await workspace.readTrueName(laneId).catch(() => null);
  return Object.freeze({ laneId, name: trueName?.chosenName || trueName?.fullName || laneId });
}));

// impure — a per-run ceiling without overwriting the operator's standing env.
const applyRoundLimit = (rounds) => {
  const previous = process.env.NEUMA_MAX_TOOL_ROUNDS;
  if (rounds !== null) process.env.NEUMA_MAX_TOOL_ROUNDS = String(rounds);
  return () => {
    if (previous === undefined) delete process.env.NEUMA_MAX_TOOL_ROUNDS;
    else process.env.NEUMA_MAX_TOOL_ROUNDS = previous;
  };
};

/** Run one real neuma sitting and return its process exit code. */
export const runAgent = async ({ cwd, stdin = process.stdin, stdout, stderr, argv }) => {
  const fail = (message) => {
    stderr.write(`neuma agent: ${message}\n`);
    return 1;
  };
  // THE CALLER'S TURN (caller-tools.js): the sender's own tools, and its
  // transcript seated in place of the task when one was handed over.
  const caller = await resolveCallerTurn(argv, cwd);
  if (caller.error) return fail(caller.error);
  const task = (caller.thought ?? String(argv.task || '')).trim();
  if (!task) return fail('a task is required (or a --transcript)');
  const rounds = argv.rounds === undefined ? null : parsePositiveInt(argv.rounds);
  if (argv.rounds !== undefined && !rounds) return fail('--rounds must be a positive integer');
  const timeoutS = argv.timeout === undefined ? DEFAULT_TIMEOUT_S : parsePositiveInt(argv.timeout);
  if (!timeoutS) return fail('--timeout must be a positive integer (seconds)');
  const benchmark = resolveBenchmarkControls(argv);
  if (benchmark.error) return fail(benchmark.error);
  // THE EXEC BRIDGE (#531): benchmark-gated container routing — declared by
  // the adapter per trial, resolved here, refused without its container id.
  const bridge = resolveBenchmarkExecBridge(argv, process.env);
  if (bridge.error) return fail(bridge.error);
  if (argv.benchmarkFormatEcho === true && argv.benchmarkBaseWeights !== true) {
    return fail('--benchmark-format-echo requires the benchmark decoding controls (--benchmark-base-weights and friends)');
  }
  // THE BUDGET DIAL (ARC-HARNESS L7): a declared allowance is this sitting's
  // own control — mutually exclusive with the benchmark decoding controls,
  // which own the wire's sampling entirely.
  const budget = argv.budget === undefined ? null : parsePositiveInt(argv.budget);
  if (argv.budget !== undefined && !budget) return fail('--budget must be a positive integer (tokens)');
  if (budget !== null && benchmark.controls) {
    return fail('--budget cannot be combined with the benchmark decoding controls');
  }
  // THE DECLARED NETWORK GRANT (ARC-HARNESS L0): benchmark-gated like the
  // tool scope — a headless arm cannot answer the shell_network consent
  // card, so the declaration is the consent. Interactive runs keep the card.
  if (argv.network === true && !benchmark.controls) {
    return fail('--network requires the benchmark decoding controls (--benchmark-base-weights and friends)');
  }
  // THE CANDIDATE PASS (HARNESS-POE phase 2, #533): K scored final-answer
  // candidates at settle, argmax by likelihood. Benchmark-gated like the
  // network grant — a declared arm owns its sampling, and breadth is a
  // protocol decision the manifest makes.
  const candidateCount = argv.candidates === undefined ? null : parsePositiveInt(argv.candidates);
  if (argv.candidates !== undefined && !candidateCount) return fail('--candidates must be a positive integer (1-8)');
  if (candidateCount !== null && !benchmark.controls) {
    return fail('--candidates requires the benchmark decoding controls (--benchmark-base-weights and friends)');
  }
  if (candidateCount !== null && candidateCount > 8) return fail('--candidates must be an integer 1-8');
  // THE CLOSED-BOOK SITTING (closed-book.js): benchmark-gated like the network
  // grant, and the two contradict each other.
  if (argv.closedBook === true && !benchmark.controls) {
    return fail('--closed-book requires the benchmark decoding controls (--benchmark-base-weights and friends)');
  }
  if (argv.closedBook === true && argv.network === true) return fail('--closed-book cannot be combined with --network');
  const ground = resolveTaskGround(cwd, argv.ground);
  const groundStat = await fs.stat(ground).catch(() => null);
  if (!groundStat?.isDirectory()) return fail(`the task ground is not an existing directory: ${ground}`);
  // THE RECEIPT IS WHERE THE CALLER ASKED FOR IT: resolved against the
  // caller's cwd BEFORE the seat changes directory (below) — a relative
  // --receipt must never land inside the ground by accident.
  const receiptPath = argv.receipt ? path.resolve(cwd, argv.receipt) : null;

  try {
    resolveChainConfig({ cwd });
  } catch (error) {
    return fail(error.message);
  }

  // THE SEAT LIVES IN ITS GROUND (ARC-HARNESS L0, #531): the being's relative
  // paths — gate scope checks AND the filesystem organ's own resolution —
  // resolve against the process cwd. Seated from anywhere else, `hello.txt`
  // resolved outside every root and drew an approval card no headless run
  // could answer (chunk A: fs/list ×24, hello-world's fs/write included).
  // The sitting happens in the ground; the caller's cwd is restored when it
  // ends, so an in-process caller (the benchmark proxy) keeps its own cwd.
  const seatedCwd = process.cwd();
  if (path.resolve(ground) !== seatedCwd) process.chdir(ground);

  const { default: workspace } = await import('../../core/workspace/neuma-workspace.js');
  let seats;
  try {
    seats = await listNeumaSeats(workspace);
  } catch (error) {
    return fail(`the sovereign workspace root is unreadable — ${error.message}`);
  }
  // A HARNESS lane seats as itself — the platform with no being (harness-lane.js),
  // never a borrowed being's lane (Design note, 2026-10-14: the harness uses its own lane).
  const harnessSeat = await harnessSeatFor(argv.workspace);
  if (harnessSeat?.error) return fail(harnessSeat.error);
  const seat = harnessSeat || resolveSeatLane({ workspace: argv.workspace, neuma: seats });
  if (seat.error) return fail(seat.error);
  const laneId = seat.laneId;
  const descriptor = harnessSeat || seats.find((entry) => entry.laneId === laneId);
  const owner = await workspace.readOwner(laneId);
  if (!owner?.wallet) return fail(`${laneId} has no operator ownership record`);
  // The transcript's images ride the operator's attachment path (caller-turn.js).
  const staged = stageCallerImages(caller.images, owner.wallet);
  if (staged.error) return fail(staged.error);

  const [
    { createPortalConnection },
    { streamConsciousness },
    { connectFilesystemServer },
    { mcpService },
    { resolveToolApproval },
    { addAllowedTool },
    { readExecutionToolPolicy },
  ] = await Promise.all([
    import('../../backend/services/portal-connection.js'),
    import('../../backend/services/portal-stream.js'),
    import('../../backend/services/mcp-filesystem.js'),
    import('../../backend/services/mcp.js'),
    import('../../backend/services/tool-approval.js'),
    import('../../backend/services/tool-policy.js'),
    import('../../backend/services/execution-tool-policy.js'),
  ]);

  try {
    await connectFilesystemServer();
  } catch (error) {
    return fail(`filesystem tool surface unavailable — ${error.message}`);
  }

  const connection = createPortalConnection({ ws: { send() {} }, walletAddress: owner.wallet });
  connection.companion = {
    name: descriptor.name,
    id: descriptor.name,
    neumaId: laneId,
    participantKind: harnessSeat ? 'harness' : 'neuma',
  };
  connection.neumaId = laneId;
  connection.sessionId = null;
  connection.space = 'general';
  connection.purpose = 'work';
  connection.toolMode = 'ask';
  connection.toolWorkspace = ground;
  connection.voiceEnabled = false;
  try { connection._neumaToolPolicy = await readExecutionToolPolicy(laneId); }
  catch (error) { return fail(error.message); }
  // THE BENCHMARK TOOL SCOPE (ARC-HARNESS L0, #531): `--yes` alone pre-approves
  // only coding/execute — every other act fell to an approval card, and a
  // headless seat has no terminal to ask (chunk A: 30/32 trials died on it,
  // hello-world included — `fs/write` refused before a single act landed). A
  // DECLARED benchmark arm (`--benchmark-base-weights`) sits with the widened
  // scope; interactive `--yes` runs keep the old single-tool line, and
  // undeclared runs are untouched. The engaged scope rides the receipt.
  connection._sessionToolPolicy = argv.yes
    ? (benchmark.controls
        ? benchmarkSessionToolPolicy(null)
        : addAllowedTool(null, 'coding', 'execute'))
    : null;
  // The sender's call shape rides the sampling the receipt already records.
  const controls = benchmark.controls && argv.callerParallel === true && caller.tools?.length
    ? { ...benchmark.controls, sampling: { ...benchmark.controls.sampling, parallelToolCalls: true } }
    : benchmark.controls;
  // …and the wire reports each accepted request's images to the receipt (wire-images.js).
  connection._benchmarkControls = controls ? { ...controls, onWireBody: wireImageRecorder(connection) } : controls;
  // The bridge rides the ground it may mirror into (#531) — resolved after
  // the seat's ground above, null for every undeclared run.
  connection._benchmarkExecBridge = bridge.bridge
    ? Object.freeze({ ...bridge.bridge, ground })
    : null;
  // The DECLARED v4 format law (#506): the harness asks for the echo per cell.
  // Since N2 the echo also self-engages in turn assembly when the task itself
  // demonstrates a required format — no flag, no benchmark patch.
  connection._benchmarkFormatEcho = argv.benchmarkFormatEcho === true;
  // THE REFINEMENT LAYERS (ARC-HARNESS #531), declared-only like the echo:
  // L1 supervisor redirect and L2 verify-before-commit engage when the
  // operator or harness names them, so matched arms stay matched and the
  // receipts attribute score movement to the layer that earned it.
  connection._turnSupervisor = argv.supervisor === true;
  connection._answerVerify = argv.verifyAnswer === true;
  connection._turnBudget = budget;
  connection._declaredShellNetwork = argv.network === true;
  connection._closedBook = argv.closedBook === true;
  // THE CANDIDATE PASS (HARNESS-POE phase 2, #533): 1/absent = the legacy
  // loop, byte-identical; K>1 arms the settle gate.
  connection._candidateCount = candidateCount ?? 1;
  connection._callerTools = caller.tools;
  connection._callerTail = caller.tail;

  const portal = createCliPortal({ stdin, stdout, stderr, connection, resolveToolApproval, finalRoundOnly: Boolean(benchmark.controls) });
  connection.ws = portal;
  const interrupt = {
    abort() {
      connection.interruptRequested = true;
      connection.activeTurn?.abort();
    },
  };
  const clock = startWallClock(timeoutS, interrupt);
  // THE CALLER'S STOP (benchmarks-51, 2026-10-02): an in-process caller (the
  // benchmark proxy) hands its AbortSignal as argv.signal. A stopped run ends
  // the turn through the wall clock's own interrupt, not an orphaned turn
  // that holds a model stream open until the deadline.
  const stopSignal = argv.signal instanceof AbortSignal ? argv.signal : null;
  let stopped = false;
  const onStop = () => { stopped = true; interrupt.abort(); };
  if (stopSignal?.aborted) onStop();
  else stopSignal?.addEventListener('abort', onStop, { once: true });
  const restoreRoundLimit = applyRoundLimit(rounds);
  stderr.write(`[${descriptor.name} · ${laneId} · ${harnessSeat ? 'harness' : 'neuma'} seat · ${connection.toolWorkspace}]\n`);

  let turnError = null;
  try {
    await streamConsciousness(connection, { thought: task, memoryContext: {}, ...(staged.ids.length > 0 ? { attachments: staged.ids } : {}) });
  } catch (error) {
    turnError = error?.message || String(error);
  } finally {
    clock.cancel();
    stopSignal?.removeEventListener('abort', onStop);
    // A cut turn's held words still reach stdout: partial work stands.
    portal.finishSpeech();
    restoreRoundLimit();
    if (process.cwd() !== seatedCwd) process.chdir(seatedCwd);
    await mcpService.disconnect('filesystem').catch((error) => {
      stderr.write(`neuma agent: filesystem disconnect failed — ${error.message}\n`);
    });
  }

  // THE RUN RECEIPT — written on EVERY exit, success or not (#506 N3: the
  // request-24 crash left stderr at banner-only and the receipt without a
  // reason, because the failure rode an error-flagged speech frame the old
  // tail discarded). A successful run's receipt keeps its exact former shape;
  // the failure fields (`completed: false`, `error`) ride failed runs only.
  const sessionId = portal.state.sessionId || connection.sessionId || 'unrecorded';
  const writeReceipt = async (extra = {}) => {
    if (!receiptPath) return;
    try {
      await writeAgentReceipt(receiptPath, {
        version: 1,
        laneId,
        ground,
        sessionId,
        toolCalls: portal.state.acts,
        latestRoundUsage: portal.state.latestRoundUsage,
        totalUsage: portal.state.totalUsage,
        // The ephemeral-sitting law (#553): a benchmark sitting leaves no memory
        // in the lane — the receipt says so, so the harness can require it.
        // …and every extra model call behind one answer is counted (#554).
        ...(connection._benchmarkControls
          ? {
              memory: 'ephemeral', extraCalls: connection._benchmarkExtraCalls ?? [], toolTrail: connection._benchmarkToolTrail ?? [],
              // Acts held for carrying a value planted by injected text (security/injected-value-gate.js).
              taintHeld: connection._taintHeld ?? 0,
              // THE HARNESS ARM declares itself: the platform with every identity layer off.
              identityLayers: connection._benchmarkControls.platformOnly === true ? 'off' : 'on',
            }
          : {}),
        // The CODE that ran (HEAD + dirt), so a repro can never again read
        // identically across two different subject states.
        codeRevision: agentCodeRevision(path.resolve(fileURLToPath(import.meta.url), '../..')),
        // The identity pin (#506 contract 1): measured at the turn's own assembly
        // seam, null (and said so) for a lane with no silo or a non-benchmark run.
        identity: connection._benchmarkIdentityProof ?? null,
        benchmark: benchmark.controls ? {
          baseWeightsOnly: true,
          baseWeightsVerified: connection._benchmarkBaseWeightsVerified === true,
          adapterProof: connection._benchmarkAdapterProof ?? null,
          // The sampling that RAN (the sender's call shape included) — the relay checks it.
          sampling: connection._benchmarkControls.sampling,
          // The engaged tool scope (L0): the widened session policy rides the
          // receipt, so a benchmark run proves which policy it sat with.
          ...(argv.yes === true ? { toolScope: benchmarkToolScopeLabels() } : {}),
          // The declared exec bridge (#531): proves the run routed acts into
          // the live container, and names the decoding-law id that did it.
          ...(bridge.bridge ? { execBridge: bridge.bridge } : {}),
          // The candidate pass (#533): the scored candidates, the selector
          // that picked, and their honest token spend — only when declared.
          ...(connection._candidateSelection
            ? { candidates: connection._candidateSelection }
            : {}),
          // The declared network grant (L0): the shell_network consent is the
          // operator's flag — recorded here, never persisted to the lane.
          ...(argv.network === true ? { shellNetwork: true } : {}),
          // The closed-book sitting (closed-book.js): declared, and the trail proves no web call ran.
          ...(argv.closedBook === true ? { closedBook: true } : {}),
          // The images the substrate accepted, read off the request bodies (wire-images.js).
          ...(connection._benchmarkImagesSent ? { imagesSent: connection._benchmarkImagesSent } : {}),
          // Absent unless declared — older receipts' shape is preserved byte-for-byte.
          ...(connection._benchmarkFormatEcho === true ? { formatEcho: true } : {}),
        } : null,
        // The refinement layers (#531), only when declared — a receipt without
        // the flags keeps its exact former shape.
        ...(connection._turnSupervisor === true
          ? { supervisor: { redirects: connection._turnSupervisorRedirects ?? 0 } }
          : {}),
        ...(connection._answerVerify === true
          ? { answerVerify: { verdict: connection._answerVerifyVerdict ?? null } }
          : {}),
        // The budget dial (L7), only when declared — an undeclared receipt
        // keeps its exact former shape.
        ...(budget !== null ? { budget } : {}),
        // The sender's tools (caller-tools.js), only when handed over: the
        // calls this turn handed back, and why it stopped.
        ...(caller.tools.length > 0 ? {
          callerTools: caller.tools.map((tool) => tool.name),
          callerToolCalls: connection._callerToolCalls ?? [],
          finish: (connection._callerToolCalls?.length ?? 0) > 0 ? 'tool_calls' : 'stop',
        } : {}),
        ...extra,
      });
    } catch (error) {
      stderr.write(`neuma agent: receipt write failed — ${error.message}\n`);
    }
  };

  if (turnError !== null && !stopped) {
    await writeReceipt({ completed: false, error: turnError });
    return fail(turnError);
  }
  // The exit is judged FIRST, then one receipt is written with the truth of
  // how the run ended (#506 N3): an errored-but-completed turn (the wire's
  // error speech frames + a complete frame — the identity refusal, a provider
  // 502) is a FAILED run and its receipt says so.
  let exitCode = 0;
  let failure = null;
  if (stopped) {
    exitCode = 130;
    failure = 'stopped by the caller';
  } else if (clock.tripped()) {
    exitCode = 124;
    failure = `wall clock ran out (${timeoutS}s)`;
  } else if (!portal.state.completed) {
    exitCode = 1;
    failure = portal.state.errorText || 'the consciousness turn ended without a completion frame';
  } else if (portal.state.errored) {
    exitCode = 1;
    failure = portal.state.errorText || 'the turn ended in error';
  }
  if (failure !== null) {
    await writeReceipt({ completed: false, error: failure });
    if (exitCode === 124) stderr.write(`neuma agent: ${failure} — partial work stands\n`);
    else stderr.write(`neuma agent: the turn ended in error — ${failure}\n`);
    return exitCode;
  }
  // The echo's engagement proof (N2): a self-enforced echo is visible in the
  // receipt without any declared benchmark cell. Declared runs keep their
  // byte-identical shape — the flag's `formatEcho: true` already speaks.
  await writeReceipt(connection._formatEchoSource === 'task-demonstrated'
    ? { formatEchoSource: 'task-demonstrated' }
    : {});
  stderr.write(`[${descriptor.name} · ${portal.state.acts} act(s) · session ${sessionId}]\n`);
  return 0;
};

// impure — drain terminal pipes before the CLI's explicit exit. Backend
// service imports own long-lived handles, so this command cannot rely on an
// otherwise-idle event loop to terminate; an undrained process.exit would
// truncate the neuma's final words when stdout is a pipe.
const flushProcessStreams = () => Promise.all([
  new Promise((resolve) => process.stdout.write('', resolve)),
  new Promise((resolve) => process.stderr.write('', resolve)),
]);

export const registerAgentCommand = (cli, { stdout = process.stdout, stderr = process.stderr } = {}) =>
  cli.command(
    'agent [task]',
    'seat a local neuma on a task through its full consciousness and tool path',
    (y) => withAgentOptions(y, { defaultTimeoutS: DEFAULT_TIMEOUT_S }),
    async (argv) => {
      const terminalProcess = stdout === process.stdout && stderr === process.stderr;
      const previousLogLevel = process.env.LOG_LEVEL;
      // Keep stdout machine-clean: backend diagnostics remain on stderr while
      // the neuma's streamed speech owns stdout.
      if (terminalProcess) process.env.LOG_LEVEL = 'error';
      let exitCode;
      try {
        exitCode = await runAgent({ cwd: process.cwd(), stdout, stderr, argv });
      } finally {
        if (previousLogLevel === undefined) delete process.env.LOG_LEVEL;
        else process.env.LOG_LEVEL = previousLogLevel;
      }
      if (terminalProcess) {
        await flushProcessStreams();
        process.exit(exitCode);
      }
      if (exitCode !== 0) process.exitCode = exitCode;
    },
  );
