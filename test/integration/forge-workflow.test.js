/**
 * A NEUMA REGISTERS A WORKFLOW AS A PIPELINE (intents/forge-workflow.js, image-forge/workflow-rules.js,
 * workflow-store.js) — Design note, 2026-11-20: […].
 * Real approval transport and the real sweep: the card comes first even in AUTO and says what the workflow runs; a
 * proposal that breaks a rule is refused before any card with everything to fix; a registered workflow is listed,
 * rendered through image/generate under the content law, and forgotten. The proposed graph is the platform's own
 * SDXL graph (buildTxt2Img), filed as a being would write it.
 *
 * The step that needs a LIVE engine — holding the workflow against the engine's own node list — is proven in the
 * summoned block at the foot (RUN_GPU_ENGINE_TESTS=1, real pinned engine, no model loaded). Without the summons the
 * yes is shown to keep NOTHING when the engine cannot be reached.
 */
/* global console */
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import workspace from '../../core/workspace/neuma-workspace.js';
import { createHarnessTurnKit, untilHarness } from '../helpers/harness-turn-kit.js';
import { makeInstallOwner } from '../helpers/install-owner-kit.js';
import { shouldRunGpuEngineTests, gpuSkipNote } from '../helpers/gpu-optin.js';
import { sweepIntents } from '../../backend/services/intents/intent-sweep.js';
import { buildTxt2Img } from '../../backend/services/image-forge/templates.js';
import { catalogWithWorkflows, findPipeline, listWorkflows, saveWorkflow } from '../../backend/services/image-forge/workflow-store.js';
import { handleImageTool } from '../../backend/services/image-forge/image-being-tools.js';
import { comfyShutdown, resolveComfyConfig } from '../../backend/services/image-forge/comfyui-supervisor.js';
import { runForgeEngineTool } from '../../backend/services/image-forge/forge-engine-tools.js';
import { OBJECT_INFO } from '../helpers/comfy-object-info.js';

const KEYS = ['COMFYUI_INSTALL_DIR', 'COMFYUI_MODELS_DIR', 'COMFYUI_CONTENT_LAW_PATH', 'COMFYUI_URL', 'COMFYUI_DATA_DIR', 'COMFYUI_EXTRA_MODEL_PATHS', 'NEUMA_DATA_ROOT'];
const CKPT = 'sd_xl_base_1.0.safetensors';
const proposal = (over = {}) => ({
  id: 'custom.harbour-stills', label: 'Harbour stills',
  description: 'SDXL stills in the harbour house look. Describe the scene; keep the negative short.',
  graph: buildTxt2Img({ ckptName: CKPT, width: 1024, height: 1024, positive: 'a placeholder', negative: 'blurry', seed: 1, steps: 25, cfg: 7, samplerName: 'euler', scheduler: 'normal', filenamePrefix: 'anything' }),
  slots: {
    positive: { into: { node: '6', input: 'text' } },
    negative: { into: { node: '7', input: 'text' } },
    seed: { into: { node: '3', input: 'seed' } },
    steps: { type: 'int', min: 10, max: 40, into: { node: '3', input: 'steps' } },
  },
  ...over,
});

let kit; let saved; let intents; let models;
const setUp = async ({ owner = true } = {}) => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  kit = await createHarnessTurnKit();
  const root = kit.root;
  // An install that is present on a port nothing answers, a models folder holding the one file the graph names, and a law.
  const install = path.join(root, 'engine');
  await fs.mkdir(path.join(install, '.venv', 'bin'), { recursive: true });
  await fs.writeFile(path.join(install, 'main.py'), '');
  await fs.writeFile(path.join(install, '.venv', 'bin', 'python'), '');
  models = path.join(root, 'models');
  await fs.mkdir(path.join(models, 'checkpoints'), { recursive: true });
  await fs.writeFile(path.join(models, 'checkpoints', CKPT), 'weights');
  const law = path.join(root, 'content-law.json');
  await fs.writeFile(law, JSON.stringify({ classes: { csam: ['zzcsamterm'], age_minor: [], sexual_explicit: [], sexual_suggestive: [], incest: [], bestiality: [], nonconsent: [] }, wordClasses: { deaging: [] } }));
  Object.assign(process.env, { COMFYUI_INSTALL_DIR: install, COMFYUI_MODELS_DIR: models, COMFYUI_CONTENT_LAW_PATH: law, COMFYUI_URL: 'http://127.0.0.1:8198', COMFYUI_DATA_DIR: path.join(root, 'comfy') });
  delete process.env.COMFYUI_EXTRA_MODEL_PATHS;
  await makeInstallOwner(owner ? kit.connection.walletAddress : '0x9999999999999999999999999999999999999999');
  intents = path.join(workspace.pathFor(kit.laneId), 'intents');
  await fs.mkdir(intents, { recursive: true });
};
afterEach(async () => {
  await comfyShutdown();
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  await kit?.close();
});
const file = (name, payload) => fs.writeFile(path.join(intents, `${name}.json`), JSON.stringify(payload));
const sweep = (mode = 'auto') => sweepIntents(kit.connection, { mode, lanePolicy: null, emit: kit.emit });
const cards = () => kit.frames.filter((f) => f.type === 'tool:approval_request');
const nextCard = (seen = 0) => untilHarness(() => cards()[seen]);

