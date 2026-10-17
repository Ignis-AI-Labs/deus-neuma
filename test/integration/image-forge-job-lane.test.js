/**
 * P2 THE WIRE proven against the REAL pinned engine (RULE 0 — no mocks,
 * skip-if-absent). The full path: supervisor launches the engine, the wire
 * client + job lane run a real SDXL txt2img to a real PNG on disk, the drift
 * validator checks the AUTHORED template against the live /object_info, a bad
 * graph is refused with the engine's taxonomy, and a barge-in cancel lands a
 * running job as interrupted.
 *
 * Isolation: own port (8196), own COMFYUI_DATA_DIR (temp). The sibling stack
 * and any operator workbench are never touched.
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { shouldRunGpuEngineTests, gpuSkipNote } from '../helpers/gpu-optin.js';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'fs';
import os from 'os';
import path from 'path';
import {
  resolveComfyConfig, ensureComfyReady, stopComfy, comfyShutdown,
} from '../../backend/services/image-forge/comfyui-supervisor.js';
import { getQueue, uploadImage } from '../../backend/services/image-forge/comfyui-client.js';
import { runJob, cancel, _resetLane } from '../../backend/services/image-forge/job-lane.js';
import { buildTxt2Img, buildImg2Img, validateGraphAgainstObjectInfo, packClassesPresent } from '../../backend/services/image-forge/templates.js';

const PORT = 8196;
const CKPT = 'sd_xl_base_1.0.safetensors';

const installDir = [process.env.COMFYUI_INSTALL_DIR, '/mnt/external/comfyui/app']
  .filter(Boolean)
  .find((d) => existsSync(path.join(d, 'main.py')) && existsSync(path.join(d, '.venv', 'bin', 'python')));
const modelsDir = [process.env.COMFYUI_MODELS_DIR, '/mnt/external/comfyui/models']
  .filter(Boolean).find((d) => existsSync(path.join(d, 'checkpoints', CKPT)));

const dataDir = mkdtempSync(path.join(os.tmpdir(), 'wire-it-'));
const present = Boolean(installDir && modelsDir);
const cfg = present ? resolveComfyConfig({
  COMFYUI_URL: `http://127.0.0.1:${PORT}`,
  COMFYUI_INSTALL_DIR: installDir,
  COMFYUI_MODELS_DIR: modelsDir,
  COMFYUI_DATA_DIR: dataDir,
}) : resolveComfyConfig({ COMFYUI_DATA_DIR: dataDir });

const objectInfo = async () => (await fetch(`http://127.0.0.1:${PORT}/object_info`)).json();
const txt2img = (prefix, over = {}) => buildTxt2Img({
  positive: 'a monochrome geometric emblem, thin cyan lines on pure black, minimal',
  negative: 'blurry, watermark', ckptName: CKPT,
  width: 768, height: 768, seed: 12345, steps: 12, cfg: 7,
  samplerName: 'euler', scheduler: 'normal', filenamePrefix: prefix, ...over,
});

beforeAll(async () => {
  if (present) await ensureComfyReady(cfg, { waitMs: 160_000 });
}, 200_000);

afterAll(async () => {
  _resetLane();
  await comfyShutdown().catch(() => {});
  await stopComfy().catch(() => {});
  rmSync(dataDir, { recursive: true, force: true });
}, 30_000);

if (present && !shouldRunGpuEngineTests()) console.warn(gpuSkipNote('image-forge job lane'));
describe.skipIf(!present || !shouldRunGpuEngineTests())('P2 THE WIRE against the real pinned engine', () => {
  test('the authored template passes the live /object_info drift gate', async () => {
    const info = await objectInfo();
    expect(packClassesPresent(info).ok).toBe(true);
    expect(validateGraphAgainstObjectInfo(txt2img('drift/check'), info)).toEqual({ ok: true, violations: [] });
  }, 30_000);

  test('a real txt2img runs enqueue → collected, progress observed, PNG on disk', async () => {
    const progress = [];
    const outcome = await runJob(cfg, {
      graph: txt2img('wire/still'),
      onProgress: (p) => progress.push(p),
    });
    expect(outcome.status).toBe('ok');
    expect(outcome.outputs.length).toBeGreaterThan(0);
    expect(progress.length).toBeGreaterThan(0); // the watchdog saw real progress
    const img = outcome.outputs[0];
    const onDisk = path.join(dataDir, 'output', img.subfolder || '', img.filename);
    expect(existsSync(onDisk)).toBe(true);
    expect(statSync(onDisk).size).toBeGreaterThan(1000);
  }, 180_000);

  test('a graph naming a non-existent checkpoint fails fast and named — never a false ok', async () => {
    const outcome = await runJob(cfg, {
      graph: txt2img('wire/bad', { ckptName: 'no-such-model-xyz.safetensors' }),
      firstProgressMs: 8000,
    });
    expect(outcome.status).toBe('error');
    expect(outcome.detail).toBeTruthy();
  }, 60_000);

  test('barge-in: a running job aborted mid-flight lands as interrupted, and the queue clears', async () => {
    const ac = new AbortController();
    // A heavy ~7s render (measured) so the 2.5s-then-abort lands mid-flight
    // with a comfortable margin even on faster hardware (echo r3 RQ).
    const p = runJob(cfg, { graph: txt2img('wire/cancel', { steps: 80, width: 1024, height: 1024 }), signal: ac.signal });
    await new Promise((r) => setTimeout(r, 2500)); // let it start
    ac.abort();
    const outcome = await p;
    expect(outcome.status).toBe('interrupted');
    // Queue drains — cancelled jobs do not leak into the FIFO.
    await new Promise((r) => setTimeout(r, 1500));
    const q = await getQueue(cfg);
    expect(q.running + q.pending).toBe(0);
  }, 120_000);

  test('cancel is idempotent on an already-terminal job — no throw, honest result', async () => {
    const outcome = await runJob(cfg, { graph: txt2img('wire/done2') });
    expect(outcome.status).toBe('ok');
    const c = await cancel(cfg, outcome.promptId); // already finished
    expect(c.cancelled === true || c.cancelled === false).toBe(true); // never throws
  }, 180_000);

  test('the POLLING fallback path drives a real render to completion (noSocket)', async () => {
    // Force the no-WS completion path against the LIVE engine — the doctrine's
    // second lane.
    const outcome = await runJob(cfg, { graph: txt2img('wire/poll'), noSocket: true });
    expect(outcome.status).toBe('ok');
    expect(outcome.outputs.length).toBeGreaterThan(0);
    const img = outcome.outputs[0];
    expect(existsSync(path.join(dataDir, 'output', img.subfolder || '', img.filename))).toBe(true);
  }, 180_000);

  test('polling does NOT false-stall a render longer than firstProgressMs (watchdog re-arm regression)', async () => {
    // Deterministically force the r1 bug condition: the render (a heavy ~7s
    // 80-step 1024² job, measured) must OUTLIVE firstProgressMs (3s), which
    // itself exceeds the 1s poll interval so the first active poll can re-arm.
    // Before markStarted re-armed on the poll path, the watchdog fired at
    // firstProgressMs and this settled 'error: render stalled' mid-render; now
    // the first in_progress poll re-arms it and the render completes.
    const outcome = await runJob(cfg, {
      graph: txt2img('wire/poll-long', { steps: 80, width: 1024, height: 1024 }),
      noSocket: true,
      firstProgressMs: 3000,
    });
    expect(outcome.status).toBe('ok');
    expect(outcome.outputs.length).toBeGreaterThan(0);
  }, 300_000);

  test('a PRE-aborted signal settles interrupted without enqueueing — both paths agree', async () => {
    const wsAc = new AbortController(); wsAc.abort();
    expect((await runJob(cfg, { graph: txt2img('wire/preabort-ws'), signal: wsAc.signal })).status).toBe('interrupted');
    const pollAc = new AbortController(); pollAc.abort();
    expect((await runJob(cfg, { graph: txt2img('wire/preabort-poll'), signal: pollAc.signal, noSocket: true })).status).toBe('interrupted');
    // Nothing was enqueued — the queue is clean.
    await new Promise((r) => setTimeout(r, 500));
    const q = await getQueue(cfg);
    expect(q.running + q.pending).toBe(0);
  }, 30_000);

  test('img2img round-trip: upload a real PNG, encode it, render — proving uploadImage + buildImg2Img', async () => {
    // First make a real still to feed back in (a genuine PNG, not a fixture).
    const seed = await runJob(cfg, { graph: txt2img('wire/seed') });
    expect(seed.status).toBe('ok');
    const seedPng = path.join(dataDir, 'output', seed.outputs[0].subfolder || '', seed.outputs[0].filename);
    const bytes = readFileSync(seedPng);

    const uploaded = await uploadImage(cfg, { bytes, filename: 'seed.png', mime: 'image/png' });
    expect(uploaded.name).toBeTruthy(); // the engine's authoritative name

    const outcome = await runJob(cfg, {
      graph: buildImg2Img({
        positive: 'the same emblem, refined', negative: 'blurry', ckptName: CKPT,
        seed: 999, steps: 10, cfg: 7, samplerName: 'euler', scheduler: 'normal',
        filenamePrefix: 'wire/img2img', imageName: uploaded.name, denoise: 0.55,
      }),
    });
    expect(outcome.status).toBe('ok');
    expect(outcome.outputs.length).toBeGreaterThan(0);
  }, 240_000);
});

describe('P2 THE WIRE without an engine (fail-closed)', () => {
  test('runJob against a dead port resolves an honest error, never hangs', async () => {
    _resetLane();
    const dead = resolveComfyConfig({ COMFYUI_URL: 'http://127.0.0.1:8197', COMFYUI_DATA_DIR: dataDir });
    const outcome = await runJob(dead, { graph: txt2img('none'), firstProgressMs: 3000 });
    expect(outcome.status).toBe('error');
  }, 30_000);
});
