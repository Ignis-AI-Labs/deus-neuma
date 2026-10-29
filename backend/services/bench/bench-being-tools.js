/**
 * BENCHMARKS FROM THE CONVERSATION — the model lists, checks and launches the
 * benchmarks of the connected benchmarks repository itself (Design note, 2026-10-15:
 * […]).
 *
 * One door, the desk's own: the catalog is bench-catalog.js (the repo's
 * cells/), a launch is bench-launch.js `launch('run-benchmark')` with every
 * gate it already has (lane ownership, the rig lock, the test-process
 * refusal, the plane) — plus one this door adds: a benchmark already running
 * ANYWHERE on this machine refuses the launch, so two desks never measure on
 * one GPU at once. Listing and status are reads; a launch is a GPU job of
 * minutes to hours and asks the operator first (tool-policy-defaults `bench`).
 * House work (a wake, a team member) never launches: nobody is at the desk to
 * say yes, and an Optio's CLEAR is not the operator's yes.
 *
 * The arms a seat may run: on the HARNESS, bare (the raw model) and harness
 * (the platform with no being) on the operator's harness lane; on a being's
 * lane, also neuma (the being itself).
 */
import { gateAct } from '../act-gate.js';
import { harnessRoot, available } from './bench-paths.js';
import { listCells, listModels } from './bench-catalog.js';
import { launch } from './bench-launch.js';
import { listRuns } from './bench-reports.js';
import { liveLine, liveProgress, liveRunners } from './bench-live.js';
import { armWatch } from '../chat-watch.js';
import { isHarnessLane } from '../../../core/workspace/lane-grounds.js';

const tool = (name, description, properties = {}, required = []) => Object.freeze({
  name,
  server: 'bench',
  description,
  inputSchema: Object.freeze({
    type: 'object',
    properties: Object.freeze(properties),
    ...(required.length ? { required: Object.freeze(required) } : {}),
  }),
});

export const BENCH_TOOLS = Object.freeze([
  tool('bench_list', 'List the benchmarks you can run from the connected benchmarks repository — each cell\'s id, what it measures, what a run costs, the arms THIS seat may run, and its latest result here. Optional {tier: t0|t1|t2|t3, dimension, query}.', {
    tier: { type: 'string' }, dimension: { type: 'string' }, query: { type: 'string', description: 'words in the id or label' },
  }),
  tool('bench_status', 'What is running now — a benchmark in flight on this machine, its arm, and the latest finished runs with their scores and prompt tokens per item.'),
  tool('bench_run', 'Launch a benchmark (asks the operator first — a GPU job of minutes to hours). {cell, arms?, limit?, model?}. Arms default to every arm this seat may run; limit samples a fresh draw of that many items.', {
    cell: { type: 'string', description: 'cell id from bench_list' },
    arms: { type: 'array', items: { type: 'string' }, description: 'bare | harness | neuma' },
    limit: { type: 'number', description: 'items to sample (a fresh draw)' },
    model: { type: 'string', description: 'registered model key; defaults to the only/first registered model' },
  }, ['cell']),
]);
const NAMES = new Set(BENCH_TOOLS.map((t) => t.name));

