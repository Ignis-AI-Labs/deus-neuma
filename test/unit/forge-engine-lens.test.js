// The image engine read whole and steered: the loaded models named from the
// engine's own log (the lines below are ComfyUI 0.41's, copied from the rig on
// 2026-11-20), its queue and memory, the words a being reads, the model files
// on disk, and the tool against an engine that is not running. The acts that
// need a live engine are proven in forge-engine-control.test.js (summoned). RULE 0.
/* global process, Buffer */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  HOLDING_MB, parseEngineLoads, parseEngineMemory, parseEngineQueue, shapeEngineLens,
} from '../../backend/services/image-forge/engine-lens.js';
import {
  FORGE_ENGINE_TOOLS, isForgeEngineToolName, listModelFiles, parseExtraModelPaths, runForgeEngineTool, shapeModelFiles,
} from '../../backend/services/image-forge/forge-engine-tools.js';
import { IMAGE_TOOLS, imageToolsFor, isImageTool } from '../../backend/services/image-forge/image-being-tools.js';
import { resolveComfyConfig } from '../../backend/services/image-forge/comfyui-supervisor.js';
import { GLOBAL_DEFAULTS, OBSERVATION_TOOLS, READ_TOOLS } from '../../backend/services/tool-policy.js';
import { makeInstallOwner } from '../helpers/install-owner-kit.js';

const I = '\u001b[32m[INFO]\u001b[0m ';
const LOG = [
  ['15:31:47', `${I}got prompt\n`],
  ['15:31:47', `${I}Model storage policy: fast_disk=False paths=['/opt/ComfyUI/models/vae/flux2-vae.safetensors']\n`],
  ['15:31:48', `${I}VAE load device: cuda:0, offload device: cpu, dtype: torch.bfloat16\n`],
  ['15:31:48', `${I}Model storage policy: fast_disk=False paths=['/opt/ComfyUI/models/text_encoders/qwen_3_4b.safetensors']\n`],
  ['15:31:48', `${I}Requested to load Flux2TEModel_\n`],
  ['15:31:48', `${I}Model Flux2TEModel_ prepared for dynamic VRAM loading. 7671MB Staged. 0 patches attached. Force pre-loaded 145 weights: 383 KB.\n`],
  ['15:31:51', `${I}Model storage policy: fast_disk=False paths=['/mnt/external/comfyui/models/diffusion_models/flux-2-klein-4b.safetensors']\n`],
  ['15:31:51', `${I}Requested to load Flux2\n`],
  ['15:31:51', `${I}Model Flux2 prepared for dynamic VRAM loading. 7392MB Staged. 0 patches attached. Force pre-loaded 60 weights: 54 KB.\n`],
  ['15:31:53', '\r100%|██████████| 4/4 [00:00<00:00,  9.04it/s]'],
  ['15:31:53', `${I}Requested to load AutoencoderKL\n`],
  ['15:31:53', `${I}0 models unloaded.\n`],
  ['15:31:53', `${I}Model AutoencoderKL prepared for dynamic VRAM loading. 160MB Staged. 0 patches attached. Force pre-loaded 110 weights: 187 KB.\n`],
  ['15:31:54', `${I}\u001b[32mPrompt executed in 6.15 seconds\u001b[0m\n`],
].map(([t, m]) => ({ t: `2026-11-20T${t}.000000`, m }));

const lens = (over = {}) => ({
  readAt: '2026-11-20T15:35:00.000Z', installed: true, state: 'ready', serving: true, owned: true, adopted: false, foreign: false,
  port: 8190, pid: 3156749, lastError: null, ceilings: { cardKeptFreeGB: 2, ramGB: 48 },
  capacity: { image: { ok: true, why: 'up to 26.7 GB of GPU memory, 2 GB always kept free' }, video: { ok: false, why: 'needs 40 GB of free system memory for the engine, 12 GB can be spared' } },
  memory: { version: '0.41.0', modelsOnCardMB: 15223, cardFreeMB: 2400, cardTotalMB: 97887, cardMB: 15900, ramMB: 9300, holding: true },
  loads: parseEngineLoads(LOG), queue: { running: ['job-a'], waiting: ['job-b', 'job-c'] },
  jobs: [{ jobId: 'job-a', phase: 'rendering', percent: 40, pipelineId: 'still.flux2.klein', beingName: 'Firepos', updatedAt: Date.parse('2026-11-20T15:34:00Z') }],
  idle: { since: '2026-11-20T15:31:54.000Z', unloadsAt: '2026-11-20T15:41:54.000Z', stopsAt: '2026-11-20T16:01:54.000Z', lastUnloadAt: null },
  ...over,
});
const NOW = Date.parse('2026-11-20T15:35:00Z');

