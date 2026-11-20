/**
 * THE ENGINE IN A BEING'S HANDS — reading and steering the image engine itself.
 *
 * A being could list pipelines and file a render; it could not see whether the
 * engine was up, what it had loaded, what was queued, or give the card back
 * (Design note, 2026-11-20: […]).
 *
 *   forge_status  — a READ: the engine whole (engine-lens.js), or the model
 *                   files it can see, folder by folder.
 *   forge_control — the ACTS: start · unload · stop · cancel · clear.
 *
 * Booting, stopping and unloading the engine are the machine's acts, and the
 * machine is its install owner's (ruling, 2026-10-19 — the same law the desk's
 * own buttons keep). So forge_control acts for a being whose operator owns or
 * co-owns this computer, and tells any other being so in words.
 *
 * Dispatched through the image family (image-being-tools.js), which has
 * already passed the ACTS gate by the time a handler here runs.
 */
import { readdir, readFile, stat } from 'fs/promises';
import path from 'path';
import { ensureComfyReady, freeComfy, stopComfy } from './comfyui-supervisor.js';
import { contentLawPath } from './content-law-path.js';
import { cancel } from './job-lane.js';
import { HOLDING_MB, readEngineLens, shapeEngineLens } from './engine-lens.js';
import { readInstallOwner, standingIn } from '../install-owner.js';
import { nodesAsOf, readEngineNodes } from './engine-nodes.js';
import { describeNode, searchNodes, shapeNode, shapeNodeList, shapeWorkflowMap } from './node-catalog.js';
import { findModel, findPipeline } from './workflow-store.js';
import { parameterize } from './parameterizer.js';
import { loadScreenList } from './prompt-screen.js';

export const FORGE_CONTROL_ACTS = Object.freeze(['start', 'unload', 'stop', 'cancel', 'clear']);

export const FORGE_ENGINE_TOOLS = Object.freeze([
  Object.freeze({
    name: 'forge_status',
    server: 'image',
    description: 'Read the image engine (ComfyUI) — args {view?, …}. It changes nothing. view "engine" (default): whether it is up and who started it, how much of the graphics card its models hold and how much is free, WHICH MODELS it has loaded (name, kind, size, file), what is rendering and waiting, when it unloads and stops by itself, what this machine can make. view "models": every model file it can load, folder by folder, with sizes. view "nodes": find nodes — {find: "words"} in a name or category, {makes: "IMAGE"} by what a node produces, {takes: "LATENT"} by what it needs; one line each. view "node" {node: "KSampler"}: one node in FULL — every input with its type, whether it is required, its default, its range and step or every choice, its note; every output and its number; and which nodes can feed each input and take each output ({choices: "<input>"} lists all of a long list of choices). view "workflow" {id}: a pipeline as a map — every node, every value with what the engine allows there and whether a knob controls it, every wire by the output it carries; for a built-in pipeline, its graph as JSON to build your own from. Read a node before you wire it, and a workflow before you edit it (forge/edit-workflow).',
    inputSchema: Object.freeze({
      type: 'object',
      properties: Object.freeze({
        view: Object.freeze({ type: 'string', enum: Object.freeze(['engine', 'models', 'nodes', 'node', 'workflow']), description: 'engine (default) | models | nodes | node | workflow' }),
        find: Object.freeze({ type: 'string', description: 'nodes: words in the node\'s name, title or category' }),
        makes: Object.freeze({ type: 'string', description: 'nodes: an output type, e.g. IMAGE, LATENT, MODEL, CONDITIONING' }),
        takes: Object.freeze({ type: 'string', description: 'nodes: a wired input type' }),
        offset: Object.freeze({ type: 'number', description: 'nodes: skip this many (default 0)' }),
        node: Object.freeze({ type: 'string', description: 'node: the node\'s class name, e.g. KSampler' }),
        choices: Object.freeze({ type: 'string', description: 'node: an input whose every choice to list' }),
        id: Object.freeze({ type: 'string', description: 'workflow: a pipeline id, registered (custom.<name>) or built-in' }),
      }),
    }),
  }),
  Object.freeze({
    name: 'forge_control',
    server: 'image',
    description: 'Steer the image engine (ComfyUI) — REQUIRED {act}. "unload": drop every loaded model and give their card memory back, keeping the engine up (the next render loads what it needs; this is how you make room before a different pipeline or for other work on the card). "stop": end the engine and return everything it holds; refused while jobs are rendering or waiting unless {force: true}. "start": bring the engine up now instead of on the first render. "cancel" with {job}: stop one job, rendering or waiting, by its id from forge_status. "clear": cancel every waiting job, leaving the one that is rendering. Each answer says what changed, measured. These are the machine\'s acts: they work when your operator owns or co-owns this computer.',
    inputSchema: Object.freeze({
      type: 'object',
      properties: Object.freeze({
        act: Object.freeze({ type: 'string', enum: FORGE_CONTROL_ACTS, description: 'start | unload | stop | cancel | clear' }),
        job: Object.freeze({ type: 'string', description: 'for cancel: the job id from forge_status' }),
        force: Object.freeze({ type: 'boolean', description: 'for stop: end the engine even though jobs are rendering or waiting (they are lost)' }),
      }),
      required: Object.freeze(['act']),
    }),
  }),
]);

