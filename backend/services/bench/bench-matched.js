/**
 * bench-matched — MATCHED SETS: one to five arms fired as a sequential chain
 * under ONE comparison id, so the bars land side by side in the harness's own
 * REPORTS. The operator (2026-09-25): […]
 *
 * This module is the LEAF of the launch plane's argv law (moved out of
 * bench-launch.js 2026-09-25 — the chain needs the same law per arm, and law
 * has one home). bench-launch imports from here; this module never imports
 * bench-launch. The owned-child registry rides as injected hooks at the call
 * seam (the securityTick idiom) so the plane's stopOwned SIGTERMs the live
 * arm and the chain stops honestly — the rest never spawn.
 *
 * The matched law per arm, every arm: the shared comparisonId, --attempt 1
 * (a retry is a NEW matched set), the injected loopback endpoint for floor
 * arms, the operator's wallet as --approved-by, and the one lane riding every
 * identity arm in the set. A failed arm marks honestly and the chain
 * CONTINUES — the receipts carry their own status.
 */

import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { closeSync, openSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createLogger } from '../logger.js';
import { notifyOperator } from '../notification-bus.js';
import { KIND, STANDING } from '../../../core/runtime/notification-record.js';
import { fireLostWatches, fireWatches } from '../chat-watch.js';
import { listRuns } from './bench-reports.js';
import { pressComparisonReport } from './bench-comparison-report.js';
import { chainStatePath, persistChain, pidIsArm, readPersistedChain, refusedForTests, sealedOutcome, waitForArmExit } from './bench-chain-store.js';
import { waitMachineClear } from './bench-machine.js';

const log = createLogger('Bench');

// ── The pure argv law (one home — moved from bench-launch.js) ───────────────

/**
 * Arms that ARE an identity — the harness's own IDENTITY_ARMS
 * (runtime/silo-arm-contract.js:39, verified 2026-09-23). For these the run
 * rides a being's live route, so bench.mjs dies without --lane (bench.mjs:459,
 * shared by preflight and run through composeManifest/runOne).
 */
export const IDENTITY_ARMS = Object.freeze(['silo', 'neuma']);

/**
 * Arms SEATED on a lane: the identity arms, plus HARNESS — the platform agent
 * with identity off (ruling, 2026-09-29), which borrows a lane's disposable
 * workspace, sandbox and tool policy but sends none of its identity. Each needs
 * --lane and rides the lane's route, never the default endpoint.
 */
export const LANE_ARMS = Object.freeze(['harness', ...IDENTITY_ARMS]);

const MAX_DEADLINE_MS = 24 * 24 * 60 * 60 * 1000; // 24 days, harness law
export const COMPARISON_ID_RE = /^[a-z0-9-]+$/;
const LANE_RE = /^[a-zA-Z0-9_-]+$/;
const ISO_TZ_RE = /(Z|[+-]\d{2}:?\d{2})$/;

/** pure — an ISO-8601 string with an EXPLICIT timezone offset (Z or ±hh:mm). */
export const isIsoWithTimezone = (s) =>
  typeof s === 'string' && ISO_TZ_RE.test(s) && Number.isFinite(Date.parse(s));

/** pure — deadline verdict: timezone, future, ≤ 24 days out. */
export const validateDeadline = (s, nowMs = Date.now()) => {
  if (!isIsoWithTimezone(s)) return { ok: false, reason: 'deadline must be ISO-8601 with an explicit timezone' };
  const ms = Date.parse(s);
  if (ms <= nowMs) return { ok: false, reason: 'deadline is in the past' };
  if (ms > nowMs + MAX_DEADLINE_MS) return { ok: false, reason: 'deadline is more than 24 days out' };
  return { ok: true };
};

/** pure — a positive integer option, or a refusal reason. */
export const positiveInt = (value, name) => {
  if (!Number.isInteger(value) || value < 1) {
    return { ok: false, reason: `${name} must be a positive integer` };
  }
  return { ok: true };
};

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

