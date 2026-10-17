/**
 * proof-runner — runs the PROOF SUITE against whatever answers at the
 * platform's serving endpoint, and seals the receipt + certificate on disk.
 *
 * The wire is the OpenAI dialect the platform already speaks: POST
 * /v1/chat/completions, temperature 0, seed 7, per-section max_tokens,
 * concurrency 1 (one item at a time — the serving endpoint is the same GPU
 * the operator is using). Every item is bounded by a 120s timeout; three
 * consecutive TRANSPORT failures (the endpoint died mid-run, not a wrong
 * answer) abort the whole run honestly — a run that cannot reach its subject
 * stops instead of scoring silence.
 *
 * One run at a time (module-level state — the desk reads it by polling
 * GET /proof-run). A second start while one is in flight is a 409, and so is
 * a start while a benchmark holds the rig (`active.lock`): both would share
 * one GPU and one set of serving slots, and each record would carry the
 * other's load (docs/work/bench-speed-campaign.md, L3).
 *
 * impure — network IO to the serving endpoint, filesystem via the certificate
 * store.
 */

import { randomUUID } from 'node:crypto';
import { PROOF_SUITE, PROOF_SUITE_VERSION, SECTION_MAX_TOKENS, SECTION_ORDER } from './proof-data.js';
import { scoreItem } from './proof-scorer.js';
import { probeServing, readRigLock } from './bench-status.js';
import { harnessRoot, servingUrl } from './bench-paths.js';
import { collectEnvironment, saveProof } from './proof-certificate.js';
import { createLogger } from '../logger.js';

const log = createLogger('Bench');

const ITEM_TIMEOUT_MS = 120000;
const TRANSPORT_ABORT_AFTER = 3;

/**
 * The one in-flight (or last) run's state — the poll's whole answer. Beyond
 * the counts: `itemStartedAt` + `itemPrompt` (truncated, ~300 chars — the
 * desk shows WHAT is being asked, never hardcoding suite items) and
 * `lastItem` (the last verdict, for the watcher's LAST line).
 */
let currentRun = null;

/**
 * The in-flight/last run's progress for the desk's poll.
 * @returns {{state: string, runId?: string, done?: number, total?: number,
 *   section?: string, itemId?: string, itemStartedAt?: string, itemPrompt?: string,
 *   lastItem?: object, passCount?: number, error?: string,
 *   proofId?: string, verdict?: object}}
 */
export const getProofRunState = () =>
  currentRun ?? { state: 'idle' };

/** pure — the structured refusal the routes map verbatim. */
const refuse = (status, code, message) => ({ ok: false, status, code, message });

/**
 * One item's completion from the serving endpoint. Transport failures THROW
 * here; the run loop classifies them (an item scored FAIL with
 * transportError:true, and the consecutive-failure breaker).
 * @param {string} endpoint
 * @param {object} item
 * @param {string} model the served id
 * @returns {Promise<string>} the raw completion text
 */
