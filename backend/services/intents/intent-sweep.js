/**
 * THE INTENT SWEEP — the platform's half of a filed act (Stage 2 of
 * docs/planning/proposals/being-tool-surface-primitives.md).
 *
 * A consequential act is never a tool call: the being writes
 * `intents/<name>.json` into its OWN lane with the ordinary filesystem tools
 * (the lane root is already its write root), and this sweep settles every
 * unsettled intent found there:
 *
 *   1. READ + parse — malformed JSON settles `invalid`, loudly
 *   2. REGISTRY — an unknown type settles `invalid` (fail closed; the INTENTS
 *      prompt section lists what exists)
 *   3. VALIDATE — the type's shape law + standing rules (channel custody,
 *      media authorization), BEFORE any card: `invalid` / `denied` settle
 *      with the plain reason, never a button for an act that cannot stand
 *   4. THE ACTS TIER — policy (`intents` server rows) → session mode → ONE
 *      card whose scope is the type's own summarize(); ALWAYS lands the
 *      standing grant like any governed tool
 *   5. EXECUTE → the result file `<name>.result.json` beside the intent
 *      ({status: done|denied|failed|invalid, reason?, detail?, at}), the
 *      being's journal, and the desk's chip
 *
 * Idempotent by construction: a result file beside the intent means SETTLED
 * — save one that refused the filing as INVALID, which never ran: a being that
 * fixes that same file in place is answered again.
 * Across a crash that guarantee needs a second file, because the result is
 * written AFTER the act: `<name>.executing.json` lands atomically BEFORE
 * `type.execute`, so an intent found carrying that marker and no result has an
 * UNCERTAIN outcome. It is never re-executed — it settles `uncertain` and says
 * so, in the same wording the operation checkpoint uses for the same situation
 * on the dispatch path. Re-running an act to discover whether it ran is how a
 * wallet sends twice.
 *
 * Two settlements are deliberately NOT verdicts, and leave the intent pending:
 *   - OBSERVE MODE holds the sweep's settle — watching is not a decision, so
 *     a held intent simply waits for a stance that acts;
 *   - an INTERRUPTED card (the operator pulled the turn mid-ask) — no
 *     decision was ever made, so nothing is recorded as denied. The next
 *     sweep asks again.
 * A POLICY denial is a verdict and settles `denied`. And the #200 law holds
 * here as everywhere: an answer that lands after the interrupt is consent to
 * a turn that no longer exists, so the signal is re-checked before any
 * execution and an aborted signal settles nothing that acts.
 *
 * The sweep is serialized per connection: a turn re-entering while a sweep
 * stands queues behind it, so no intent can double-execute.
 *
 * impure — disk reads/writes, stores, the approval card, executors.
 */
import path from 'path';
import fs from 'fs/promises';
import { createLogger } from '../logger.js';
import neumaWorkspace from '../../../core/workspace/neuma-workspace.js';
import { writeJsonAtomic } from '../user-realm.js';
import { resolvePolicy, checkToolAccess, applyToolMode, normalizeToolMode, GLOBAL_DEFAULTS } from '../tool-policy.js';
import { OPTIO_OFFICE_INTENTS } from '../tool-policy-defaults.js';
import { cosDesignation } from '../staff/cos-designation.js';
import { applyProtocolGuard, holdForWake } from '../protocol-guard.js';
import { requestToolApproval } from '../tool-approval.js';
import { grantAlwaysAllow, ACT_REFUSALS, refusalForDecision } from '../act-gate.js';
import { capturePolicyGrant } from '../policy-grant-context.js';
import { readExecutionToolPolicy } from '../execution-tool-policy.js';
import { logToolCall } from '../tool-sandbox.js';
import { intentType } from './registry.js';
import { captureIntentContext, validateIntentPolicy } from './intent-context.js';
import { maySettle } from './intent-owners.js';

const log = createLogger('IntentSweep');