/** pure — a loopback http(s) endpoint URL, or a refusal reason. */
export const validateEndpoint = (value) => {
  if (typeof value !== 'string') return { ok: false, reason: 'endpoint must be a URL string' };
  let url;
  try { url = new URL(value); } catch { return { ok: false, reason: 'endpoint is not a valid URL' }; }
  if (!['http:', 'https:'].includes(url.protocol)) return { ok: false, reason: 'endpoint must be http(s)' };
  if (!LOOPBACK_HOSTS.has(url.hostname)) {
    return { ok: false, reason: 'endpoint must be loopback — this plane never aims the harness at a remote host' };
  }
  return { ok: true };
};

/**
 * The --endpoint tail. Floor arms die at the harness without one
 * (bench.mjs:414: […]), so the
 * plane injects the serving URL by default; identity arms route through the
 * lane and carry only an explicit override. Remote endpoints are refused —
 * the doctrine is local serving, never a third-party host. Pure.
 */
export const endpointArgv = (arm, params = {}, ctx = {}) => {
  const endpoint = params.endpoint ?? (LANE_ARMS.includes(arm) ? undefined : ctx.servingEndpoint);
  if (endpoint === undefined) {
    if (LANE_ARMS.includes(arm)) return { ok: true, argv: [] };
    return { ok: false, reason: '--endpoint is required for bare/platform arms (or set NEUMA_BENCH_SERVING_URL)' };
  }
  const valid = validateEndpoint(endpoint);
  if (!valid.ok) return { ok: false, reason: valid.reason };
  return { ok: true, argv: ['--endpoint', endpoint] };
};

/**
 * The --lane/--workspace-root tail for an arm. --lane is LAW on identity
 * arms; on the floor arms it stays optional (bench.mjs reads it for
 * comparison grouping). --workspace-root is always optional but must be
 * absolute when given. Pure.
 * @param {string} arm
 * @param {object} params
 * @returns {{ok: true, argv: string[]} | {ok: false, reason: string}}
 */
export const identityArgv = (arm, params = {}) => {
  const argv = [];
  if (params.lane !== undefined) {
    if (typeof params.lane !== 'string' || !LANE_RE.test(params.lane)) {
      return { ok: false, reason: 'lane must match /^[a-zA-Z0-9_-]+$/' };
    }
    argv.push('--lane', params.lane);
  } else if (LANE_ARMS.includes(arm)) {
    return { ok: false, reason: arm === 'harness'
      ? '--lane <being> is required for the harness arm — it borrows the lane\'s workspace and tools, never its identity'
      : `--lane <being> is required for the ${arm} arm — the arm IS the identity` };
  }
  if (params.workspaceRoot !== undefined) {
    if (typeof params.workspaceRoot !== 'string' || !params.workspaceRoot.startsWith('/')) {
      return { ok: false, reason: 'workspaceRoot must be an absolute path' };
    }
    argv.push('--workspace-root', params.workspaceRoot);
  }
  return { ok: true, argv };
};

/**
 * The shared comparison id for a matched set: `desk-<iso-basic>` — lowercase,
 * COMPARISON_ID_RE-shaped by construction. Impure clock isolated HERE;
 * buildChainArgv stays pure (the id arrives in ctx).
 * @param {Date} [now]
 */
// impure (the clock) — one call per matched set
export const mintComparisonId = (now = new Date()) =>
  `desk-${now.toISOString().replace(/[:.]/g, '-').slice(0, 19)}`.toLowerCase();

/**
 * Validate a matched set and build ONE argv per arm. PURE — the catalog facts
 * and the comparisonId arrive in ctx (minted by the caller when not given).
 * The matched law: every arm shares the comparisonId, attempt 1, the same
 * limit/deadline, and the one lane on every identity arm.
 *
 * @param {{cell: string, arms: string[], model: string, lane?: string,
 *   workspaceRoot?: string, limit?: number, deadline?: string, endpoint?: string}} params
 * @param {{wallet: string, cell: ?object, modelKeys: string[],
 *   servingEndpoint?: string, comparisonId: string}} ctx
 * @returns {{ok: true, plans: Array<{arm: string, argv: string[]}>} | {ok: false, reason: string}}
 */