// impure (network POST to the serving endpoint)
const completeItem = async (endpoint, item, model) => {
  const res = await fetch(`${endpoint}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: item.prompt }],
      temperature: 0,
      seed: 7,
      max_tokens: SECTION_MAX_TOKENS[item.section] ?? 512,
    }),
    signal: AbortSignal.timeout(ITEM_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`serving answered HTTP ${res.status}`);
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new Error('the answer carried no completion text');
  return content;
};

/**
 * The run itself — every item answered, scored, and recorded, then sealed.
 * State updates land in currentRun as they happen; the desk polls them.
 * @param {string} endpoint
 * @param {string} model
 * @param {object} run the mutable currentRun record
 */
// impure (the real run: network per item, disk at the seal)
const executeProofRun = async (endpoint, model, run) => {
  const items = SECTION_ORDER.flatMap((section) => PROOF_SUITE.filter((item) => item.section === section));
  const answered = [];
  let transportStreak = 0;
  for (const item of items) {
    const startedAt = Date.now();
    run.itemStartedAt = new Date(startedAt).toISOString();
    // The desk shows WHAT is being asked — shipped suite data, truncated
    // server-side so the desk never hardcodes an item.
    run.itemPrompt = item.prompt.length > 300 ? `${item.prompt.slice(0, 300)}…` : item.prompt;
    run.itemId = item.id;
    run.section = item.section;
    let completion = null;
    let transportError = null;
    try {
      completion = await completeItem(endpoint, item, model);
      transportStreak = 0;
    } catch (err) {
      transportError = err.message;
      transportStreak += 1;
    }
    const durationMs = Date.now() - startedAt;
    const verdict = transportError
      ? { pass: false, detail: `no answer — ${transportError}` }
      : scoreItem(item, completion);
    run.lastItem = { id: item.id, pass: verdict.pass, durationMs, detail: verdict.detail };
    answered.push({
      id: item.id,
      section: item.section,
      prompt: item.prompt,
      completion,
      pass: verdict.pass,
      detail: verdict.detail,
      transportError: transportError !== null,
      durationMs,
    });
    run.done = answered.length;
    run.passCount = answered.filter((a) => a.pass).length;
    if (transportStreak >= TRANSPORT_ABORT_AFTER) {
      throw new Error(`the endpoint stopped answering mid-run (${TRANSPORT_ABORT_AFTER} consecutive transport failures — last: ${transportError}); the run is aborted, not scored as silence`);
    }
  }

  const sections = {};
  for (const section of SECTION_ORDER) {
    const rows = answered.filter((a) => a.section === section);
    sections[section] = { total: rows.length, pass: rows.filter((a) => a.pass).length };
  }
  const environment = await collectEnvironment();
  return {
    kind: 'bench-proof',
    suiteVersion: PROOF_SUITE_VERSION,
    runId: run.runId,
    startedAt: run.startedAt,
    finishedAt: new Date().toISOString(),
    subject: { servedId: model },
    environment,
    sampling: { temperature: 0, seed: 7 },
    sections,
    total: { total: answered.length, pass: answered.filter((a) => a.pass).length },
    items: answered,
  };
};

/**
 * Start a proof run against the serving endpoint. Refusals: 409
 * BENCH_PROOF_RUNNING when one is in flight; 409 BENCH_RIG_LOCKED while a
 * benchmark holds the rig; 409 BENCH_NOT_SERVING when no
 * model answers (the honest […]). On success the run rides
 * in the background and the desk polls its state.
 * @param {{endpoint?: string, root?: string}} [opts]
 * @returns {Promise<{ok: true, runId: string, total: number} | {ok: false, status: number, code: string, message: string}>}
 */
// impure (serving probe, then the run)
export const startProofRun = async ({ endpoint = servingUrl(), root = harnessRoot() } = {}) => {
  if (currentRun?.state === 'running') {
    return refuse(409, 'BENCH_PROOF_RUNNING', `a proof run is already in flight (${currentRun.done}/${currentRun.total} — ${currentRun.itemId})`);
  }
  const lock = await readRigLock(root);
  if (lock?.alive) {
    return refuse(409, 'BENCH_RIG_LOCKED',
      `a benchmark holds the rig (pid ${lock.pid}) — a proof run would share its GPU and serving slots; run the proof when it finishes`);
  }
  const serving = await probeServing(endpoint);
  if (!serving.ok) {
    return refuse(409, 'BENCH_NOT_SERVING',
      `no model answers at the serving endpoint (${serving.error}) — load a model first, then run the proof`);
  }
  const model = serving.models[0] ?? 'served';
  const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
  currentRun = {
    state: 'running',
    runId,
    startedAt: new Date().toISOString(),
    done: 0,
    total: PROOF_SUITE.length,
    section: null,
    itemId: null,
    passCount: 0,
  };
  log.info('proof run started', { runId, model, total: PROOF_SUITE.length });
  executeProofRun(endpoint, model, currentRun)
    .then(async (receipt) => {
      const saved = await saveProof(receipt);
      currentRun = {
        ...currentRun,
        state: 'done',
        finishedAt: receipt.finishedAt,
        proofId: saved.id,
        verdict: { pass: receipt.total.pass, total: receipt.total.total },
      };
      log.info('proof run done', { runId, pass: receipt.total.pass, total: receipt.total.total });
    })
    .catch((err) => {
      currentRun = { ...currentRun, state: 'failed', finishedAt: new Date().toISOString(), error: err.message };
      log.error('proof run failed', { runId, error: err.message });
    });
  return { ok: true, runId, total: PROOF_SUITE.length };
};