/** Does a parsed call target the bench? Pure. */
export const isBenchTool = (match) => NAMES.has(match?.toolName)
  || NAMES.has(String(match?.tool || '').replace(/^bench\//, ''));

/** House work — a wake, a team member's turn — has no operator at the desk (tool-approval.js). */
const isHouseWork = (connection) => Boolean(connection?._approvalRefusal);

/** What house work reads when it reaches for a launch: a benchmark window is the operator's own yes. */
export const HOUSE_WORK_BENCH_REFUSAL = 'A benchmark is a GPU window only your operator opens, with their own yes at the desk — house work never launches one, and no charter or review can clear it. It was NOT launched. If a run would serve this work, ask your operator for it (ask_operator) and carry on.';

/** Advertised wherever a lane is bound and a benchmarks repository is connected — never
 *  inside a benchmark sitting: the item under test does not reach the bench that measures it.
 *  House work reads the bench but never launches on it (no benchmark window without the
 *  operator's explicit yes — an Optio's CLEAR or a charter is not that yes). */
export const benchToolsFor = (connection) => {
  if (!connection?.companion?.neumaId || connection._benchmarkControls || !available(harnessRoot())) return [];
  return isHouseWork(connection) ? BENCH_TOOLS.filter((t) => t.name !== 'bench_run') : [...BENCH_TOOLS];
};

/** The arms a seat may run on its own lane. Pure. */
const seatArms = (laneId) => (isHarnessLane(laneId) ? ['bare', 'harness'] : ['bare', 'harness', 'neuma']);

// pure — one short line per cell a person can read and act on; the whole catalog
// fits ONE tool result (an over-cap list made the model page through its own
// result — a card for what it had already been handed, 2026-10-15)
const score = (value) => (typeof value === 'number' ? String(Math.round(value * 100) / 100) : '—');
const cellLine = (cell, arms, last) => {
  const runnable = cell.arms.filter((a) => arms.includes(a));
  const armsNote = runnable.length < arms.length ? ` · arms here: ${runnable.join(', ')}` : '';
  const result = last ? ` · last ${last.arm} ${score(last.primaryMetric?.value)} (${String(last.finishedAt || '').slice(5, 10)})` : '';
  return `${cell.id} — ${String(cell.label || cell.id).split(' — ')[0]} [${cell.dimensions.join(', ')}] ${cell.tier}${armsNote}${result}`;
};

// impure — the catalog this seat may run
const listFor = async (connection, args) => {
  const arms = seatArms(connection.companion.neumaId);
  const [cells, runs] = await Promise.all([listCells(), listRuns(undefined, 200).catch(() => [])]);
  const latest = new Map();
  for (const run of runs) if (run.status === 'succeeded' && !latest.has(run.suiteId)) latest.set(run.suiteId, run);
  const words = String(args?.query || '').toLowerCase().split(/\s+/).filter(Boolean);
  const shown = cells
    .filter((c) => !c.variant && c.arms.some((a) => arms.includes(a)))
    .filter((c) => !args?.tier || c.tier === args.tier)
    .filter((c) => !args?.dimension || c.dimensions.includes(args.dimension))
    .filter((c) => words.every((w) => `${c.id} ${c.label || ''}`.toLowerCase().includes(w)));
  return {
    summary: `${shown.length} benchmarks`,
    content: [
      `${shown.length} benchmarks in the benchmarks repository (${harnessRoot()}); this seat runs arms ${arms.join(', ')}. Tiers run from t0 (minutes) to t4 (hours).`,
      ...shown.map((c) => cellLine(c, arms, latest.get(c.id))),
      shown.length ? 'Launch one with bench_run {cell}.' : 'No cell matches — drop a filter.',
    ].join('\n'),
  };
};

// impure — what runs now, and what finished last
/** The runs live on this machine (bench-live.js) — re-exported for the chat's own callers. */
export const liveRuns = async () => (await liveRunners()).map(liveLine);

const statusNow = async () => {
  const [live, runs] = await Promise.all([liveProgress().then((all) => all.map(liveLine)), listRuns(undefined, 8).catch(() => [])]);
  const line = (r) => `${r.suiteId} ${r.arm} ${r.status} · ${r.primaryMetric?.value ?? '—'} · ${r.efficiency?.promptTokens && r.efficiency?.requests ? Math.round(r.efficiency.promptTokens / r.efficiency.requests) : '—'} prompt tok/request · ${String(r.finishedAt || '').slice(0, 16)}`;
  return {
    summary: live.length ? `running: ${live.join('; ')}` : 'nothing running',
    content: [
      live.length ? `Running now on this machine: ${live.join('; ')}.` : 'Nothing is running on this machine.',
      'Latest finished runs:', ...runs.map(line),
    ].join('\n'),
  };
};

// impure — the registered model THIS lane serves: its route's file, else the
// platform's claimed file, matched to models.json by file name. A run pins the
// engine the seat actually rides; the first entry is the last resort.
const servedModelKey = async (lane, models) => {
  const { resolveNeumaRoute } = await import('../neuma-route-resolver.js');
  const { readClaim } = await import('../substrate-claim-registry.js');
  const route = await resolveNeumaRoute(lane, null).catch(() => null);
  const files = [route?.model, readClaim()?.model].filter(Boolean).map((f) => String(f).split('/').pop());
  return models.find((m) => m.fileName && files.includes(m.fileName))?.key || models[0]?.key;
};

// impure — one launch through the desk's own door
const runOne = async (connection, args) => {
  const lane = connection.companion.neumaId;
  const allowed = seatArms(lane);
  const arms = Array.isArray(args?.arms) && args.arms.length ? args.arms : allowed;
  const outside = arms.filter((a) => !allowed.includes(a));
  if (outside.length) return { status: 'denied', error: `This seat cannot run ${outside.join(', ')} — its arms are ${allowed.join(', ')}.` };
  if ((await liveRuns()).length) {
    return { status: 'denied', error: 'A benchmark is already running on this machine — two runs on one GPU would measure each other. Wait for it (bench_status), then launch.' };
  }
  const models = await listModels();
  const model = args?.model || await servedModelKey(lane, models);
  if (!model) return { status: 'error', error: 'The benchmarks repository registers no model (models.json).' };
  const result = await launch('run-benchmark', {
    cell: args?.cell, arms, model, lane, ...(args?.limit ? { limit: Number(args.limit) } : {}),
  }, connection.walletAddress);
  if (!result?.ok) return { status: 'denied', error: `${result?.code || 'refused'}: ${result?.message || 'the launch was refused'}` };
  // THE WATCH: this chat is told when the set settles — a new turn with the result (chat-watch.js)
  const watch = await armWatch({
    wallet: connection.walletAddress, laneId: lane, sessionId: connection.sessionId,
    kind: 'bench', ref: result.comparisonId, label: `The benchmark you launched (${args.cell})`,
  }).catch(() => null);
  return {
    status: 'ok',
    // the chat card's line — a launch reads as one, never as the bare tool name
    summary: `launched ${args.cell} · ${arms.join(' + ')}`,
    // the run's identity rides the chat card, which watches it to its end (BenchRunCard)
    bench: { comparisonId: result.comparisonId, cell: args.cell, arms },
    content: `Launched ${args.cell} — arms ${arms.join(', ')} on ${model}${args?.limit ? `, ${args.limit} items` : ''}. Comparison ${result.comparisonId}. ${watch
      ? 'A watch is set on it: when the set settles, this chat is told the result in a new turn — and told so if a desk restart cuts the set first.'
      : 'Follow it with bench_status.'} Your operator watches it live from the BENCHMARK chip under the chat.`,
  };
};

/**
 * Serve one bench call. impure.
 * @returns {Promise<{tool: string, status: string, content?: string, error?: string}>}
 */
export const handleBenchTool = async (ws, connection, neumaPolicy, toolMode, match, args, ports = {}) => {
  const name = NAMES.has(match?.toolName) ? match.toolName : String(match?.tool || '').replace(/^bench\//, '');
  const toolId = `bench/${name}`;
  const send = (event) => ports.sendToolEvent?.(ws, connection.companion, event);
  // Refused before the gate, so no route can clear it and no record names the operator's yes.
  if (name === 'bench_run' && isHouseWork(connection)) {
    send({ tool: toolId, status: 'denied', summary: 'bench_run — refused: a benchmark window is the operator\'s yes' });
    return { tool: toolId, status: 'denied', error: HOUSE_WORK_BENCH_REFUSAL };
  }
  const gate = await gateAct(connection, { server: 'bench', tool: name, args, lanePolicy: neumaPolicy, mode: toolMode, emit: send });
  if (!gate.ok) return gate.result;
  try {
    if (!available(harnessRoot())) return { tool: toolId, status: 'unavailable', error: `No benchmarks repository is connected at ${harnessRoot()}.` };
    const out = name === 'bench_list' ? await listFor(connection, args)
      : name === 'bench_status' ? await statusNow()
        : await runOne(connection, args);
    send({ tool: toolId, status: out.status || 'ok', summary: out.summary || out.error || name, ...(out.bench ? { bench: out.bench } : {}) });
    return { tool: toolId, status: out.status || 'ok', ...(out.content ? { content: out.content } : {}), ...(out.error ? { error: out.error } : {}) };
  } catch (error) {
    send({ tool: toolId, status: 'error', summary: error.message });
    return { tool: toolId, status: 'error', error: error.message };
  }
};