export const buildChainArgv = (params = {}, ctx = {}) => {
  const { wallet, cell, modelKeys = [], servingEndpoint, comparisonId } = ctx;
  const { cell: cellId, arms, model } = params ?? {};
  if (!cell || cell.id !== cellId) return { ok: false, reason: `unknown cell: ${String(cellId).slice(0, 64)}` };
  if (!Array.isArray(arms) || arms.length < 1 || arms.length > 5) {
    return { ok: false, reason: 'a matched set is one to five arms' };
  }
  if (new Set(arms).size !== arms.length) {
    return { ok: false, reason: 'an arm rides once in a matched set' };
  }
  for (const arm of arms) {
    if (!cell.arms.includes(arm)) {
      return { ok: false, reason: `arm ${JSON.stringify(arm)} is not one of ${cellId}'s arms (${cell.arms.join(', ')})` };
    }
  }
  if (!modelKeys.includes(model)) return { ok: false, reason: `unregistered model: ${String(model).slice(0, 64)}` };
  if (typeof wallet !== 'string' || !wallet) {
    return { ok: false, reason: 'run-benchmark needs the approving wallet (attended law)' };
  }
  if (arms.some((a) => LANE_ARMS.includes(a)) && params.lane === undefined) {
    return { ok: false, reason: '--lane <being> is required — one lane seats every harness and identity arm in a matched set' };
  }
  if (params.attempt !== undefined) {
    return { ok: false, reason: 'a matched set rides attempt 1 — retry it as a new matched set' };
  }
  if (typeof comparisonId !== 'string' || !COMPARISON_ID_RE.test(comparisonId)) {
    return { ok: false, reason: 'comparisonId must match /^[a-z0-9-]+$/' };
  }
  if (params.limit !== undefined) {
    const v = positiveInt(params.limit, 'limit');
    if (!v.ok) return { ok: false, reason: v.reason };
  }
  if (params.deadline !== undefined) {
    const v = validateDeadline(params.deadline);
    if (!v.ok) return { ok: false, reason: v.reason };
  }
  const plans = [];
  for (const arm of arms) {
    const endpoint = endpointArgv(arm, params, { servingEndpoint });
    if (!endpoint.ok) return { ok: false, reason: endpoint.reason };
    const identity = identityArgv(arm, params);
    if (!identity.ok) return { ok: false, reason: identity.reason };
    const argv = ['bench.mjs', 'run', cellId, '--model', model, '--arm', arm,
      ...endpoint.argv, '--approved-by', wallet, ...identity.argv,
      '--comparison-id', comparisonId, '--attempt', '1'];
    if (params.limit !== undefined) argv.push('--limit', String(params.limit));
    if (params.deadline !== undefined) argv.push('--deadline', params.deadline);
    plans.push({ arm, argv });
  }
  return { ok: true, plans };
};

// ── The chain — sequential, owned, stoppable ────────────────────────────────

/** The running or last chain — the desk reads it merged into /status. */
let currentChain = null;
/** The wallet that launched it — kept off the desk's snapshot, read by the bench watch. */
let chainWallet = null;

/** The wallet whose set runs now, or null — the bench watch's address for the rig's alerts. */
export const liveChainWallet = () => (currentChain?.state === 'running' ? chainWallet : null);

/**
 * The chain's live state for the desk, or null when no matched set has run.
 * The snapshot is a copy — the desk never holds a mutable reference into the
 * runner.
 */
export const chainStates = () => (currentChain ? {
  ...currentChain,
  arms: [...currentChain.arms],
  outcomes: currentChain.outcomes.map((o) => ({ ...o })),
} : null);

// pure — the settled set as one card: […]
export const settledCard = (chain) => {
  const marks = (chain.outcomes ?? []).map((o) => `${o.arm} ${o.skipped ? '—' : o.ok ? '✓' : '✗'}`).join(' · ');
  const verb = chain.state === 'done' ? (chain.outcomes.every((o) => o.ok) ? 'finished' : 'finished with a failed arm')
    : chain.state === 'stopped' ? 'was stopped' : 'did not finish';
  return { title: `Benchmark ${chain.cell} ${verb}`, detail: `${marks}${chain.error ? ` — ${chain.error}` : ''} · ${chain.comparisonId}` };
};