describe('what the engine has loaded, from its own log', () => {
  it('names each model with its kind, its size and the file it was read from', () => {
    const loads = parseEngineLoads(LOG);
    expect(loads.models).toEqual([
      { name: 'Flux2TEModel_', role: 'text encoder', stagedMB: 7671, file: 'qwen_3_4b.safetensors', at: '2026-11-20T15:31:48.000000' },
      { name: 'Flux2', role: 'model', stagedMB: 7392, file: 'flux-2-klein-4b.safetensors', at: '2026-11-20T15:31:51.000000' },
      { name: 'AutoencoderKL', role: 'image decoder', stagedMB: 160, file: 'flux2-vae.safetensors', at: '2026-11-20T15:31:53.000000' },
    ]);
    expect(loads.lastJobAt).toBe('2026-11-20T15:31:54.000000');
  });

  it('a model staged again replaces its earlier line; an older engine\'s "loaded completely" line is read too', () => {
    const again = parseEngineLoads([...LOG, { t: '2026-11-20T16:00:00', m: `${I}Model Flux2 prepared for dynamic VRAM loading. 7400MB Staged.\n` }]);
    expect(again.models.map((m) => m.name)).toEqual(['Flux2TEModel_', 'AutoencoderKL', 'Flux2']);
    expect(again.models[2]).toMatchObject({ stagedMB: 7400, at: '2026-11-20T16:00:00' });
    const classic = parseEngineLoads([{ t: 'a', m: 'Requested to load SDXL\n' }, { t: 'b', m: 'loaded completely 9.5367431640625e+25 4897.05 True\n' }]);
    expect(classic.models).toEqual([{ name: 'SDXL', role: 'model', stagedMB: 4897, file: null, at: 'b' }]);
    expect(parseEngineLoads([])).toEqual({ models: [], lastJobAt: null, lines: 0 });
    expect(parseEngineLoads(null).models).toEqual([]);
  });

  it('the queue by job id, and the memory the models hold', () => {
    expect(parseEngineQueue({ queue_running: [[3, 'job-a', {}, {}, []]], queue_pending: [[4, 'job-b', {}], [5, 'job-c', {}]] })).toEqual({ running: ['job-a'], waiting: ['job-b', 'job-c'] });
    expect(parseEngineQueue(null)).toEqual({ running: [], waiting: [] });
    expect(parseEngineMemory({ system: { comfyui_version: '0.41.0' }, devices: [{ name: 'cuda:0 RTX', type: 'cuda', vram_total: 102033391616, vram_free: 17171283968, torch_vram_total: 67108864 }] }))
      .toEqual({ version: '0.41.0', device: 'cuda:0 RTX', modelsOnCardMB: 64, cardFreeMB: 16376, cardTotalMB: 97307 });
    expect(parseEngineMemory({}).modelsOnCardMB).toBeNull();
    expect(HOLDING_MB).toBe(512);
  });
});

