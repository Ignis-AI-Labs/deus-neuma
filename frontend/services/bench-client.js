// bench-client.js — the operator's client for the bench plane: the read
// plane (status — which carries the incident rail — queue, runs, reports,
// scoreboard, catalog, models, plans), the launch plane (preflight, launch,
// stop, relight), and the proof suite (run, progress, certificates, PDF),
// mirroring staff-client.js. Every failure throws with the route's honest
// reason — the structured {error:{code,message}} refusal rides the Error's
// message AND code (see httpErrorFromResponse), so a panel that was refused
// says exactly what the server said. A launch panel that could not act must
// never LOOK like it did.

import { apiCall, authHeadersOrNull as authHeaders } from '../utils/http.js';

const BASE = '/api/v1/bench';

/**
 * One JSON round-trip against the bench routes: bearer headers, an optional
 * JSON body, and a thrown Error that carries the server's own refusal reason
 * (and its `code` — BENCH_HARNESS_ABSENT & co. — for the register switch).
 * @param {string} method HTTP method
 * @param {string} path route path under /api/v1/bench
 * @param {{body?: *, errorPrefix?: string}} [options]
 * @returns {Promise<*>} the parsed response body ({} when it is not JSON)
 */
// impure — the single transport every export below rides.
const benchCall = async (method, path, { body, errorPrefix } = {}) => {
  const headers = authHeaders();
  if (!headers) throw new Error('Not authenticated.');
  return apiCall(method, `${BASE}${path}`, { body, errorPrefix, errorSuffix: '.' });
};

/**
 * The desk's one-call OVERVIEW: serving probe, rig lock, latest night window,
 * harness daemon liveness, the serving-incident tail, and the children THIS
 * plane owns. Throws BENCH_HARNESS_ABSENT (err.code) when no harness stands.
 * @returns {Promise<{serving: object, lock: (object|null), night: (object|null),
 *   daemons: object, incidents: Array, owned: Array}>}
 */
// impure
export const getBenchStatus = async () =>
  benchCall('GET', '/status', { errorPrefix: 'Could not read bench status' });

/**
 * THE WATCH — every benchmark running on this machine (whoever launched it),
 * each with its cell, arm, minutes and items done of total, plus this desk's
 * matched set. Light: no serving, GPU or daemon probes — the composer's
 * BenchRunChip polls it.
 * @returns {Promise<{live: Array<{cell: ?string, arm: ?string, minutes: number,
 *   done?: ?number, total?: ?number}>, chain: (object|null)}>}
 */
// impure
export const getBenchLive = async () =>
  benchCall('GET', '/live', { errorPrefix: 'Could not read the running benchmarks' });

/**
 * One set's report, pressed with the house brand (pressed now when it was not):
 * the paths of its HTML (the desk opens it in the browser) and PDF.
 * @param {string} comparisonId
 * @returns {Promise<{html: string, pdf: ?string, md: string}>}
 */
// impure
export const getBenchReportFile = async (comparisonId) =>
  benchCall('GET', `/comparisons/${encodeURIComponent(comparisonId)}/report`, { errorPrefix: 'Could not press the report' });

/**
 * The last matched set's copyable FAILURE REPORT (markdown: the chain's facts
 * plus every failed arm's log tail). Throws BENCH_NO_CHAIN when none has run.
 * @returns {Promise<{text: string, failedArms: string[], state: string}>}
 */
// impure
export const getBenchChainReport = async () =>
  benchCall('GET', '/chain/report', { errorPrefix: 'Could not build the failure report' });

/**
 * The latest night window's parsed status (the queue the window worked).
 * @returns {Promise<{queue: (object|null)}>}
 */
// impure
export const getBenchQueue = async () =>
  benchCall('GET', '/queue', { errorPrefix: 'Could not read the night queue' });

/**
 * The run ledger, newest first.
 * @param {number} [limit]
 * @returns {Promise<{runs: Array}>}
 */
// impure
export const getBenchRuns = async (limit = 50) =>
  benchCall('GET', `/runs?limit=${limit}`, { errorPrefix: 'Could not list bench runs' });

/**
 * WHAT HAPPENED inside one run: its stages (exit code, signal, timeout,
 * abort) and the tail of each log it sealed, stderr first.
 * @param {string} runId
 * @returns {Promise<{runId: string, status: ?string, failure: ?object, executions: Array, logs: Array}>}
 */
// impure
export const getBenchRunEvidence = async (runId) =>
  benchCall('GET', `/runs/${encodeURIComponent(runId)}/evidence`, { errorPrefix: 'Could not read what happened in the run' });