// impure — the settled set as the chat that watches it reads it: every arm's
// outcome and, from the sealed runs, its score ([…])
export const reportSettled = async (chain, pressed = null) => {
  const runs = await listRuns(undefined, 200).catch(() => []);
  const score = (arm) => {
    const value = runs.find((r) => r.comparisonId === chain.comparisonId && r.arm === arm)?.primaryMetric?.value;
    return typeof value === 'number' ? ` ${Math.round(value * 1000) / 1000}` : '';
  };
  const arms = (chain.outcomes ?? []).map((o) => (o.skipped ? `${o.arm} not run` : `${o.arm} ${o.ok ? '✓' : '✗ failed'}${o.ok ? score(o.arm) : ''}`));
  const report = pressed?.html
    ? ` Its report is pressed for review: \`${pressed.html}\`${pressed.pdf ? ` (PDF: \`${pressed.pdf}\`)` : ''} — share that path with your operator in backticks, exactly as written; it opens in their browser.`
    : '';
  return `${settledCard(chain).title}: ${arms.join(' · ')} (comparison ${chain.comparisonId}).${report}`;
};

// impure — the operator hears the set end wherever they are looking (a card never costs a run)
const notifySettled = async (wallet, chain) => {
  try {
    if (!wallet || !chain) return;
    await notifyOperator({
      wallet, kind: KIND.benchDone, standing: STANDING.system, ...settledCard(chain),
      ref: { comparisonId: chain.comparisonId, cell: chain.cell, state: chain.state },
    });
  } catch (err) {
    log.warn('benchmark settled card not delivered', { error: err.message });
  }
};

/**
 * The operator's STOP is for the whole set (#568). The harness traps SIGTERM
 * and exits with a CODE, not a signal, so the arm's outcome alone cannot say
 * "stopped" — this flag does. Set before the child is signalled, it also
 * holds between arms: a stop that lands after one arm exits and before the
 * next spawns still ends the chain.
 */
export const requestChainStop = () => {
  if (currentChain?.state === 'running') currentChain.stopRequested = true;
};

/**
 * One arm of the chain: a real spawned child, journaled, registered as the
 * plane's long owned child while it lives. Resolves on exit — never rejects;
 * a spawn error reads as the arm's failed outcome.
 * @returns {Promise<{arm: string, exitCode: ?number, signal: ?string, ok: boolean, logFile: string}>}
 */
// impure (a real child process)
const runOneArm = (root, plan, logFile, registerOwned, deregisterOwned, chainId, onSpawn = () => {}) =>
  new Promise((resolveRun) => {
    const startedMs = Date.now();
    const startedAt = new Date(startedMs).toISOString();
    // The arm writes its own journal and runs in its own session, so a desk
    // relaunch mid-arm leaves it running for the next desk to adopt (bench-chain-store.js).
    let fd;
    try {
      fd = openSync(logFile, 'a');
    } catch (err) {
      resolveRun({ arm: plan.arm, logFile, startedAt, durationMs: 0, exitCode: null, signal: null, ok: false, error: err.message });
      return;
    }
    const child = spawn(process.execPath, plan.argv, {
      cwd: root,
      stdio: ['ignore', fd, fd],
      shell: false,
      detached: true,
    });
    closeSync(fd);
    if (child.pid) {
      registerOwned(child.pid, { verb: 'run-benchmark', startedAt, logFile, long: true, chainId });
      onSpawn(child.pid);
    }
    log.info('matched arm launched', { chainId, arm: plan.arm, pid: child.pid, logFile });
    const settle = (outcome) => {
      deregisterOwned(child.pid);
      resolveRun({ arm: plan.arm, logFile, startedAt, durationMs: Date.now() - startedMs, ...outcome });
    };
    child.once('error', (err) => settle({ exitCode: null, signal: null, ok: false, error: err.message }));
    child.once('exit', (code, signal) => settle({ exitCode: code, signal, ok: code === 0 }));
  });

/**
 * Run a matched set: one `bench.mjs run` child per arm, the next spawning
 * only after the current exits. A failed arm marks and the chain CONTINUES;
 * a SIGTERM'd arm (the plane's own stopOwned) marks the chain `stopped` and
 * the rest are skipped, never spawned. Returns immediately — the chain rides
 * in the background and reads through chainStates().
 * @param {{root: string, plans: Array<{arm: string, argv: string[]}>, cell: string,
 *   wallet: string, comparisonId: string, registerOwned: Function,
 *   deregisterOwned: Function, logDir: string}} args
 * @returns {Promise<{ok: true, chainId: string, arms: string[], comparisonId: string, long: true}>}
 */
// impure (spawns real children over time)
export const runMatchedChain = async ({ root, plans, cell, wallet, comparisonId, registerOwned, deregisterOwned, logDir }) => {
  await mkdir(logDir, { recursive: true });
  const chainId = `chain-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
  chainWallet = wallet;
  currentChain = {
    chainId,
    state: 'running',
    cell,
    arms: plans.map((p) => p.arm),
    comparisonId,
    startedAt: new Date().toISOString(),
    currentIndex: 0,
    currentArm: plans[0].arm,
    outcomes: [],
  };
  log.info('matched set started', { chainId, arms: currentChain.arms, comparisonId, wallet });
  driveChain({ root, plans, wallet, comparisonId, registerOwned, deregisterOwned, logDir }, 0, null);
  return { ok: true, chainId, arms: currentChain.arms, comparisonId, long: true };
};