describe('the engine as a being reads it', () => {
  it('up and holding: memory measured, models named, queue, idle clock, what can be made, and the controls', () => {
    const text = shapeEngineLens(lens(), { now: NOW });
    expect(text).toContain('IMAGE ENGINE — ready (started by this platform) on port 8190, pid 3156749, ComfyUI 0.41.0.');
    expect(text).toContain('ON THE CARD — its models hold 14.9 GB; the whole engine process holds 15.5 GB. The card has 2.3 GB free of 95.6 GB.');
    expect(text).toContain('IN MEMORY — 9.1 GB of system memory (it is stopped if it passes 48 GB).');
    expect(text).toContain('LOADED — on the card now.');
    expect(text).toContain('- Flux2 (model) — 7,392 MB — flux-2-klein-4b.safetensors — at 15:31');
    expect(text).toContain('QUEUE — 1 rendering, 2 waiting.');
    expect(text).toContain('WHEN IDLE — unloads its models by itself in 7 min; stops by itself in 27 min.');
    expect(text).toContain('- job-a · rendering 40% · still.flux2.klein · Firepos');
    expect(text).toContain('stills: yes (up to 26.7 GB');
    expect(text).toContain('video: no (needs 40 GB');
    expect(text).toContain('forge_control {act}: "unload"');
  });

  it('up with nothing on the card: the same models are said to be the LAST loaded, not loaded', () => {
    const text = shapeEngineLens(lens({ memory: { ...lens().memory, modelsOnCardMB: 64, holding: false } }), { now: NOW });
    expect(text).toContain('LOADED — nothing is on the card now. These were the last loaded');
    expect(text).not.toContain('unloads its models by itself');
    const fresh = shapeEngineLens(lens({ loads: { models: [], lastJobAt: null, lines: 3 }, memory: { ...lens().memory, modelsOnCardMB: 0, holding: false } }), { now: NOW });
    expect(fresh).toContain('LOADED — nothing: no model has been loaded');
    expect(shapeEngineLens(lens({ loads: null }), { now: NOW })).toContain('its models cannot be named');
  });

  it('stopped, starting, failed, not installed — each said as it is', () => {
    const down = { installed: true, state: 'stopped', serving: false, lastError: null, ceilings: {}, capacity: null };
    expect(shapeEngineLens(down)).toContain('IMAGE ENGINE — stopped. It holds nothing on the card or in memory.');
    expect(shapeEngineLens({ ...down, state: 'launching' })).toContain('IMAGE ENGINE — starting.');
    expect(shapeEngineLens({ ...down, lastError: 'the launch line was refused' })).toContain('Its last start failed: the launch line was refused');
    expect(shapeEngineLens({ installed: false })).toContain('not installed on this computer');
  });

  it('a house that does not own this computer sees the state and the counts, not the jobs or the controls', () => {
    const text = shapeEngineLens(lens(), { full: false, now: NOW });
    expect(text).toContain('QUEUE — 1 rendering, 2 waiting.');
    expect(text).not.toContain('job-a');
    expect(text).toContain('JOBS — 1 in progress.');
    expect(text).toContain('belong to the house that owns this computer');
  });
});