// The intents directory of the lane bound to this connection, or null when no
// lane stands (an unbound connection has no intents to settle — not an error).
const intentsDirFor = (connection) => {
  const laneId = connection.companion?.neumaId;
  if (!laneId) return null;
  try {
    return path.join(neumaWorkspace.pathFor(laneId), 'intents');
  } catch {
    return null; // an id the workspace law refuses is a lane that cannot act
  }
};

// A filing the platform refused as INVALID (malformed JSON, no type, an
// unknown type, a payload its type rejects) never ran and was never put to
// the operator — so a being that FIXES THE SAME FILE has filed again, and is
// answered again (2026-10-12: a lead corrected its team/run in place, and the
// stale refusal beside it held the fix unread). Every other settlement is
// final: what ran, or was decided, never runs twice. A fix means NOW only
// while it is fresh: rewritten soon after the refusal, and swept soon after
// the rewrite (a live correction is seconds) — a leftover fix an hour old
// must never fire into whatever the being is doing next.
const REFILE_WINDOW_MS = 10 * 60_000;
const refiledAfterInvalid = async (dir, name, resultPath) => {
  try {
    const [intent, result] = await Promise.all([fs.stat(path.join(dir, name)), fs.stat(resultPath)]);
    const fresh = intent.mtimeMs > result.mtimeMs
      && intent.mtimeMs - result.mtimeMs <= REFILE_WINDOW_MS
      && Date.now() - intent.mtimeMs <= REFILE_WINDOW_MS;
    if (!fresh) return false;
    return JSON.parse(await fs.readFile(resultPath, 'utf8'))?.status === 'invalid';
  } catch {
    return false;
  }
};

// Every intent file with no sibling result file — or one the being fixed
// after it was refused as invalid. A missing directory is the ordinary case —
// most lanes have filed nothing.
const listUnsettled = async (dir) => {
  const names = await fs.readdir(dir).catch(() => []);
  const intents = names.filter((n) => n.endsWith('.json')
    && !n.endsWith('.result.json') && !n.endsWith('.executing.json'));
  const unsettled = [];
  for (const name of intents) {
    const resultPath = path.join(dir, `${name.slice(0, -'.json'.length)}.result.json`);
    const settled = await fs.stat(resultPath).then(() => true).catch(() => false);
    if (!settled || await refiledAfterInvalid(dir, name, resultPath)) unsettled.push(name);
  }
  return unsettled.sort(); // chronological enough — the being names its files
};

// The desk's chip + the being's journal + the result file — one settle, three
// records, in the vocabulary the whole platform now speaks (ACT_REFUSALS
// wording for verdicts).
const writeResult = async (dir, name, result) => {
  await writeJsonAtomic(path.join(dir, `${name.slice(0, -'.json'.length)}.result.json`), {
    ...result, at: new Date().toISOString(),
  });
};

// THE CRASH WINDOW. `writeResult` runs after the act; between the two the act
// has happened and nothing on disk says so. These three keep that window
// honest: the marker is durable before the executor is entered, it is read
// before any re-execution, and it is cleared once the result stands.
const markerPath = (dir, name) => path.join(dir, `${name.slice(0, -'.json'.length)}.executing.json`);

const markExecuting = async (dir, name, type) => {
  await writeJsonAtomic(markerPath(dir, name), { type: type.name, at: new Date().toISOString() });
};