/**
 * WHY IT MISSED: a matched set's diagnosis — every missed item classified by
 * cause and paired against BARE — plus the copyable markdown (#557).
 * @param {string} comparisonId
 * @returns {Promise<{diagnosis: object, markdown: string}>}
 */
// impure
export const getBenchDiagnosis = async (comparisonId) =>
  benchCall('GET', `/diagnose/${encodeURIComponent(comparisonId)}`, { errorPrefix: 'Could not diagnose the set' });

/**
 * Report bundles on disk, newest first: [{id, mtimeMs}].
 * @returns {Promise<{bundles: Array<{id: string, mtimeMs: number}>}>}
 */
// impure
export const getBenchBundles = async () =>
  benchCall('GET', '/reports', { errorPrefix: 'Could not list report bundles' });

/**
 * One bundle's metadata plus its REPORT.md text.
 * @param {string} id bundle id
 * @returns {Promise<{bundle: {id: string, mtimeMs: (number|null)}, report: (string|null)}>}
 */
// impure
export const getBenchBundle = async (id) =>
  benchCall('GET', `/reports/${encodeURIComponent(id)}`, { errorPrefix: 'Could not read the bundle' });

/**
 * One bundle artifact as text (report/metrics/receipts/queue — the server's
 * closed map; anything else is a 400 with the server's own reason).
 * @param {string} id bundle id
 * @param {string} artifact artifact key
 * @returns {Promise<{bundle: string, artifact: string, text: string}>}
 */
// impure
export const getBenchBundleArtifact = async (id, artifact) =>
  benchCall('GET', `/reports/${encodeURIComponent(id)}/${encodeURIComponent(artifact)}`, { errorPrefix: 'Could not read the artifact' });

/**
 * The scoreboard family as raw texts (scoreboard/ladder/nightLatest, each
 * null when absent).
 * @returns {Promise<{scoreboard: (string|null), ladder: (string|null), nightLatest: (string|null)}>}
 */
// impure
export const getBenchScoreboard = async () =>
  benchCall('GET', '/scoreboard', { errorPrefix: 'Could not read the scoreboard' });

/**
 * Every declared cell (the launchable questions).
 * @returns {Promise<{cells: Array}>}
 */
// impure
export const getBenchCatalog = async () =>
  benchCall('GET', '/catalog', { errorPrefix: 'Could not list bench cells' });

/**
 * Registered models with launch-readiness flags (hasSha256).
 * @returns {Promise<{models: Array}>}
 */
// impure
export const getBenchModels = async () =>
  benchCall('GET', '/models', { errorPrefix: 'Could not list bench models' });

/**
 * The session wallet's OWN lanes (house + witnesses) for the identity arms.
 * @returns {Promise<{lanes: Array<{laneId: string, label: string, kind: string}>}>}
 */
// impure
export const getBenchLanes = async () =>
  benchCall('GET', '/lanes', { errorPrefix: 'Could not list your lanes' });

/**
 * Window plans on file.
 * @returns {Promise<{plans: Array}>}
 */
// impure
export const getBenchPlans = async () =>
  benchCall('GET', '/plans', { errorPrefix: 'Could not list bench plans' });

/**
 * Preflight a (cell, arm, model) triple through the harness's own gate.
 * Identity arms carry their lane (+ optional workspaceRoot) in the same body.
 * @param {{cell: string, arm: string, model: string, lane?: string, workspaceRoot?: string}} params
 * @returns {Promise<{pid: number, exitCode: number, logFile: string, argv: string[], stdoutTail: string}>}
 */
// impure
export const postBenchPreflight = async (params) =>
  benchCall('POST', '/preflight', { body: params, errorPrefix: 'Preflight refused' });

/**
 * Launch a catalog verb. Validation refusals (400), rig locks (409), and an
 * absent harness (503) all throw with the server's own reason.
 * @param {string} verb one of the closed catalog verbs
 * @param {object} [params]
 * @returns {Promise<{pid: number, verb: string, logFile: string, argv: string[],
 *   exitCode?: number, stdout?: string, long?: boolean}>}
 */
// impure
export const postBenchLaunch = async (verb, params = {}) =>
  benchCall('POST', '/launch', { body: { verb, params }, errorPrefix: 'Launch refused' });

/**
 * SIGTERM the plane-owned long children. 404 (thrown) when the plane owns none.
 * @returns {Promise<{ok: true, stopped: number[]}>}
 */
