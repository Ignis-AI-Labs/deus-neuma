/**
 * A NEUMA INSTALLS A MODEL ITSELF (intents/forge-install.js, image-forge/model-install.js) — Design note, 2026-11-20: […] Real approval transport, the real
 * sweep, the LIVE Hugging Face API and file (a 454 KB test model of Hugging Face's own test organisation), a real
 * engine models folder on disk: the card first, then the file checked against its publisher's SHA-256 and recorded
 * where no being writes. A gated repo without access is told why; the same file twice is one install.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import workspace from '../../core/workspace/neuma-workspace.js';
import { createHarnessTurnKit, untilHarness } from '../helpers/harness-turn-kit.js';
import { sweepIntents } from '../../backend/services/intents/intent-sweep.js';
import { webSettings } from '../../backend/services/web-settings.js';
import { installModel, parseInstall, hfFileInfo, installsWaiting } from '../../backend/services/image-forge/model-install.js';

const TINY = { repo: 'hf-internal-testing/tiny-random-gpt2', file: 'model.safetensors', folder: 'checkpoints' };
const TINY_SHA = '8111d5afb0715dbf5a31396d31432cb56370ba23f6650a035ea0fc8a20b4e500';
const KEYS = ['NEUMA_WEB_ACCESS_PATH', 'NEUMA_WEB_ACCESS', 'COMFYUI_MODELS_DIR', 'NEUMA_DATA_ROOT', 'HF_TOKEN', 'HUGGING_FACE_HUB_TOKEN'];

let kit; let saved; let models; let data; let intents;
beforeEach(async () => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  kit = await createHarnessTurnKit();
  process.env.NEUMA_WEB_ACCESS_PATH = path.join(kit.root, 'web-access.json');
  delete process.env.NEUMA_WEB_ACCESS; delete process.env.HF_TOKEN; delete process.env.HUGGING_FACE_HUB_TOKEN;
  await webSettings.setEnabled(true);
  // Not /tmp (memory on this machine): a models folder and a data root of its own.
  models = await fs.mkdtemp('/var/tmp/forge-install-models-');
  data = await fs.mkdtemp('/var/tmp/forge-install-data-');
  process.env.COMFYUI_MODELS_DIR = models;
  process.env.NEUMA_DATA_ROOT = data;
  intents = path.join(workspace.pathFor(kit.laneId), 'intents');
  await fs.mkdir(intents, { recursive: true });
});
afterEach(async () => {
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  await kit?.close();
  await fs.rm(models, { recursive: true, force: true });
  await fs.rm(data, { recursive: true, force: true });
});
const fileIntent = (payload) => fs.writeFile(path.join(intents, 'install.json'), JSON.stringify({ type: 'forge/install-model', ...payload }));
const sweep = () => sweepIntents(kit.connection, { mode: 'auto', lanePolicy: null, emit: kit.emit });
const card = () => untilHarness(() => kit.frames.find((f) => f.type === 'tool:approval_request'));

describe('a neuma installs a model into the engine', () => {
  test('the card comes first, even in AUTO; on yes the file lands in the engine folder, checked against the published SHA-256, and is recorded', async () => {
    await fileIntent(TINY);
    const run = sweep();
    const request = await card();
    expect(JSON.stringify(request)).toContain('install model.safetensors from huggingface.co/hf-internal-testing/tiny-random-gpt2 into the image engine\'s checkpoints folder');
    await expect(fs.readdir(path.join(models, 'checkpoints'))).rejects.toMatchObject({ code: 'ENOENT' }); // nothing before the yes
    kit.decide(request, 'allow');
    const [result] = await run;
    expect(result, JSON.stringify(result)).toMatchObject({ tool: 'intents/forge.install', status: 'ok' });
    expect(result.content).toContain(`sha256 ${TINY_SHA}, matching what hf-internal-testing/tiny-random-gpt2 published`);
    const landed = await fs.readFile(path.join(models, 'checkpoints', 'model.safetensors'));
    expect(createHash('sha256').update(landed).digest('hex')).toBe(TINY_SHA);
    expect((await fs.readdir(path.join(models, 'checkpoints'))).filter((n) => n.includes('.part-'))).toEqual([]);
    const [row] = (await fs.readFile(path.join(data, 'image-forge', 'installs.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
    expect(row).toMatchObject({ repo: TINY.repo, file: 'model.safetensors', folder: 'checkpoints', sha256: TINY_SHA, bytes: 453864, by: kit.laneId });
  }, 120_000);

  test('the same file again is already there; a different file under its name is left alone; a pickle is refused before any card', async () => {
    const want = parseInstall(TINY).value;
    const first = await installModel(want, { modelsDir: models, by: 'test', token: null });
    expect(first).toMatchObject({ ok: true, already: false, sha256: TINY_SHA });
    expect(await installModel(want, { modelsDir: models, by: 'test', token: null })).toMatchObject({ ok: true, already: true });
    await fs.writeFile(path.join(models, 'checkpoints', 'model.safetensors'), 'not the published file');
    expect((await installModel(want, { modelsDir: models, by: 'test', token: null })).reason).toMatch(/already in the engine and is a different file/);
    await fileIntent({ repo: 'a/b', file: 'model.ckpt', folder: 'checkpoints' });
    const [refused] = await sweep();
    expect(refused).toMatchObject({ tool: 'intents/forge.install', status: 'error', error: expect.stringMatching(/pickle, and loading one runs code/) });
    expect(kit.frames.some((f) => f.type === 'tool:approval_request')).toBe(false);
  }, 120_000);

  test('a gated repo this house may not read says how to open it; FLUX 3 names the installs it still waits for', async () => {
    const gated = await hfFileInfo(parseInstall({ repo: 'black-forest-labs/flux-3-image-klein-comfy', file: 'diffusion_models/flux3-image-klein-int8-convrot.safetensors' }).value, { token: null });
    expect(gated.reason).toMatch(/is gated: .*accept it on huggingface\.co with the account whose token is saved in Settings › API \(no Hugging Face token is saved\)/);
    const { resolvePipeline, resolveModel } = await import('../../backend/services/image-forge/pack-registry.js');
    const waiting = await installsWaiting(resolveModel(resolvePipeline('still.flux3.txt2img').pipeline).model, { modelsDir: models });
    expect(waiting.missing.map((f) => f.name)).toEqual(['flux3-image-klein-int8-convrot.safetensors', 'qwen3vl_4b_int8_convrot.safetensors', 'flux2-vae.safetensors']);
    expect(waiting.words).toMatch(/^NOT INSTALLED YET — the engine lacks 3 files; file each install \(your operator approves it\): diffusion_models\/flux3-image-klein-int8-convrot\.safetensors — forge\/install-model \{"repo":"black-forest-labs\/flux-3-image-klein-comfy"/);
  }, 60_000);
});