const clearExecuting = async (dir, name) => {
  try { await fs.unlink(markerPath(dir, name)); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
};

const executionStarted = async (dir, name) => {
  try {
    const marker = await fs.lstat(markerPath(dir, name));
    if (!marker.isFile()) throw new Error(`intent execution marker is not a regular file: ${name}`);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
};

// impure (the designation) — the house's SEATED Optio assigns work and keeps
// the board with no card (Design note, 2026-10-16: […]); every other lane asks, and an operator's own row on
// the Optio's lane stands over the default.
const optioOfficeAccess = async (connection, access, policyTool, ownRow) => {
  if (access !== 'approval_required' || ownRow !== undefined || !OPTIO_OFFICE_INTENTS.includes(policyTool)) return access;
  const officer = await cosDesignation.getOfficer(connection.walletAddress).catch(() => null);
  return officer?.laneId && officer.laneId === connection.companion?.neumaId ? 'allowed' : access;
};

// Settle one intent file. Returns the one-line receipt the tool batch hands
// back to the model THIS round, or null when the intent stays pending
// (observe hold, interrupted card — see the header).
const settleIntent = async (connection, dir, name, { mode, lanePolicy, emit, signal, current, syncPolicy }) => {
  if (!current()) return null;
  const grantOrigin = capturePolicyGrant(connection, { signal, isCurrent: current });
  const laneId = connection.companion?.neumaId;
  const file = path.join(dir, name);
  const tool = (policyTool) => `intents/${policyTool}`;

  // An intent whose execution began but never landed a result. The act may or
  // may not have happened, and there is no way to tell from here — so it is
  // settled, never retried, and the operator is told plainly.
  if (await executionStarted(dir, name)) {
    const reason = 'execution began and its outcome was never recorded — the backend stopped mid-act. '
      + 'This intent has an uncertain outcome and was NOT retried. Inspect its actual effects before '
      + 'filing another; do not repeat it to discover whether it ran.';
    await writeResult(dir, name, { status: 'uncertain', reason });
    await clearExecuting(dir, name);
    await logToolCall(neumaWorkspace, laneId, 'intents', name, null, 'error', reason);
    emit({ tool: `intents/${name}`, status: 'error', summary: 'intent — uncertain outcome', detail: reason });
    return { tool: `intents/${name}`, status: 'error', error: `intent ${name}: ${reason}` };
  }

  let payload;
  try {
    payload = JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (err) {
    if (!current()) return null;
    const reason = `not a readable JSON intent: ${err.message}`;
    await writeResult(dir, name, { status: 'invalid', reason });
    await logToolCall(neumaWorkspace, laneId, 'intents', name, null, 'denied', reason);
    emit({ tool: `intents/${name}`, status: 'denied', summary: 'intent — not readable JSON', detail: reason });
    return { tool: `intents/${name}`, status: 'error', error: `intent ${name}: ${reason}` };
  }

  if (!current()) return null;
  const type = intentType(payload?.type);
  if (!type) {
    const reason = payload?.type == null
      ? 'the intent file has no "type" field — every intent must declare "type" as one of the types your INTENTS prompt section lists (e.g. "type": "social/queue")'
      : `unknown intent type "${payload.type}" — the INTENTS section of your prompt lists the types you may file`;
    await writeResult(dir, name, { status: 'invalid', reason });
    await logToolCall(neumaWorkspace, laneId, 'intents', name, payload, 'denied', reason);
    emit({ tool: `intents/${payload?.type || 'unknown'}`, status: 'denied', summary: `intent — unknown type`, detail: reason });
    return { tool: `intents/${payload?.type || 'unknown'}`, status: 'error', error: `intent ${name}: ${reason}` };
  }

  // Shape law + standing rules, BEFORE the card — a card only ever describes
  // an act that can stand. A shape failure reads as an ERROR (the file is
  // wrong), a standing-rule refusal as a DENIAL (the act is not yours). The
  // `type` key named the registry entry — it is not an argument, so validate
  // and execute never see it (a spread payload would leak it into executors).
  const { type: _typeKey, ...fields } = payload;
  const verdict = await type.validate(fields, { connection });
  if (!current()) return null;
  if (!verdict.ok) {
    const chipStatus = verdict.status === 'invalid' ? 'error' : 'denied';
    await writeResult(dir, name, { status: verdict.status, reason: verdict.reason });
    await logToolCall(neumaWorkspace, laneId, 'intents', type.policyTool, payload, 'denied', verdict.reason);
    emit({ tool: tool(type.policyTool), status: chipStatus, summary: `${type.name} — ${verdict.status}`, detail: verdict.reason });
    return { tool: tool(type.policyTool), status: chipStatus, error: verdict.reason };
  }

  // The ACTS tier. Intents are acts, never READ_TOOLS — observe mode's
  // 'denied' here is the HOLD (leave pending), not a verdict. The protocol
  // guard rides after the mode: AUTO still pauses on its hard-gated classes
  // (outbound posts, spends) — protocol-guard.js.
  const policy = resolvePolicy(GLOBAL_DEFAULTS, lanePolicy, connection._sessionToolPolicy || null);
  const ownRow = resolvePolicy({}, lanePolicy, connection._sessionToolPolicy || null)[`intents/${type.policyTool}`];
  const baseAccess = await optioOfficeAccess(connection, checkToolAccess(policy, 'intents', type.policyTool), type.policyTool, ownRow);
  const explicit = ownRow === 'allowed';
  // A house wake's charter sends its escalated acts back to the operator, grant or none.
  const access = holdForWake(connection, applyProtocolGuard(applyToolMode(baseAccess, mode, type.policyTool), mode, 'intents', type.policyTool, explicit), 'intents', type.policyTool);
  if (access === 'denied') {
    if (baseAccess !== 'denied') return null; // observe: watching, not acting
    await writeResult(dir, name, { status: 'denied', reason: ACT_REFUSALS.policyDenied.error });
    emit({ tool: tool(type.policyTool), status: 'denied', summary: `${type.name} — ${ACT_REFUSALS.policyDenied.summary}` });
    return { tool: tool(type.policyTool), status: 'denied', error: ACT_REFUSALS.policyDenied.error };
  }

  if (access === 'approval_required') {
    // A card no screen could show is no decision: the intent stays pending for
    // the next sweep (a card already on screen when the portal closes parks).
    if (!connection._approvalRefusal && connection.ws?.readyState !== connection.ws?.OPEN) return null;
    const decision = await requestToolApproval(connection, {
      tool: tool(type.policyTool),
      // A type whose act is more than its fields (a run's code) says what the card shows.
      args: type.cardArgs ? type.cardArgs(verdict.value) : payload,
      scope: type.summarize(payload),
      signal,
    });
    if (!current()) return null;
    if (decision === 'always') {
      await grantAlwaysAllow(connection, 'intents', type.policyTool, grantOrigin);
      syncPolicy('intents', type.policyTool);
    }
    if (decision === 'interrupted') return null; // no decision was made — pending
    if (decision !== 'allow' && decision !== 'always') {
      // The broker already journaled this refusal (one record law).
      const refusal = refusalForDecision(connection, decision);
      await writeResult(dir, name, { status: 'denied', reason: refusal.error });
      emit({ tool: tool(type.policyTool), status: 'denied', summary: `${type.name} — ${refusal.summary}` });
      return { tool: tool(type.policyTool), status: 'denied', error: refusal.error };
    }
  }

  // #200: an approval answered after the interrupt must not become an act.
  if (!current()) return null;

  // Durable BEFORE the act, so a crash leaves evidence the act was entered.
  await markExecuting(dir, name, type);
  // A disconnect or interrupt during persistence cannot authorize the act.
  if (!current()) return null;
  emit({ tool: tool(type.policyTool), status: 'executing' });
  // `emit` rides the execute context for executors with progress to report
  // (a render's fifths, a team's board); `extra` spreads into the receipt so
  // an executor can hand the stream a payload (a generated image's `sight`).
  const outcome = await type.execute(verdict.value, { connection, signal, emit })
    .catch((err) => ({ ok: false, reason: err.message }));
  if (outcome.ok) {
    await writeResult(dir, name, { status: 'done', detail: outcome.detail });
    await clearExecuting(dir, name);
    await logToolCall(neumaWorkspace, laneId, 'intents', type.policyTool, payload, 'success', null);
    emit({ tool: tool(type.policyTool), status: 'ok', summary: `${type.name} — done`, detail: outcome.detail });
    return { tool: tool(type.policyTool), status: 'ok', content: outcome.detail, ...(outcome.extra || {}) };
  }
  await writeResult(dir, name, { status: 'failed', reason: outcome.reason });
  await clearExecuting(dir, name);
  await logToolCall(neumaWorkspace, laneId, 'intents', type.policyTool, payload, 'error', outcome.reason);
  emit({ tool: tool(type.policyTool), status: 'error', summary: `${type.name} — failed`, detail: outcome.reason });
  return { tool: tool(type.policyTool), status: 'error', error: outcome.reason };
};

/**
 * Settle every unsettled intent in the lane bound to this connection.
 * Serialized per connection — a re-entered turn queues behind a standing
 * sweep, so no intent can execute twice. Never throws: a sweep failure costs
 * a log line, never the turn.
 *
 * @param {Object} connection - Portal connection (companion, policy, turn)
 * @param {Object} opts
 * @param {string} opts.mode - Normalized session tool mode (ask/auto/observe)
 * @param {Object|null} opts.lanePolicy - The lane's persisted policy
 * @param {Function} opts.emit - (event) => void — the seat's tool-event sink
 * @returns {Promise<Array>} receipts for the intents settled this sweep
 */
export const sweepIntents = (connection, opts) => {
  // A closed-book sitting settles no intent: intents fetch, post and send
  // (closed-book.js). They stay pending, and the being was never offered them.
  if (connection?._closedBook === true) return Promise.resolve([]);
  let context;
  try { context = captureIntentContext(connection, opts); }
  catch (err) {
    log.error('intent context capture failed - intents stay pending', { err: err.message });
    return Promise.resolve([]);
  }
  // Start the captured lane's read before queueing; attach rejection handling
  // immediately so a rejected read cannot become an unhandled Promise.
  const policy = Promise.resolve().then(() => Object.hasOwn(opts, 'lanePolicy')
    ? opts.lanePolicy
    : context.connection.companion.neumaId
      ? readExecutionToolPolicy(context.connection.companion.neumaId) : null)
    .then(validateIntentPolicy).then((value) => ({ value }), (error) => ({ error }));
  const run = (connection._intentSweep || Promise.resolve([]))
    .then(async () => {
      const resolved = await policy;
      if (resolved.error) throw resolved.error;
      return sweepNow(context.connection, {
        ...opts, ...context, lanePolicy: resolved.value,
        emit: (event) => { if (context.current()) opts.emit(event); },
      });
    })
    .catch((err) => {
      log.error('intent sweep failed — intents stay pending for the next sweep', { err: err.message });
      return [];
    }).finally(context.release);
  connection._intentSweep = run;
  return run;
};

/**
 * impure — the turn-path's settle call: mode and lane policy are the sweep's
 * own read, so both seats' batch-end and turn-end call sites stay one line.
 * The portal's batch path passes its already-read policy through `sweepIntents`
 * directly (no second read); every other seam rides this.
 */
export const sweepBatchIntents = (connection, emit, origin = {}) => sweepIntents(connection, {
  mode: normalizeToolMode(connection.toolMode),
  emit, ...origin,
});

const sweepNow = async (connection, opts) => {
  if (!opts.current()) return [];
  const dir = intentsDirFor(connection);
  if (!dir) return [];
  const receipts = [];
  for (const name of await listUnsettled(dir)) {
    if (!opts.current()) break;
    // A team member settles only what it filed; every other sitting of the
    // being leaves a member's filing to it (intent-owners.js).
    if (!maySettle(connection, path.join(dir, name))) continue;
    const receipt = await settleIntent(connection, dir, name, opts);
    if (receipt) receipts.push(receipt);
  }
  return receipts;
};