const NAMES = new Set(FORGE_ENGINE_TOOLS.map((t) => t.name));
/** Is this bare tool name one of the engine's? Pure. */
export const isForgeEngineToolName = (name) => NAMES.has(name);

const gb = (mb) => (Number.isFinite(mb) ? `${(mb / 1024).toFixed(1)} GB` : 'unread');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const KNOWN_FILE = /\.(safetensors|gguf|ckpt|pt|pth|bin|sft)$/i;

// impure — may this connection's operator steer the machine?
const ownsMachine = async (connection) => {
  const standing = standingIn(await readInstallOwner().catch(() => null), connection?.walletAddress);
  return standing === 'owner' || standing === 'co-owner';
};

/**
 * The operator's extra model folders, from the engine's own extra-paths file:
 * each block gives a `base_path` and `folder: sub/dir` lines. Comments and
 * anything else are passed over. Pure.
 * @param {string} yaml
 * @returns {Array<{folder:string, dir:string}>}
 */
export const parseExtraModelPaths = (yaml) => {
  const out = [];
  let basePath = null;
  for (const raw of String(yaml || '').split('\n')) {
    const line = raw.replace(/\s+#.*$/, '');
    if (/^\S/.test(line)) { basePath = null; continue; }
    const pair = /^\s+([\w-]+):\s*(\S.*?)\s*$/.exec(line);
    if (!pair || /^\s*#/.test(raw)) continue;
    if (pair[1] === 'base_path') basePath = pair[2];
    else if (basePath && pair[1] !== 'is_default') out.push({ folder: pair[1], dir: path.resolve(basePath, pair[2]) });
  }
  return out;
};

/**
 * Every model file the engine can load: its own models folder and the
 * operator's extra folders, by folder, largest first. Read from disk, so it
 * answers with the engine stopped. A file reachable under two folder names
 * is listed once, under the first. impure.
 * @param {{modelsDir?:string, extraModelPaths?:string}} cfg
 * @returns {Promise<Array<{folder:string, files:Array<{name:string, mb:number, dir:string}>}>>}
 */
export const listModelFiles = async (cfg) => {
  const own = cfg?.modelsDir
    ? (await readdir(cfg.modelsDir, { withFileTypes: true }).catch(() => []))
      .filter((e) => e.isDirectory() || e.isSymbolicLink())
      .map((e) => ({ folder: e.name, dir: path.join(cfg.modelsDir, e.name) }))
    : [];
  const extra = cfg?.extraModelPaths ? parseExtraModelPaths(await readFile(cfg.extraModelPaths, 'utf8').catch(() => '')) : [];
  const byFolder = new Map();
  const seen = new Set();
  for (const { folder, dir } of [...own, ...extra]) {
    const names = await readdir(dir, { recursive: true }).catch(() => []);
    for (const name of names.filter((n) => KNOWN_FILE.test(n))) {
      const full = path.join(dir, name);
      const info = await stat(full).catch(() => null);
      if (!info?.isFile() || seen.has(full)) continue;
      seen.add(full);
      if (!byFolder.has(folder)) byFolder.set(folder, []);
      byFolder.get(folder).push({ name, mb: Math.round(info.size / 1048576), dir });
    }
  }
  return [...byFolder.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([folder, files]) => ({ folder, files: files.sort((a, b) => b.mb - a.mb || (a.name < b.name ? -1 : 1)) }));
};

/** The model files as a being reads them. Pure. */
export const shapeModelFiles = (folders) => {
  if (folders.length === 0) return 'No model files were found: the engine\'s models folder is empty or not set on this computer.';
  const count = folders.reduce((a, f) => a + f.files.length, 0);
  const total = folders.reduce((a, f) => a + f.files.reduce((b, x) => b + x.mb, 0), 0);
  const out = [`MODEL FILES the engine can load — ${count} files, ${gb(total)} on disk:`];
  for (const f of folders) {
    out.push(`${f.folder} (${f.files.length}):`);
    for (const file of f.files) out.push(`  ${file.name} — ${gb(file.mb)}`);
  }
  out.push('A file here is on disk, not on the card: forge_status shows what is loaded. list_pipelines shows which pipelines are ready and which wait for a file.');
  return out.join('\n');
};

// impure — wait (a few seconds at most) for the engine's models to leave the card, and say what was measured.
const untilUnloaded = async (cfg, beforeMB) => {
  let lens = null;
  for (let i = 0; i < 12; i += 1) {
    await delay(500);
    lens = await readEngineLens(cfg);
    const now = lens.memory?.modelsOnCardMB;
    if (!Number.isFinite(now) || now < HOLDING_MB || (lens.queue?.running.length ?? 0) > 0) break;
  }
  const after = lens?.memory?.modelsOnCardMB;
  if ((lens?.queue?.running.length ?? 0) > 0) return 'A job is rendering, so the models stay until it ends; they unload then.';
  if (!Number.isFinite(after)) return 'The unload was accepted; the card could not be measured afterwards.';
  if (after >= HOLDING_MB) return `The unload was accepted, but the engine's models still hold ${gb(after)} after 6 seconds (they held ${gb(beforeMB)}). Read forge_status again in a moment.`;
  return `Unloaded: the engine's models held ${gb(beforeMB)} and now hold ${gb(after)}. The card has ${gb(lens.memory.cardFreeMB)} free. The engine is still up; the next render loads what it needs.`;
};

const NO_NODES = 'The engine\'s node list has not been read on this computer yet: it is read from the running engine. forge_control {act: "start"} brings the engine up (the house that owns this computer does that), then read again.';

// impure — a built-in pipeline's graph, built with its defaults and a stand-in prompt, to copy and build from.
const builtInGraph = (pipeline) => {
  const model = findModel(pipeline);
  if (!model.ok) return { error: model.error };
  const built = parameterize({
    pipeline, model: model.model, args: { positive: 'YOUR PROMPT' }, jobId: 'example', screenList: loadScreenList(contentLawPath()), fallbackSeed: 0,
    sourceImageName: pipeline.requiresSourceImage ? 'YOUR-IMAGE.png' : null, sourceLineage: pipeline.requiresSourceImage ? 'an example' : undefined,
  });
  return built.ok ? { graph: built.graph } : { error: built.error };
};

// impure — the three views that read nodes: find, one in full, a workflow's map.
const readNodeViews = async (args, cfg) => {
  const nodes = await readEngineNodes(cfg);
  if (args.view === 'workflow') {
    const id = String(args?.id ?? '').trim();
    if (!id) return { ok: false, reason: 'view "workflow" needs {id}: a pipeline id from list_pipelines' };
    const found = await findPipeline(id);
    if (!found.ok) return { ok: false, reason: found.error };
    if (found.pipeline.custom) return { ok: true, content: shapeWorkflowMap(found.pipeline, nodes?.objectInfo ?? null), summary: `read the map of ${id}` };
    const built = builtInGraph(found.pipeline);
    if (built.error) return { ok: false, reason: `'${id}' is built in, and its graph could not be laid out with defaults alone: ${built.error}` };
    const asWorkflow = { id, label: found.pipeline.label, description: found.pipeline.description, graph: built.graph, binds: {}, slots: {}, sourceBind: null };
    return {
      ok: true, summary: `read the graph of ${id}`,
      content: `${shapeWorkflowMap(asWorkflow, nodes?.objectInfo ?? null).split('\nKNOBS a caller')[0]}\nThis pipeline is BUILT IN: it is not edited. Its callers set: ${Object.keys(found.pipeline.slots).join(', ')}. To make your own from it, file forge/register-workflow with a custom.<name> id, your knobs, and this graph (its stand-in prompt, seed and file name are replaced on every render):\n${JSON.stringify(built.graph)}`,
    };
  }
  if (!nodes) return { ok: false, reason: NO_NODES };
  const asOf = nodesAsOf(nodes);
  if (args.view === 'node') {
    const name = String(args?.node ?? '').trim();
    const node = describeNode(name, nodes.objectInfo[name]);
    if (!node) {
      const near = searchNodes(nodes.objectInfo, { find: name }).slice(0, 12).map((n) => n.name);
      return { ok: false, reason: `this engine has no node '${name}'.${near.length ? ` Close: ${near.join(', ')}.` : ''} {view: "nodes", find: "…"} searches them.` };
    }
    if (node.outside) return { ok: false, reason: `'${name}' sends work to an outside service, so no workflow here may use it.` };
    return { ok: true, content: `${shapeNode(node, nodes.objectInfo, { choices: typeof args?.choices === 'string' ? args.choices : undefined })}\n(${asOf})`, summary: `read node ${name}` };
  }
  const found = searchNodes(nodes.objectInfo, { find: args?.find, makes: args?.makes, takes: args?.takes });
  const offset = Number.isInteger(args?.offset) && args.offset >= 0 ? args.offset : 0;
  return { ok: true, content: shapeNodeList(found, { offset, total: searchNodes(nodes.objectInfo).length, asOf }), summary: `found ${found.length} node(s)` };
};

/**
 * One engine tool call, already through the ACTS gate. impure.
 * @param {Object} connection
 * @param {string} toolName - forge_status | forge_control
 * @param {Object} args
 * @param {ReturnType<import('./comfyui-config.js').resolveComfyConfig>} cfg
 * @returns {Promise<{ok:true, content:string, summary:string}|{ok:false, reason:string}>}
 */
export const runForgeEngineTool = async (connection, toolName, args, cfg) => {
  const full = await ownsMachine(connection);
  if (toolName === 'forge_status') {
    if (args?.view === 'models') {
      const folders = await listModelFiles(cfg);
      return { ok: true, content: shapeModelFiles(folders), summary: `listed model files — ${folders.reduce((a, f) => a + f.files.length, 0)}` };
    }
    if (args?.view === 'nodes' || args?.view === 'node' || args?.view === 'workflow') return readNodeViews(args, cfg);
    if (args?.view !== undefined && args.view !== 'engine') return { ok: false, reason: 'view must be engine, models, nodes, node or workflow' };
    const lens = await readEngineLens(cfg);
    return { ok: true, content: shapeEngineLens(lens, { full }), summary: `read the image engine — ${lens.serving ? 'ready' : lens.state}` };
  }

  const act = String(args?.act ?? '').trim();
  if (!FORGE_CONTROL_ACTS.includes(act)) return { ok: false, reason: `act must be one of ${FORGE_CONTROL_ACTS.join(', ')}` };
  if (!full) {
    return { ok: false, reason: 'Starting, stopping and unloading the image engine belong to the house that owns this computer, and your operator does not. forge_status still shows you its state; a render you file is still queued for you.' };
  }
  const before = await readEngineLens(cfg);

  if (act === 'start') {
    if (before.serving) return { ok: true, content: 'The engine is already up.\n\n' + shapeEngineLens(before, { full }), summary: 'engine already up' };
    if (!before.installed) return { ok: false, reason: 'The image engine is not installed on this computer.' };
    const ready = await ensureComfyReady(cfg);
    if (ready.state !== 'ready') {
      const why = ready.lastError?.error || ready.lastError || ready.install?.reason || `it is ${ready.state}`;
      return { ok: false, reason: `The engine did not come up: ${typeof why === 'string' ? why : JSON.stringify(why)}` };
    }
    return { ok: true, content: 'Started.\n\n' + shapeEngineLens(await readEngineLens(cfg), { full }), summary: 'started the image engine' };
  }
  if (!before.serving) return { ok: false, reason: `The engine is ${before.state === 'launching' ? 'still starting' : 'not running'}, so there is nothing to ${act}. It holds nothing on the card.` };

  if (act === 'unload') {
    const held = before.memory?.modelsOnCardMB;
    if (Number.isFinite(held) && held < HOLDING_MB) return { ok: true, content: `Nothing to unload: the engine's models hold ${gb(held)} on the card. The card has ${gb(before.memory.cardFreeMB)} free.`, summary: 'nothing to unload' };
    const freed = await freeComfy(cfg);
    if (!freed.ok) return { ok: false, reason: 'The engine refused the unload.' };
    return { ok: true, content: await untilUnloaded(cfg, held), summary: 'unloaded the engine\'s models' };
  }
  if (act === 'stop') {
    const busy = (before.queue?.running.length ?? 0) + (before.queue?.waiting.length ?? 0);
    if (busy > 0 && args?.force !== true) {
      return { ok: false, reason: `${before.queue.running.length} job(s) rendering and ${before.queue.waiting.length} waiting would be lost. Cancel them, wait, or call stop with {force: true}.` };
    }
    const result = await stopComfy();
    if (result.status === 'released') return { ok: true, content: 'This engine was started by hand, so it is not this platform\'s to end: it was let go and is still running. forge_control {act: "unload"} could not reach it either now. Its owner must stop it.', summary: 'released a hand-started engine' };
    if (result.status !== 'stopped') return { ok: false, reason: `The engine was not stopped (${result.status}).` };
    return { ok: true, content: `Stopped. It held ${gb(before.memory?.cardMB)} of the card and ${gb(before.memory?.ramMB)} of system memory; both are returned. It starts again on the next render.`, summary: 'stopped the image engine' };
  }
  if (act === 'cancel') {
    const job = String(args?.job ?? '').trim();
    const known = [...(before.queue?.running ?? []), ...(before.queue?.waiting ?? [])];
    if (!job) return { ok: false, reason: `cancel needs {job}. On the engine now: ${known.length ? known.join(', ') : 'no jobs'}.` };
    if (!known.includes(job)) return { ok: false, reason: `No job ${job} is rendering or waiting. On the engine now: ${known.length ? known.join(', ') : 'no jobs'}.` };
    const result = await cancel(cfg, job);
    return result.cancelled
      ? { ok: true, content: `Cancelled ${job} (${before.queue.running.includes(job) ? 'it was rendering' : 'it was waiting'}).`, summary: 'cancelled a job' }
      : { ok: false, reason: `The engine did not cancel ${job}.` };
  }
  // clear — every waiting job, never the one rendering.
  const waiting = before.queue?.waiting ?? [];
  if (waiting.length === 0) return { ok: true, content: 'No job is waiting.', summary: 'nothing waiting' };
  const results = await Promise.all(waiting.map((job) => cancel(cfg, job).catch(() => ({ cancelled: false }))));
  const dropped = results.filter((r) => r.cancelled).length;
  return { ok: true, content: `Cancelled ${dropped} of ${waiting.length} waiting job(s).${before.queue.running.length ? ' The one rendering was left to finish.' : ''}`, summary: `cleared ${dropped} waiting job(s)` };
};
