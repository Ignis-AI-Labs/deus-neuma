/**
 * THE ENGINE STEERED, against the REAL pinned engine (RULE 0 — no mocks,
 * skip-if-absent, never faked): forge_status and forge_control through the real
 * supervisor on an engine this suite launches itself — start, the lens read off
 * the live engine, unload, cancel and clear with nothing queued, and stop.
 *
 * SUMMONED ONLY (test/helpers/gpu-optin.js): it lights a real engine on the
 * card. No model is loaded — nothing here renders — so the engine idles at
 * under a gigabyte; the unload of a LOADED model is proven by hand on the desk.
 *
 * Isolation: own port (8196), own COMFYUI_DATA_DIR (temp), own install-owner
 * record — never the live lane's engine, never the operator's workbench.
 */
/* global process, console */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';
import { shouldRunGpuEngineTests, gpuSkipNote } from '../helpers/gpu-optin.js';
import { makeInstallOwner } from '../helpers/install-owner-kit.js';
import { resolveComfyConfig, comfyShutdown, isComfyServing } from '../../backend/services/image-forge/comfyui-supervisor.js';
import { runForgeEngineTool } from '../../backend/services/image-forge/forge-engine-tools.js';
import { readEngineLens } from '../../backend/services/image-forge/engine-lens.js';

const OWNER = '0x3333333333333333333333333333333333333333';
const installDir = [process.env.COMFYUI_INSTALL_DIR, '/mnt/external/comfyui/app']
  .filter(Boolean)
  .find((d) => existsSync(path.join(d, 'main.py')) && existsSync(path.join(d, '.venv', 'bin', 'python')));
const run = shouldRunGpuEngineTests() && Boolean(installDir);
if (!run) console.log(gpuSkipNote('forge engine control'));

describe.runIf(run)('the image engine steered through forge_control (real engine)', () => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'forge-control-it-'));
  const prior = process.env.NEUMA_DATA_ROOT;
  const cfg = resolveComfyConfig({ COMFYUI_URL: 'http://127.0.0.1:8196', COMFYUI_INSTALL_DIR: installDir || '', COMFYUI_DATA_DIR: dataDir });
  const owner = { walletAddress: OWNER };
  const control = (args) => runForgeEngineTool(owner, 'forge_control', args, cfg);

  beforeAll(async () => {
    process.env.NEUMA_DATA_ROOT = dataDir;
    await makeInstallOwner(OWNER);
  });
  afterAll(async () => {
    await comfyShutdown();
    if (prior === undefined) delete process.env.NEUMA_DATA_ROOT; else process.env.NEUMA_DATA_ROOT = prior;
    rmSync(dataDir, { recursive: true, force: true });
  });

  test('start brings it up, and the lens reads the live engine', async () => {
    const started = await control({ act: 'start' });
    expect(started.ok).toBe(true);
    expect(started.content).toContain('IMAGE ENGINE — ready (started by this platform) on port 8196');
    expect(await isComfyServing(cfg)).toBe(true);
    const lens = await readEngineLens(cfg);
    expect(lens).toMatchObject({ serving: true, owned: true, state: 'ready' });
    expect(lens.memory.version).toMatch(/^\d+\.\d+/);
    expect(Number.isFinite(lens.memory.modelsOnCardMB)).toBe(true);
    expect(lens.memory.holding).toBe(false); // nothing has rendered, so nothing is loaded
    expect(lens.loads.models).toEqual([]);
    expect(lens.queue).toEqual({ running: [], waiting: [] });
    expect(Number.isFinite(lens.memory.ramMB)).toBe(true);
    expect(Date.parse(lens.idle.stopsAt)).toBeGreaterThan(Date.now());
    expect((await control({ act: 'start' })).content).toContain('already up');
  }, 240_000);

  test('with nothing loaded and nothing queued: unload, clear and cancel each say so', async () => {
    expect((await control({ act: 'unload' })).content).toContain('Nothing to unload');
    expect((await control({ act: 'clear' })).content).toBe('No job is waiting.');
    const cancelled = await control({ act: 'cancel', job: 'no-such-job' });
    expect(cancelled.ok).toBe(false);
    expect(cancelled.reason).toContain('No job no-such-job is rendering or waiting');
  }, 60_000);

  test('stop ends it and everything it held is returned', async () => {
    const stopped = await control({ act: 'stop' });
    expect(stopped.ok).toBe(true);
    expect(stopped.content).toContain('Stopped.');
    expect(await isComfyServing(cfg)).toBe(false);
    expect((await runForgeEngineTool(owner, 'forge_status', {}, cfg)).content).toContain('IMAGE ENGINE — stopped.');
  }, 60_000);
});