/**
 * Drive the chain from arm `from`. An ADOPTED arm (a desk relaunch found it
 * running) is awaited by pid and read from its sealed receipt; every other arm
 * is spawned. The record is written at every step (bench-chain-store.js).
 */
// impure (spawns real children over time)
const driveChain = (ctx, from, adoptedArm) => {
  let adopted = adoptedArm;
  const { root, plans, wallet, comparisonId, registerOwned, deregisterOwned, logDir } = ctx;
  const { chainId } = currentChain;
  const save = () => persistChain(chainStatePath(logDir), { chain: currentChain, wallet, root, logDir, plans });
  let refusals = 0;
  (async () => {
    const settleStopped = (i, at) => {
      currentChain.state = 'stopped';
      for (const rest of plans.slice(i)) currentChain.outcomes.push({ arm: rest.arm, skipped: true });
      currentChain.currentArm = null;
      currentChain.finishedAt = new Date().toISOString();
      log.warn('matched set stopped mid-chain', { chainId, at });
    };
    for (let i = from; i < plans.length; i += 1) {
      const plan = plans[i];
      if (currentChain.stopRequested) { settleStopped(i, plan.arm); return; }
      let outcome;
      if (adopted && i === from) {
        outcome = await adopted;
      } else {
        currentChain.currentIndex = i;
        currentChain.currentArm = plan.arm;
        await waitMachineClear({ stop: () => currentChain.stopRequested,
          onWait: (m) => log.info('matched arm waits for a clear machine', { chainId, arm: plan.arm, tests: m.processes.length }) });
        if (currentChain.stopRequested) { settleStopped(i, plan.arm); return; }
        currentChain.armStartedAt = new Date().toISOString();
        currentChain.currentPid = null;
        await save();
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const logFile = join(logDir, `${stamp}-run-benchmark-${plan.arm}.log`);
        // SEQUENTIAL is the law: the next arm spawns only after the current exits.
        outcome = await runOneArm(root, plan, logFile, registerOwned, deregisterOwned, chainId,
          (pid) => { currentChain.currentPid = pid; save(); });
      }
      // Refused only because a test run stood on the machine: no result — wait for clear and run the arm again.
      if (!outcome.ok && !outcome.signal && !currentChain.stopRequested && (refusals += 1) <= 50 && await refusedForTests(outcome.logFile)) {
        log.info('matched arm refused by a test run — it runs again once the machine is clear', { chainId, arm: plan.arm, refusals });
        adopted = null; i -= 1; continue;
      }
      currentChain.outcomes.push(outcome);
      currentChain.armStartedAt = null;
      currentChain.currentPid = null;
      await save();
      if (outcome.signal || currentChain.stopRequested) {
        // The plane's own stop landed — by signal, or by the harness's own
        // trapped exit after the operator's STOP — mark stopped, skip the rest.
        settleStopped(i + 1, plan.arm);
        return;
      }
    }
    currentChain.state = 'done';
    currentChain.currentArm = null;
    currentChain.finishedAt = new Date().toISOString();
    log.info('matched set done', {
      chainId,
      arms: currentChain.outcomes.map((o) => `${o.arm}:${o.ok ? 'ok' : 'failed'}`).join(' · '),
    });
  })().catch((err) => {
    currentChain = { ...currentChain, state: 'failed', error: err.message, currentArm: null };
    log.error('matched set failed', { chainId, error: err.message });
  }).finally(async () => {
    await save();
    notifySettled(wallet, chainStates());
    // the set's report is pressed first, so the chat that watches it is handed its link
    pressComparisonReport(comparisonId).catch(() => null)
      .then(async (pressed) => fireWatches('bench', comparisonId, await reportSettled(chainStates(), pressed)))
      .catch((err) => log.warn('benchmark watch not fired', { comparisonId, error: err.message }));
  });
};