describe('the model files on disk', () => {
  it('reads the operator\'s extra folders file as ComfyUI writes it', () => {
    const yaml = '# a note\noperator_tree:\n  base_path: /models/\n  checkpoints: checkpoints\n  # comment: here\n  unet: diffusion_models   # shared\n  is_default: true\nother:\n  vae: orphan\n';
    expect(parseExtraModelPaths(yaml)).toEqual([{ folder: 'checkpoints', dir: '/models/checkpoints' }, { folder: 'unet', dir: '/models/diffusion_models' }]);
    expect(parseExtraModelPaths('')).toEqual([]);
  });

  it('lists every model file by folder with its size, extra folders included, each file once', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-models-'));
    try {
      const own = path.join(root, 'models'); const extra = path.join(root, 'operator');
      await fs.mkdir(path.join(own, 'checkpoints', 'sub'), { recursive: true });
      await fs.mkdir(path.join(own, 'empty'), { recursive: true });
      await fs.mkdir(path.join(extra, 'diffusion_models'), { recursive: true });
      await fs.writeFile(path.join(own, 'checkpoints', 'big.safetensors'), Buffer.alloc(3 * 1048576));
      await fs.writeFile(path.join(own, 'checkpoints', 'sub', 'small.gguf'), Buffer.alloc(1048576));
      await fs.writeFile(path.join(own, 'checkpoints', 'readme.txt'), 'not a model');
      await fs.writeFile(path.join(extra, 'diffusion_models', 'flux.safetensors'), Buffer.alloc(2 * 1048576));
      const yaml = path.join(root, 'extra.yaml');
      await fs.writeFile(yaml, `tree:\n  base_path: ${extra}\n  diffusion_models: diffusion_models\n  unet: diffusion_models\n`);
      const folders = await listModelFiles({ modelsDir: own, extraModelPaths: yaml });
      expect(folders.map((f) => [f.folder, f.files.map((x) => `${x.name}:${x.mb}`)])).toEqual([
        ['checkpoints', ['big.safetensors:3', 'sub/small.gguf:1']],
        ['diffusion_models', ['flux.safetensors:2']],
      ]);
      const text = shapeModelFiles(folders);
      expect(text).toContain('MODEL FILES the engine can load — 3 files, 0.0 GB on disk:');
      expect(text).toContain('checkpoints (2):');
      expect(shapeModelFiles([])).toContain('No model files were found');
      expect(await listModelFiles({})).toEqual([]);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

describe('the tools', () => {
  const OWNER = '0x1111111111111111111111111111111111111111';
  const GUEST = '0x2222222222222222222222222222222222222222';
  let root; let prior; let cfg;

  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-tools-'));
    prior = process.env.NEUMA_DATA_ROOT;
    process.env.NEUMA_DATA_ROOT = root;
    await makeInstallOwner(OWNER);
    // An install that is present, on a port nothing listens on: an engine that is honestly not running.
    const install = path.join(root, 'engine');
    await fs.mkdir(path.join(install, '.venv', 'bin'), { recursive: true });
    await fs.writeFile(path.join(install, 'main.py'), '');
    await fs.writeFile(path.join(install, '.venv', 'bin', 'python'), '');
    cfg = resolveComfyConfig({ COMFYUI_URL: 'http://127.0.0.1:8197', COMFYUI_INSTALL_DIR: install, COMFYUI_DATA_DIR: path.join(root, 'comfy'), COMFYUI_MODELS_DIR: path.join(root, 'none') });
  });
  afterAll(async () => {
    if (prior === undefined) delete process.env.NEUMA_DATA_ROOT; else process.env.NEUMA_DATA_ROOT = prior;
    await fs.rm(root, { recursive: true, force: true });
  });

  it('are two: a read that observe mode keeps, and the acts it holds', () => {
    expect(FORGE_ENGINE_TOOLS.map((t) => t.name)).toEqual(['forge_status', 'forge_control']);
    expect(isForgeEngineToolName('forge_status')).toBe(true);
    expect(isForgeEngineToolName('list_pipelines')).toBe(false);
    expect(isImageTool({ tool: 'image/forge_control' })).toBe(true);
    expect(isImageTool({ toolName: 'forge_status' })).toBe(true);
    expect(GLOBAL_DEFAULTS.image.allowed).toEqual(expect.arrayContaining(['forge_status', 'forge_control']));
    expect(READ_TOOLS.has('forge_status')).toBe(true);
    expect(OBSERVATION_TOOLS.has('forge_status')).toBe(true);
    expect(READ_TOOLS.has('forge_control')).toBe(false);
    expect(READ_TOOLS.has('machine_map')).toBe(true);
    expect(IMAGE_TOOLS.map((t) => t.name)).not.toContain('forge_status'); // the content law does not gate them
  });

  it('are offered wherever the engine is installed, with or without a content law, and never without a lane', async () => {
    const env = { COMFYUI_INSTALL_DIR: cfg.installDir, COMFYUI_CONTENT_LAW_PATH: path.join(root, 'no-law.json') };
    const names = (await imageToolsFor({ companion: { neumaId: 'lane' } }, env)).map((t) => t.name);
    expect(names).toEqual(['forge_status', 'forge_control']);
    expect(await imageToolsFor({ companion: {} }, env)).toEqual([]);
    expect(await imageToolsFor({ companion: { neumaId: 'lane' } }, { COMFYUI_INSTALL_DIR: path.join(root, 'absent') })).toEqual([]);
  });

  it('read an engine that is not running as exactly that', async () => {
    const read = await runForgeEngineTool({ walletAddress: OWNER }, 'forge_status', {}, cfg);
    expect(read.ok).toBe(true);
    expect(read.content).toContain('IMAGE ENGINE — stopped. It holds nothing on the card or in memory.');
    expect(read.content).toContain('forge_control {act: "start"}');
    expect((await runForgeEngineTool({ walletAddress: OWNER }, 'forge_status', { view: 'models' }, cfg)).content).toContain('No model files were found');
    expect(await runForgeEngineTool({ walletAddress: OWNER }, 'forge_status', { view: 'nodes' }, cfg)).toMatchObject({ ok: false });
  }, 30000);

  it('refuse to act on an engine that is not running, in words, and name the acts when one is misspelt', async () => {
    for (const act of ['unload', 'stop', 'cancel', 'clear']) {
      const done = await runForgeEngineTool({ walletAddress: OWNER }, 'forge_control', { act, job: 'x' }, cfg);
      expect(done.ok).toBe(false);
      expect(done.reason).toContain(`The engine is not running, so there is nothing to ${act}.`);
    }
    expect((await runForgeEngineTool({ walletAddress: OWNER }, 'forge_control', { act: 'free' }, cfg)).reason).toBe('act must be one of start, unload, stop, cancel, clear');
  }, 30000);

  it('steer only for the house that owns this computer; another house still reads', async () => {
    const guest = { walletAddress: GUEST };
    const refused = await runForgeEngineTool(guest, 'forge_control', { act: 'stop' }, cfg);
    expect(refused.ok).toBe(false);
    expect(refused.reason).toContain('belong to the house that owns this computer');
    const read = await runForgeEngineTool(guest, 'forge_status', {}, cfg);
    expect(read.ok).toBe(true);
    expect(read.content).toContain('IMAGE ENGINE — stopped.');
    expect(read.content).not.toContain('forge_control {act}: "unload"');
  }, 30000);
});
