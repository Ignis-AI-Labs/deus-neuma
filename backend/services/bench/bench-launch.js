/**
 * bench-launch — the closed verb catalog. The ONLY way this plane spawns
 * anything in the sovereign harness.
 *
 * The doctrine is agent-launch.js's: a launch id maps to FIXED argv builders;
 * client input is validated against the harness's own catalog (the cell must
 * exist, the arm must be one of the cell's arms, the model must be
 * registered) and slotted into a fixed shape — never concatenated into a
 * shell line. spawn receives discrete argv with shell:false by default, so
 * there is no injection surface at all.
 *
 * buildArgs is PURE and fully tested; the impure launch() adds the harness
 * probes (catalog load, rig lock), the spawn, the journal, and the owned-child
 * registry. Every refusal is a structured result — the route maps it, the
 * server's reason text reaches the caller.
 *
 * Long vs short (verified against the sibling source, 2026-09-23):
 * validate-window stays attached for the whole window (it spawns the run
 * children itself); start-night.mjs DETACHES the window and exits, so
 * night-start is short. Short verbs are awaited and their stdout captured
 * (capped) so `/launch {verb:'list'}` returns the harness's JSON.
 */

import { spawn } from 'node:child_process';
import { mkdir, appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { harnessRoot, available, benchLaunchLogDir, servingUrl } from './bench-paths.js';
import { getCell, listModels, isPlanName } from './bench-catalog.js';
import { readRigLock } from './bench-status.js';
import { getProofRunState } from './proof-runner.js';
import { relightServing } from './bench-relight.js';
import { probeMachineClear } from './bench-machine.js';
import { ownsLane, laneRootFor } from './bench-lanes.js';
import { isHarnessLane } from '../../../core/workspace/lane-grounds.js';
import {
  IDENTITY_ARMS, LANE_ARMS, isIsoWithTimezone, validateDeadline, positiveInt,
  identityArgv, endpointArgv, buildChainArgv, mintComparisonId,
  runMatchedChain, resumeMatchedChain, requestChainStop, COMPARISON_ID_RE,
} from './bench-matched.js';
import { createLogger } from '../logger.js';

// The argv law moved to bench-matched.js (2026-09-25 — the matched chain
// needs the same law per arm; one home). These re-exports keep the standing
// test/consumer fans on their old door (the wide-import-fan clause).
export { isIsoWithTimezone, validateDeadline, IDENTITY_ARMS };

const log = createLogger('Bench');

const STDOUT_CAP = 1024 * 1024;

export const VERBS = Object.freeze([
  'list', 'doctor', 'preflight-cell', 'run-cell',
  'validate-window', 'night-check', 'night-start', 'relight-serving',
  'run-benchmark',
]);

/** Verbs whose child stays attached for the work (window-length). */
export const LONG_VERBS = Object.freeze(new Set(['run-cell', 'validate-window', 'run-benchmark']));


/**
 * Build the fixed argv for a verb, or the refusal reason. PURE — the catalog
 * facts it judges against arrive in ctx (loaded by the caller):
 *   ctx = { wallet, cell: ?{id, arms[]}, modelKeys: string[], servingEndpoint?: string }
 * @param {string} verb
 * @param {object} params
 * @param {object} ctx
 * @returns {{ok: true, argv: string[]} | {ok: false, reason: string}}
 */
export const buildArgs = (verb, params = {}, ctx = {}) => {
  const { wallet, cell = null, modelKeys = [] } = ctx;
  switch (verb) {
    case 'list':
      return { ok: true, argv: ['bench.mjs', 'list', '--json'] };
    case 'doctor':
      return { ok: true, argv: ['bench.mjs', 'doctor'] };
    case 'preflight-cell':
    case 'run-cell': {
      const { cell: cellId, arm, model } = params ?? {};
      if (!cell || cell.id !== cellId) return { ok: false, reason: `unknown cell: ${String(cellId).slice(0, 64)}` };
      if (!cell.arms.includes(arm)) {
        return { ok: false, reason: `arm ${JSON.stringify(arm)} is not one of ${cellId}'s arms (${cell.arms.join(', ')})` };
      }
      if (!modelKeys.includes(model)) return { ok: false, reason: `unregistered model: ${String(model).slice(0, 64)}` };
      const endpoint = endpointArgv(arm, params, ctx);
      if (!endpoint.ok) return { ok: false, reason: endpoint.reason };
      const identity = identityArgv(arm, params);
      if (!identity.ok) return { ok: false, reason: identity.reason };
      if (verb === 'preflight-cell') {
        return { ok: true, argv: ['bench.mjs', 'preflight', cellId, '--model', model, '--arm', arm, ...endpoint.argv, ...identity.argv] };
      }
      if (typeof wallet !== 'string' || !wallet) {
        return { ok: false, reason: 'run-cell needs the approving wallet (attended law)' };
      }
      const argv = ['bench.mjs', 'run', cellId, '--model', model, '--arm', arm, ...endpoint.argv, '--approved-by', wallet, ...identity.argv];
      if (params.limit !== undefined) {
        const v = positiveInt(params.limit, 'limit');
        if (!v.ok) return { ok: false, reason: v.reason };
        argv.push('--limit', String(params.limit));
      }
      if (params.attempt !== undefined) {
        const v = positiveInt(params.attempt, 'attempt');
        if (!v.ok) return { ok: false, reason: v.reason };
        argv.push('--attempt', String(params.attempt));
      }
      if (params.deadline !== undefined) {
        const v = validateDeadline(params.deadline);
        if (!v.ok) return { ok: false, reason: v.reason };
        argv.push('--deadline', params.deadline);
      }
      if (params.comparisonId !== undefined) {
        if (typeof params.comparisonId !== 'string' || !COMPARISON_ID_RE.test(params.comparisonId)) {
          return { ok: false, reason: 'comparisonId must match /^[a-z0-9-]+$/' };
        }
        argv.push('--comparison-id', params.comparisonId);
      }
      return { ok: true, argv };
    }
    case 'validate-window':
    case 'night-check':
    case 'night-start': {
      const { plan } = params ?? {};
      if (!isPlanName(plan)) {
        return { ok: false, reason: `bad plan name: ${String(plan).slice(0, 64)} — plans are named /^[a-z0-9-]+$/` };
      }
      const planPath = `plans/${plan}.json`;
      if (verb === 'validate-window') return { ok: true, argv: ['scripts/validate-window.mjs', planPath] };
      if (verb === 'night-check') return { ok: true, argv: ['scripts/start-night.mjs', planPath, '--check'] };
      return { ok: true, argv: ['scripts/start-night.mjs', planPath, '--start'] };
    }
    case 'relight-serving': {
      // The recovery console's verb: buildArgs judges the model; launch()
      // special-cases the spawn (bench-relight.js owns the sequence — the
      // swap argv here is the fixed shape the daemon starts with).
      const { model } = params ?? {};
      if (!modelKeys.includes(model)) {
        return { ok: false, reason: `unregistered model: ${String(model).slice(0, 64)}` };
      }
      return { ok: true, argv: ['scripts/swap-model.mjs', model] };
    }
    case 'run-benchmark': {
      // THE MATCHED SET (1–5 arms, one comparison id, sequential). The pure
      // chain law lives in bench-matched.js; launch() mints the shared
      // comparisonId first (the impure clock never enters buildArgs).
      if (!ctx.comparisonId) {
        return { ok: false, reason: 'comparisonId — the launch path mints it (desk-<iso>) when not given' };
      }
      const built = buildChainArgv(params, ctx);
      if (!built.ok) return { ok: false, reason: built.reason };
      // argv names the FIRST arm's spawn (informational — the operator sees
      // the shape); launch() drives the chain through runMatchedChain.
      return { ok: true, argv: built.plans[0].argv, chain: built.plans };
    }
    default:
      return { ok: false, reason: `unknown verb: ${String(verb).slice(0, 64)} — the catalog is ${VERBS.join(', ')}` };
  }
};

// ── The impure side: registry, journal, spawn ────────────────────────────────

/** pid → {verb, startedAt, logFile, long}. Module-level: one plane per process. */
const owned = new Map();

/** pure — a structured refusal the routes map verbatim. */
const refuse = (status, code, message) => ({ ok: false, status, code, message });

/**
 * The plane-owned children, for the desk and the stop path.
 * @returns {Array<{pid: number, verb: string, startedAt: string, logFile: string, long: boolean}>}
 */
export const ownedStatus = () =>
  [...owned.entries()].map(([pid, child]) => ({
    pid, verb: child.verb, startedAt: child.startedAt, logFile: child.logFile, long: child.long,
  }));

/**
 * THE BOOT STEP: carry on the matched set the last desk was running (a
 * relaunch mid-arm, 2026-10-20), its live arm registered as this plane's own.
 * @returns {Promise<?string>} the comparison id carried on, or null
 */
// impure
export const resumeBenchChain = () => resumeMatchedChain({
  logDir: benchLaunchLogDir(),
  registerOwned: (pid, meta) => owned.set(pid, meta),
  deregisterOwned: (pid) => owned.delete(pid),
});

/**
 * SIGTERM the plane-owned LONG children only (a night window launched through
 * night-start is detached and harness-owned — never ours to kill). 404 when
 * the plane owns nothing long.
 * @returns {Promise<{ok: true, stopped: number[]} | {ok: false, status: number, code: string, message: string}>}
 */
// impure (signals processes)
export const stopOwned = async () => {
  const targets = [...owned.entries()].filter(([, child]) => child.long);
  if (targets.length === 0) {
    return refuse(404, 'BENCH_NOTHING_OWNED', 'the plane owns no long-running child');
  }
  // STOP means the whole matched set (#568): flag it before any child is signalled.
  requestChainStop();
  const stopped = [];
  for (const [pid, child] of targets) {
    try {
      process.kill(pid, 'SIGTERM');
      stopped.push(pid);
      log.info('SIGTERM to plane-owned bench child', { pid, verb: child.verb });
    } catch (err) {
      log.warn('stop: child already gone', { pid, error: err.message });
      owned.delete(pid);
    }
  }
  return { ok: true, stopped };
};

/**
 * Launch a catalog verb. Validates against the harness's own catalog, refuses
 * long verbs while the rig is locked or the plane already owns a long child,
 * then spawns `node <argv>` with cwd at the harness root. stdout+stderr are
 * journaled to <dataRoot>/benchmarks/launch/<iso>-<verb>.log; short verbs are
 * awaited and their stdout returned (capped at 1MB).
 * @param {string} verb
 * @param {object} params
 * @param {string} wallet - the approving operator wallet (--approved-by)
 * @returns {Promise<object>} {ok:true, pid, verb, logFile, argv, exitCode?, stdout?, long?} | refusal
 */
// impure (spawns a real child process; appends the launch journal)
export const launch = async (verb, params = {}, wallet) => {
  const root = harnessRoot();
  if (!available(root)) {
    return refuse(503, 'BENCH_HARNESS_ABSENT', `no benchmark harness at ${root} — set NEUMA_BENCH_HARNESS_PATH`);
  }
  if (!VERBS.includes(verb)) {
    return refuse(400, 'BENCH_UNKNOWN_VERB', `unknown verb: ${String(verb).slice(0, 64)} — the catalog is ${VERBS.join(', ')}`);
  }

  const needsCatalog = verb === 'preflight-cell' || verb === 'run-cell' || verb === 'relight-serving' || verb === 'run-benchmark';
  const needsCell = verb === 'preflight-cell' || verb === 'run-cell' || verb === 'run-benchmark';
  const cell = needsCell ? await getCell(root, params?.cell) : null;
  const modelKeys = needsCatalog ? (await listModels(root)).map((m) => m.key) : [];
  // The matched set's shared comparison id is minted here (the impure clock
  // never enters buildArgs): the operator's own, validated, or desk-<iso>.
  const comparisonId = verb === 'run-benchmark'
    ? (params.comparisonId ?? mintComparisonId())
    : undefined;
  // A harness lane lives on its own ground — named here, never by the client.
  if (isHarnessLane(params?.lane)) params = { ...params, workspaceRoot: laneRootFor(params.lane) };
  const built = buildArgs(verb, params, { wallet, cell, modelKeys, servingEndpoint: servingUrl(), comparisonId });
  if (!built.ok) return refuse(400, 'BENCH_BAD_PARAMS', built.reason);

  // THE IDENTITY LAW AT THE BOUNDARY (2026-09-25, the operator: […]). An identity arm rides a lane of the session
  // wallet's OWN — recomputed from disk here, never trusted from the
  // client's picker. buildArgs stays pure; this check is the impure gate.
  // The harness arm rides the same gate: it borrows a lane's workspace, so the lane must be yours too.
  const identityArmsInPlay = verb === 'run-benchmark'
    ? (Array.isArray(params?.arms) && params.arms.some((a) => LANE_ARMS.includes(a)))
    : LANE_ARMS.includes(params?.arm);
  if ((verb === 'preflight-cell' || verb === 'run-cell' || verb === 'run-benchmark') && identityArmsInPlay) {
    if (!(await ownsLane(wallet, params?.lane))) {
      return refuse(403, 'BENCH_NOT_YOUR_LANE',
        `lane '${String(params?.lane).slice(0, 64)}' is not yours — identity arms benchmark a being of YOUR house or YOUR witnesses`);
    }
    // A harness lane carries the HARNESS arm only — there is no being in it to measure.
    if (isHarnessLane(params?.lane)) {
      const arms = verb === 'run-benchmark' ? params.arms : [params?.arm];
      if (arms.some((a) => IDENTITY_ARMS.includes(a))) {
        return refuse(400, 'BENCH_BAD_PARAMS', 'a harness lane carries no being — run its harness (and bare) arms; neuma and silo need a being of your house');
      }
    }
  }

  // The recovery console is a sequence, not a single spawn — bench-relight
  // owns it. Daemons it starts are NOT plane-owned (stopOwned never reaps
  // them) and it carries no rig-lock refusal: relight is rescue, and a
  // locked rig with dead serving is exactly what it is for.
  if (verb === 'relight-serving') {
    return relightServing({ root, model: params.model, wallet });
  }

  const long = LONG_VERBS.has(verb);
  if (long) {
    // A desk proof run is a workload on the same GPU and slots; a benchmark
    // stacked on it would record both loads as its own (L3).
    const proof = getProofRunState();
    if (proof.state === 'running') {
      return refuse(409, 'BENCH_PROOF_RUNNING', `a proof run is in flight (${proof.done}/${proof.total}) — the benchmark waits for it to finish`);
    }
    const lock = await readRigLock(root);
    if (lock?.alive) {
      return refuse(409, 'BENCH_RIG_LOCKED', `the rig is locked by pid ${lock.pid} — one benchmark at a time`);
    }
    const busy = [...owned.values()].find((child) => child.long);
    if (busy) {
      return refuse(409, 'BENCH_PLANE_BUSY', `the plane already owns a long child (${busy.verb}, started ${busy.startedAt})`);
    }
    // THE CLEAR-MACHINE LAW — the harness's own test-process gate, judged
    // BEFORE the spawn so a refusal reads as a reason, not a failed arm.
    const machine = await probeMachineClear();
    if (machine.clear !== true) {
      const why = machine.clear === null
        ? `the test-process probe failed (${machine.error}) — cannot prove the machine is clear`
        : `${machine.processes.length} test process${machine.processes.length === 1 ? '' : 'es'} running — the harness will not stack on a test run:\n${machine.processes.map((p) => `${p.pid} ${p.command}`).join('\n')}`;
      return refuse(409, 'BENCH_MACHINE_BUSY', `the machine is not clear — ${why}`);
    }
  }

  // THE MATCHED SET — the whole chain is one long act (the rig-lock and
  // plane-busy laws above already judged it). The live arm registers as the
  // plane's owned long child through the injected hooks, so stopOwned
  // SIGTERMs it and the chain marks stopped — the rest never spawn.
  if (verb === 'run-benchmark') {
    return runMatchedChain({
      root,
      plans: built.chain,
      cell: params.cell,
      wallet,
      comparisonId,
      logDir: benchLaunchLogDir(),
      registerOwned: (pid, meta) => owned.set(pid, meta),
      deregisterOwned: (pid) => owned.delete(pid),
    });
  }

  // THE NIGHT PASS (operator order 2026-09-26: nights run only when the
  // operator turns them on through the platform). A window verb gets a
  // one-time pass bound to this plan's bytes and this operator, issued by the
  // harness's own module; start-night / validate-window refuse without one,
  // so a window started anywhere but here never runs. Issued last, after every
  // refusal above, so a refused click never mints a pass.
  if (verb === 'night-start' || verb === 'validate-window') {
    try {
      const { issueNightPass } = await import(pathToFileURL(join(root, 'runtime/night-pass.js')).href);
      const pass = await issueNightPass({ root, planPath: `plans/${params.plan}.json`, issuedBy: wallet });
      built.argv.push('--pass', pass.id);
    } catch (error) {
      return refuse(500, 'BENCH_NIGHT_PASS_FAILED', `the night pass could not be issued: ${error.message}`);
    }
  }

  const logDir = benchLaunchLogDir();
  await mkdir(logDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const logFile = join(logDir, `${stamp}-${verb}.log`);

  const child = spawn(process.execPath, built.argv, {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  });

  const startedAt = new Date().toISOString();
  owned.set(child.pid, { verb, startedAt, logFile, long });
  log.info('bench verb launched', { pid: child.pid, verb, argv: built.argv, wallet, logFile });

  const journal = (chunk) =>
    appendFile(logFile, chunk).catch((err) => log.warn('launch journal append failed', { logFile, error: err.message }));

  let stdout = '';
  let truncated = false;
  child.stdout.on('data', (chunk) => {
    journal(chunk);
    if (!long && stdout.length < STDOUT_CAP) {
      stdout += chunk.toString('utf8');
      if (stdout.length > STDOUT_CAP) { stdout = stdout.slice(0, STDOUT_CAP); truncated = true; }
    }
  });
  child.stderr.on('data', (chunk) => journal(chunk));

  const exited = new Promise((resolvePromise) => {
    child.once('error', (err) => resolvePromise({ exitCode: null, error: err.message }));
    child.once('exit', (code) => resolvePromise({ exitCode: code, error: null }));
  });
  exited.then(() => owned.delete(child.pid));

  if (long) {
    return { ok: true, pid: child.pid, verb, logFile, argv: built.argv, long: true };
  }
  const { exitCode, error } = await exited;
  if (error) {
    return refuse(500, 'BENCH_SPAWN_FAILED', `the verb failed to spawn: ${error}`);
  }
  log.info('bench verb exited', { pid: child.pid, verb, exitCode, logFile });
  return {
    ok: true, pid: child.pid, verb, logFile, exitCode,
    argv: built.argv, stdout, stdoutTruncated: truncated,
  };
};