/**
 * THE BOOT STEP for a set the last desk was running: adopt it and carry it to
 * the end. The live arm is registered as owned (so STOP still reaches it),
 * awaited by pid, and read from its sealed receipt; the arms still to come
 * spawn as usual. impure, never throws.
 * @returns {Promise<?string>} the comparison id carried on, or null
 */
export const resumeMatchedChain = async ({ logDir, registerOwned, deregisterOwned }) => {
  try {
    const record = await readPersistedChain(chainStatePath(logDir));
    if (record?.chain?.state !== 'running' || !Array.isArray(record.plans) || currentChain?.state === 'running') return null;
    currentChain = record.chain;
    chainWallet = record.wallet;
    const ctx = { root: record.root, plans: record.plans, wallet: record.wallet, comparisonId: currentChain.comparisonId, registerOwned, deregisterOwned, logDir };
    const i = currentChain.outcomes.length;
    const pid = currentChain.currentPid;
    const arm = record.plans[i]?.arm;
    if (!arm) return null;
    // The desk died between arms: the next one simply spawns.
    if (!currentChain.armStartedAt) {
      driveChain(ctx, i, null);
      return currentChain.comparisonId;
    }
    // An arm was running: awaited by pid while it lives, then read from its sealed receipt.
    const live = pidIsArm(pid);
    if (live) registerOwned(pid, { verb: 'run-benchmark', startedAt: currentChain.armStartedAt, logFile: null, long: true, chainId: currentChain.chainId });
    const { armStartedAt, comparisonId } = currentChain;
    const adopted = (live ? waitForArmExit(pid) : Promise.resolve()).then(async () => {
      if (live) deregisterOwned(pid);
      const runs = await listRuns(undefined, 200).catch(() => []);
      return { arm, logFile: null, startedAt: armStartedAt, durationMs: Date.now() - (Date.parse(armStartedAt) || Date.now()),
        ...sealedOutcome(runs, { comparisonId, arm, armStartedAt }) };
    });
    log.info('matched set adopted after a desk restart', { chainId: currentChain.chainId, comparisonId: currentChain.comparisonId, arm, pid, live });
    driveChain(ctx, i, adopted);
    return currentChain.comparisonId;
  } catch (err) {
    log.warn('matched set not adopted', { error: err.message });
    return null;
  }
};

// pure — what a chat reads when the desk restarted under the set it watched
export const lostChainReport = (watch, runs) => {
  const sealed = runs.filter((r) => r.comparisonId === watch.ref)
    .map((r) => `${r.arm} ${r.status}${typeof r.primaryMetric?.value === 'number' ? ` ${Math.round(r.primaryMetric.value * 1000) / 1000}` : ''}`);
  return `It did not finish: the desk restarted while it ran (comparison ${watch.ref}), so no arm still to come will be launched and no result is coming to this chat. ${sealed.length ? `Sealed before the restart: ${sealed.join(' · ')}.` : 'No arm sealed before the restart.'} Check bench_status before launching it again.`;
};

/**
 * THE BOOT STEP for chat watches on a set a restart cut and no desk carried
 * on (resumeMatchedChain): each such watch fires now with the honest report.
 * impure, never throws.
 * @returns {Promise<number>} watches fired
 */
export const settleLostChains = async (carried = null) => {
  try {
    const runs = await listRuns(undefined, 200).catch(() => []);
    // A set carried on by resumeMatchedChain still fires its watch when it ends.
    return await fireLostWatches('bench', (w) => lostChainReport(w, runs), (w) => w.ref === carried);
  } catch (err) {
    log.warn('lost benchmark watches not settled', { error: err.message });
    return 0;
  }
};