describe('a neuma registers a workflow as a pipeline', () => {
  beforeEach(() => setUp());

  test('the card comes first, even in AUTO, and says what the workflow runs; when the engine cannot be reached the yes keeps nothing', async () => {
    await file('register', { type: 'forge/register-workflow', ...proposal() });
    const run = sweep();
    const request = await nextCard();
    const words = JSON.stringify(request);
    expect(words).toContain('register the image workflow custom.harbour-stills \\"Harbour stills\\" as a pipeline every being on this computer can render through');
    expect(words).toContain('7 nodes (KSampler, CheckpointLoaderSimple, EmptyLatentImage, CLIPTextEncode, VAEDecode, SaveImage)');
    expect(words).toContain(`loads ${CKPT}; a caller may set positive, negative, seed, steps 10–40`);
    expect(words).toContain('still passes the content law');
    expect(await listWorkflows()).toEqual([]); // nothing before the yes
    kit.decide(request, 'allow');
    const [result] = await run;
    expect(result).toMatchObject({ tool: 'intents/forge.workflow', status: 'error' });
    expect(result.error).toMatch(/^Not kept: the image engine could not be read \(/);
    expect(result.error).toContain('Nothing was changed.');
    expect(await listWorkflows()).toEqual([]);
  }, 240_000);

  test('a proposal that breaks the rules is refused before any card, with everything to fix; a forbidden text written into it is refused by class', async () => {
    const broken = proposal({ id: 'harbour', slots: { negative: { into: { node: '7', input: 'text' } }, where: { type: 'enum', values: ['x'], into: { node: '9', input: 'filename_prefix' } } } });
    await file('broken', { type: 'forge/register-workflow', ...broken });
    const [refused] = await sweep();
    expect(refused).toMatchObject({ tool: 'intents/forge.workflow', status: 'error' });
    expect(refused.error).toContain('id must be custom.<name>');
    expect(refused.error).toContain('slots must include positive');
    expect(refused.error).toContain('\'where\' may not set where a file is written');
    const baked = proposal();
    baked.graph['7'].inputs.text = 'zzcsamterm';
    delete baked.slots.negative;
    await file('baked', { type: 'forge/register-workflow', ...baked });
    const [denied] = await sweep();
    expect(denied.status).toBe('denied');
    expect(denied.error).toContain('Refused by content law (csam): a text written into this workflow');
    expect(cards()).toEqual([]);
  }, 60_000);

  test('once registered it is listed, renders through image/generate under the content law, and can be forgotten', async () => {
    // The engine-side check is the summoned block's; here the record is kept as the yes keeps it.
    await saveWorkflow(proposal(), { by: kit.laneId });
    expect((await findPipeline('custom.harbour-stills')).pipeline).toMatchObject({ custom: true, registeredBy: kit.laneId, files: [{ folder: 'checkpoints', name: CKPT }] });
    const entry = (await catalogWithWorkflows()).find((p) => p.id === 'custom.harbour-stills');
    expect(entry).toMatchObject({ registered: true, kind: 'still', requiresSourceImage: false });
    expect(entry.parameters).toEqual([
      { name: 'positive', type: 'text', required: true },
      { name: 'negative', type: 'text', default: '' },
      { name: 'seed', type: 'int', min: 0, max: 4294967295 },
      { name: 'steps', type: 'int', min: 10, max: 40, default: 25 },
    ]);
    // list_pipelines, the being's own read, shows it beside the platform's.
    const listed = await handleImageTool(kit.ws, kit.connection, null, 'auto', { tool: 'image/list_pipelines' }, {}, { sendToolEvent: () => {} });
    expect(listed.status).toBe('ok');
    expect(listed.content).toContain('- custom.harbour-stills — Harbour stills');
    expect(listed.content).toContain('steps: 10–40 (default 25)');
    expect(listed.content).toContain('- still.sdxl.txt2img');

    // A prompt the law refuses is refused before any card, by class; a knob it does not have is named.
    await file('bad', { type: 'image/generate', pipeline: 'custom.harbour-stills', prompt: 'a zzcsamterm scene' });
    expect((await sweep())[0]).toMatchObject({ status: 'denied', error: expect.stringContaining('Refused by content law (csam)') });
    await file('knob', { type: 'image/generate', pipeline: 'custom.harbour-stills', prompt: 'a harbour at dawn', cfg: 3 });
    expect((await sweep())[0].error).toBe('unknown parameter for \'custom.harbour-stills\': cfg — accepted: positive, negative, seed, steps');
    expect(cards()).toEqual([]);
    // A lawful render reaches its card like any pipeline's (declined here: the engine is not lit).
    await file('good', { type: 'image/generate', pipeline: 'custom.harbour-stills', prompt: 'a harbour at dawn', steps: 30 });
    const run = sweep('ask');
    const request = await nextCard();
    expect(JSON.stringify(request)).toContain('custom.harbour-stills');
    kit.decide(request, 'deny');
    expect((await run)[0].status).toBe('denied');

    // A file that was changed by hand into something the rules refuse is no longer a pipeline.
    const stored = path.join(process.env.NEUMA_DATA_ROOT, 'image-forge', 'workflows', 'custom.harbour-stills.json');
    const record = JSON.parse(await fs.readFile(stored, 'utf8'));
    await fs.writeFile(stored, JSON.stringify({ ...record, proposal: { ...record.proposal, graph: { ...record.proposal.graph, 50: { class_type: 'SaveLatent', inputs: { samples: ['3', 0], filename_prefix: 'x' } } } } }));
    expect((await findPipeline('custom.harbour-stills')).ok).toBe(false);
    await saveWorkflow(proposal(), { by: kit.laneId });

    await file('forget', { type: 'forge/forget-workflow', id: 'custom.harbour-stills' });
    const forgetting = sweep();
    const ask = await nextCard(1);
    expect(JSON.stringify(ask)).toContain('remove the registered image workflow custom.harbour-stills from this computer');
    kit.decide(ask, 'allow');
    expect((await forgetting)[0]).toMatchObject({ status: 'ok', content: expect.stringContaining('Removed custom.harbour-stills') });
    expect(await listWorkflows()).toEqual([]);
    await file('gone', { type: 'image/generate', pipeline: 'custom.harbour-stills', prompt: 'a harbour at dawn' });
    expect((await sweep())[0].error).toContain('no registered workflow \'custom.harbour-stills\' — registered: none yet');
    await file('core', { type: 'forge/forget-workflow', id: 'still.sdxl.txt2img' });
    expect((await sweep())[0].error).toContain('only a registered workflow can be removed');
  }, 120_000);
});

describe('a registered workflow read as a map, and changed in place', () => {
  beforeEach(() => setUp());
  const status = (args) => runForgeEngineTool(kit.connection, 'forge_status', args, resolveComfyConfig(process.env));

  test('before the engine\'s node list has ever been read: the map still reads, a node cannot, and both say why', async () => {
    await saveWorkflow(proposal(), { by: kit.laneId });
    const map = await status({ view: 'workflow', id: 'custom.harbour-stills' });
    expect(map.ok).toBe(true);
    expect(map.content).toContain('the engine\'s node list has not been read yet');
    expect(map.content).toContain('    steps = 25 · KNOB steps (10 to 40)');
    expect((await status({ view: 'node', node: 'KSampler' })).reason).toContain('has not been read on this computer yet');
    expect((await status({ view: 'workflow' })).reason).toContain('needs {id}');
    expect((await status({ view: 'workflow', id: 'custom.nope' })).reason).toContain('no registered workflow');
  }, 60_000);

  test('with the node list kept: every node in full, nodes found by what they make, the map with the engine\'s ranges, a built-in graph to build from', async () => {
    await saveWorkflow(proposal(), { by: kit.laneId });
    // The kept copy, in the form the engine read writes it (engine-nodes.js).
    const kept = path.join(process.env.NEUMA_DATA_ROOT, 'image-forge', 'engine-nodes.json');
    await fs.writeFile(kept, JSON.stringify({ objectInfo: OBJECT_INFO, version: '0.41.0', readAt: '2026-11-20T10:00:00.000Z' }));

    const sampler = await status({ view: 'node', node: 'KSampler' });
    expect(sampler.content).toContain('  cfg — FLOAT, required, 0 to 100, step 0.1, default 8');
    expect(sampler.content).toContain('(as kept on 2026-11-20 from ComfyUI 0.41.0; the engine is not running)');
    expect((await status({ view: 'node', node: 'KSamplr' })).reason).toContain('this engine has no node \'KSamplr\'');
    expect((await status({ view: 'node', node: 'FluxProUltraImageNode' })).reason).toContain('sends work to an outside service');
    const makers = await status({ view: 'nodes', makes: 'IMAGE' });
    expect(makers.content).toContain('3 of the engine\'s 14 nodes');
    expect(makers.content).toContain('ImageScale "Upscale Image" — takes IMAGE; makes IMAGE');

    const map = await status({ view: 'workflow', id: 'custom.harbour-stills' });
    expect(map.content).toContain('    steps = 25 · KNOB steps (10 to 40) · engine allows 1 to 10000, default 20');
    expect(map.content).toContain('    ckpt_name = "sd_xl_base_1.0.safetensors" · fixed · engine allows 2 choices');
    expect(map.content).toContain('    model ← node 4 (CheckpointLoaderSimple) output 0 MODEL: MODEL');

    const builtIn = await status({ view: 'workflow', id: 'still.sdxl.txt2img' });
    expect(builtIn.ok).toBe(true);
    expect(builtIn.content).toContain('This pipeline is BUILT IN: it is not edited.');
    const graph = JSON.parse(builtIn.content.split('\n').at(-1));
    expect(graph['6'].inputs.text).toBe('YOUR PROMPT');
    expect(graph['4'].class_type).toBe('CheckpointLoaderSimple');
  }, 60_000);

  test('an edit shows its changes on the card; one that breaks a rule, or names what is not there, is refused before any card', async () => {
    await saveWorkflow(proposal(), { by: kit.laneId });
    await file('bad', { type: 'forge/edit-workflow', id: 'custom.harbour-stills', edits: [{ op: 'set', node: '99', input: 'x', value: 1 }, { op: 'unknob', name: 'positive' }] });
    expect((await sweep())[0].error).toContain('These edits cannot be applied: edit 1 (set): the graph has no node 99');
    await file('rule', { type: 'forge/edit-workflow', id: 'custom.harbour-stills', edits: [{ op: 'add', node: '50', class_type: 'SaveLatent', inputs: { samples: ['3', 0], filename_prefix: 'x' } }] });
    expect((await sweep())[0].error).toContain('After these edits the workflow breaks its rules: only SaveImage may write');
    await file('law', { type: 'forge/edit-workflow', id: 'custom.harbour-stills', edits: [{ op: 'unknob', name: 'negative' }, { op: 'set', node: '7', input: 'text', value: 'zzcsamterm' }] });
    expect((await sweep())[0]).toMatchObject({ status: 'denied', error: expect.stringContaining('Refused by content law (csam)') });
    await file('core', { type: 'forge/edit-workflow', id: 'still.sdxl.txt2img', edits: [{ op: 'set', node: '3', input: 'cfg', value: 2 }] });
    expect((await sweep())[0].error).toContain('changes a REGISTERED workflow');
    expect(cards()).toEqual([]);

    await file('good', { type: 'forge/edit-workflow', id: 'custom.harbour-stills', edits: [
      { op: 'set', node: '3', input: 'cfg', value: 5.5 },
      { op: 'knob', name: 'cfg', type: 'float', into: { node: '3', input: 'cfg' } },
      { op: 'knob', name: 'checkpoint', type: 'enum', values: ['sd_xl_base_1.0.safetensors', 'Illustrious-XL-v2.0.safetensors'], into: { node: '4', input: 'ckpt_name' } },
    ] });
    const run = sweep();
    const request = await nextCard();
    const words = JSON.stringify(request);
    expect(words).toContain('change the registered image workflow custom.harbour-stills in 3 steps: set node 3 cfg to 5.5; knob cfg on node 3 cfg; knob checkpoint on node 4 ckpt_name (2 choices)');
    kit.decide(request, 'allow');
    const [result] = await run;
    // No engine here to hold it against, so nothing is changed: the kept workflow is still the old one.
    expect(result.error).toMatch(/^Not kept: the image engine could not be read/);
    expect((await findPipeline('custom.harbour-stills')).pipeline.graph['3'].inputs.cfg).toBe(7);
  }, 240_000);
});

describe('a being of a house that does not own this computer', () => {
  beforeEach(() => setUp({ owner: false }));

  test('cannot register or forget a workflow, and is told why before any card', async () => {
    await file('register', { type: 'forge/register-workflow', ...proposal() });
    const [refused] = await sweep();
    expect(refused.status).toBe('denied');
    expect(refused.error).toContain('belongs to the house that owns this computer');
    expect(cards()).toEqual([]);
  }, 60_000);
});

// ————— summoned: the real engine's own node list —————
const installDir = [process.env.COMFYUI_INSTALL_DIR, '/mnt/external/comfyui/app'].filter(Boolean)
  .find((d) => existsSync(path.join(d, 'main.py')) && existsSync(path.join(d, '.venv', 'bin', 'python')));
const realModels = '/mnt/external/comfyui/models';
const live = shouldRunGpuEngineTests() && Boolean(installDir) && existsSync(path.join(realModels, 'checkpoints', CKPT));
if (!live) console.log(gpuSkipNote('forge workflow registration against the real engine'));

describe.runIf(live)('registered against the REAL engine (no model is loaded: only its node list is read)', () => {
  beforeEach(async () => {
    await setUp();
    Object.assign(process.env, { COMFYUI_INSTALL_DIR: installDir, COMFYUI_MODELS_DIR: realModels, COMFYUI_URL: 'http://127.0.0.1:8197' });
  });

  test('the yes holds the workflow against the engine and keeps it; one naming a file the engine lacks keeps nothing', async () => {
    await file('register', { type: 'forge/register-workflow', ...proposal() });
    const run = sweep();
    kit.decide(await nextCard(), 'allow');
    const [kept] = await run;
    expect(kept, JSON.stringify(kept)).toMatchObject({ status: 'ok' });
    expect(kept.content).toContain('Registered custom.harbour-stills');
    expect(kept.content).toContain('Every node, every value and every model file in it is one this engine accepts.');
    // The engine's own node list was kept on the way, so a node can be read in full even after the engine stops.
    const sampler = await runForgeEngineTool(kit.connection, 'forge_status', { view: 'node', node: 'KSampler' }, resolveComfyConfig(process.env));
    expect(sampler.content).toMatch(/steps — INT, required, 1 to \d+, default 20/);
    expect(sampler.content).toContain('read from the running engine');
    expect((await listWorkflows()).map((w) => w.id)).toEqual(['custom.harbour-stills']);

    // Changed in place against the real engine: a knob with no range takes the node's own.
    await file('edit', { type: 'forge/edit-workflow', id: 'custom.harbour-stills', edits: [{ op: 'knob', name: 'cfg', type: 'float', into: { node: '3', input: 'cfg' } }, { op: 'set', node: '3', input: 'cfg', value: 5.5 }] });
    const editing = sweep();
    kit.decide(await nextCard(1), 'allow');
    const [changed] = await editing;
    expect(changed, JSON.stringify(changed)).toMatchObject({ status: 'ok' });
    expect(changed.content).toContain('What changed: knob cfg added');
    const after = (await findPipeline('custom.harbour-stills')).pipeline;
    expect(after.graph['3'].inputs.cfg).toBe(5.5);
    expect(after.slots.cfg).toMatchObject({ type: 'float', min: 0, max: 100, default: 5.5 });

    const missing = proposal({ id: 'custom.missing-file' });
    missing.graph['4'].inputs.ckpt_name = 'no-such-model.safetensors';
    await file('missing', { type: 'forge/register-workflow', ...missing });
    const second = sweep();
    kit.decide(await nextCard(2), 'allow');
    const [refused] = await second;
    expect(refused.status).toBe('error');
    expect(refused.error).toContain('the engine does not have the model file \'no-such-model.safetensors\'');
    expect((await listWorkflows()).map((w) => w.id)).toEqual(['custom.harbour-stills']);
  }, 300_000);
});