// impure
export const postBenchStop = async () =>
  benchCall('POST', '/stop', { body: {}, errorPrefix: 'Stop refused' });

/**
 * Relight serving: stand the serving watchdog and the swap daemon back up
 * with the chosen model. 409 when serving is healthy or a daemon already
 * stands (the server's reason rides the thrown Error, verbatim).
 * @param {string} model a registered model key
 * @returns {Promise<{ok: true, verb: string, spawned: Array<{name: string,
 *   via: string, pid: (number|null)}>, detail: string}>}
 */
// impure
export const postBenchRelight = async (model) =>
  benchCall('POST', '/relight', { body: { model }, errorPrefix: 'Relight refused' });

/**
 * Start a proof run against the loaded model. 202 with the run id; 409
 * BENCH_PROOF_RUNNING / BENCH_NOT_SERVING throw with the server's own reason.
 * @returns {Promise<{runId: string, total: number, run: object}>}
 */
// impure
export const startBenchProof = async () =>
  benchCall('POST', '/proof-run', { body: {}, errorPrefix: 'The proof run refused to start' });

/**
 * The in-flight/last proof run's progress (the desk's poll while it runs).
 * @returns {Promise<{run: object}>}
 */
// impure
export const getBenchProofRun = async () =>
  benchCall('GET', '/proof-run', { errorPrefix: 'Could not read the proof run' });

/**
 * The sealed proof certificates, newest first.
 * @returns {Promise<{proofs: Array<{id: string, mtimeMs: number}>}>}
 */
// impure
export const getBenchProofs = async () =>
  benchCall('GET', '/proofs', { errorPrefix: 'Could not list proofs' });

/**
 * One certificate: its receipt plus the markdown.
 * @param {string} id the proof id (runId)
 * @returns {Promise<{receipt: object, certificate: string}>}
 */
// impure
export const getBenchProof = async (id) =>
  benchCall('GET', `/proofs/${encodeURIComponent(id)}`, { errorPrefix: 'Could not read the proof' });

/**
 * The certificate pressed to a branded PDF (raw bytes for the desk's
 * download). The doc-press blob idiom: not apiCall — the answer is a file,
 * not JSON; a refusal still parses its JSON reason.
 * @param {string} id the proof id
 * @returns {Promise<{blob: Blob, filename: string}>}
 */
// impure
export const fetchBenchProofPdf = async (id) => {
  const headers = authHeaders();
  if (!headers) throw new Error('Not authenticated.');
  const res = await fetch(`${BASE}/proofs/${encodeURIComponent(id)}/pdf`, { headers });
  if (!res.ok) {
    const parsed = await res.json().catch(() => ({}));
    throw new Error(parsed?.error?.message ?? parsed?.error ?? `Press failed (${res.status}).`);
  }
  return { blob: await res.blob(), filename: `neuma-bench-proof-${id}.pdf` };
};

/**
 * REPORTS → SUMMARY: every comparable series per suite (each with its chart
 * model), the catalog cells never taken, and the proof history.
 * @returns {Promise<{suites: Array, notTaken: Array, proofs: Array}>}
 */
// impure
export const getBenchSummary = async () =>
  benchCall('GET', '/summary', { errorPrefix: 'Could not read the summary' });

const shareQuery = ({ kind, id, size }) =>
  `kind=${encodeURIComponent(kind)}&id=${encodeURIComponent(id)}&size=${encodeURIComponent(size)}`;

/**
 * A share card's Markdown table and PNG filename.
 * @param {{kind: 'series'|'proof', id: string, size: string}} source
 * @returns {Promise<{markdown: string, filename: string}>}
 */
// impure
export const getBenchShare = async (source) =>
  benchCall('GET', `/share?${shareQuery(source)}`, { errorPrefix: 'Could not draw the card' });

/**
 * The share card as PNG bytes (faces embedded — the exact file that posts).
 * The blob idiom of fetchBenchProofPdf: a refusal still parses its JSON reason.
 * @param {{kind: 'series'|'proof', id: string, size: string}} source
 * @returns {Promise<Blob>}
 */
// impure
export const fetchBenchSharePng = async (source) => {
  const headers = authHeaders();
  if (!headers) throw new Error('Not authenticated.');
  const res = await fetch(`${BASE}/share/png?${shareQuery(source)}`, { headers });
  if (!res.ok) {
    const parsed = await res.json().catch(() => ({}));
    throw new Error(parsed?.error?.message ?? parsed?.error ?? `The card did not render (${res.status}).`);
  }
  return res.blob();
};
