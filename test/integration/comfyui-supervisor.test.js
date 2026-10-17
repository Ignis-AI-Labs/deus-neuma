/**
 * THE HEARTH proven against the REAL pinned engine (RULE 0 — no mocks,
 * skip-if-absent, never faked): launch→READY on the frozen line, orphan
 * adoption with the identity check, adoption refusal on unsafe argv, the
 * two-tier reap, and the ownership law on stop.
 *
 * Isolation: own port (8195), own COMFYUI_DATA_DIR (temp) — the engine's
 * sqlite DB rides the user dir, so this never touches a live lane's state,
 * and the sibling stack / any operator workbench is never bounced.
 */
import { describe, test, expect, afterAll } from 'vitest';
import { shouldRunGpuEngineTests, gpuSkipNote } from '../helpers/gpu-optin.js';
import { spawn } from 'child_process';
import { existsSync, mkdtempSync, mkdirSync, rmSync, statSync } from 'fs';
import os from 'os';
import path from 'path';
import {
  resolveComfyConfig,
  buildComfyArgs,
  isComfyServing,
  ensureComfyReady,
  stopComfy,
  reapPass,
  comfySupervisorStatus,
  comfyShutdown,
} from '../../backend/services/image-forge/comfyui-supervisor.js';

const PORT = 8195;
const LAUNCH_TIMEOUT = 180_000;

// A real install: env first, then the dev-rig conventional home. Skip-if-absent.
const installDir = [process.env.COMFYUI_INSTALL_DIR, '/mnt/external/comfyui/app']
  .filter(Boolean)
  .find((d) => existsSync(path.join(d, 'main.py')) && existsSync(path.join(d, '.venv', 'bin', 'python')));

const dataDir = mkdtempSync(path.join(os.tmpdir(), 'image-forge-it-'));
const env = installDir ? {
  COMFYUI_URL: `http://127.0.0.1:${PORT}`,
  COMFYUI_INSTALL_DIR: installDir,
  COMFYUI_DATA_DIR: dataDir,
} : {};
const cfg = resolveComfyConfig(env);

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const waitServing = async (deadlineMs) => {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    if (await isComfyServing(cfg)) return true;
    await delay(1000);
  }
  return false;
};
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const killAndWait = async (proc) => {
  // A signal-killed child has exitCode null and signalCode set — both mean gone.
  if (!proc || proc.exitCode !== null || proc.signalCode !== null) return;
  const exited = new Promise((r) => proc.once('exit', r));
  try { proc.kill('SIGTERM'); } catch { return; }
  await Promise.race([exited, delay(8000).then(() => { try { proc.kill('SIGKILL'); } catch { /* gone */ } return exited; })]);
};

// Foreign engines this test spawns itself (adoption subjects) — reaped in afterAll.
const spawned = [];

afterAll(async () => {
  await comfyShutdown();
  for (const proc of spawned) await killAndWait(proc);
  rmSync(dataDir, { recursive: true, force: true });
}, 30_000);

if (installDir && !shouldRunGpuEngineTests()) console.warn(gpuSkipNote('comfyui supervisor'));
describe.skipIf(!installDir || !shouldRunGpuEngineTests())('comfyui-supervisor against the real pinned engine', () => {
  test('launches on the frozen line to READY, logs to a file, and stops clean', async () => {
    const status = await ensureComfyReady(cfg, { waitMs: LAUNCH_TIMEOUT - 20_000 });
    expect(status.state).toBe('ready');
    expect(status.owned).toBe(true);
    expect(status.adopted).toBe(false);
    expect(status.serving).toBe(true);
    expect(status.pid).toBeGreaterThan(0);
    expect(await isComfyServing(cfg)).toBe(true);
    // EPIPE law: output rides a real file, and the engine actually wrote to it.
    expect(status.logPath).toBe(path.join(dataDir, 'logs', `comfyui-${PORT}.log`));
    expect(statSync(status.logPath).size).toBeGreaterThan(0);

    const stopped = await stopComfy();
    expect(stopped.status).toBe('stopped');
    expect(await isComfyServing(cfg)).toBe(false);
    const after = await comfySupervisorStatus(cfg);
    expect(after.state).toBe('stopped');
    expect(after.owned).toBe(false);
  }, LAUNCH_TIMEOUT);

  test('racing callers join one boot — a single engine, one pid', async () => {
    const [a, b] = await Promise.all([
      ensureComfyReady(cfg, { waitMs: LAUNCH_TIMEOUT - 20_000 }),
      ensureComfyReady(cfg, { waitMs: LAUNCH_TIMEOUT - 20_000 }),
    ]);
    expect(a.state).toBe('ready');
    expect(b.state).toBe('ready');
    expect(a.pid).toBe(b.pid);
  }, LAUNCH_TIMEOUT);

  test('two-tier reap: /free once per idle spell, then owned full stop — queue-guarded live', async () => {
    // Engine is READY from the previous test. Tier TTLs shrunk to the floor;
    // the /queue probe runs against the real engine (empty = reapable).
    await delay(10);
    const tier1 = { ...cfg, idleTtlMs: 1, reapTtlMs: 0 };
    expect(await reapPass(tier1)).toBe('free');
    expect(await reapPass(tier1)).toBe('none'); // free-once per idle spell
    expect(await isComfyServing(cfg)).toBe(true); // tier-1 never stops the engine

    const tier2 = { ...cfg, idleTtlMs: 1, reapTtlMs: 1 };
    expect(await reapPass(tier2)).toBe('stop');
    expect(await isComfyServing(cfg)).toBe(false);
    expect((await comfySupervisorStatus(cfg)).state).toBe('stopped');
  }, 60_000);

  test('adopts a healthy engine it did not spawn — identity-checked — and stop() releases, never signals', async () => {
    const proc = spawn(cfg.python, buildComfyArgs(cfg), {
      cwd: cfg.installDir, env: process.env, stdio: 'ignore',
    });
    spawned.push(proc);
    expect(await waitServing(120_000)).toBe(true);

    const status = await ensureComfyReady(cfg);
    expect(status.state).toBe('ready');
    expect(status.adopted).toBe(true);
    expect(status.owned).toBe(false);
    expect(status.pid).toBeNull(); // proc-less: not ours to signal

    const released = await stopComfy();
    expect(released.status).toBe('released');
    expect(alive(proc.pid)).toBe(true); // the foreign process was NOT killed
    expect(await isComfyServing(cfg)).toBe(true);

    await killAndWait(proc); // test-owned cleanup, not supervisor action
    expect(await waitServing(2000)).toBe(false);
  }, LAUNCH_TIMEOUT);

  test('refuses adoption of an instance whose argv lacks the safety flags — named reason, no signal', async () => {
    // A real engine WITHOUT --disable-all-custom-nodes (and writing to its
    // own output tree): exactly the doctored-argv shape B-3 refuses.
    const unsafeUser = path.join(dataDir, 'unsafe-user');
    const unsafeOut = path.join(dataDir, 'unsafe-out');
    mkdirSync(unsafeUser, { recursive: true });
    mkdirSync(unsafeOut, { recursive: true });
    const proc = spawn(cfg.python, [
      cfg.mainPy, '--port', String(PORT),
      '--output-directory', unsafeOut,
      '--temp-directory', path.join(dataDir, 'unsafe-tmp'),
      '--user-directory', unsafeUser,
    ], { cwd: cfg.installDir, env: process.env, stdio: 'ignore' });
    spawned.push(proc);
    expect(await waitServing(120_000)).toBe(true);

    await expect(ensureComfyReady(cfg)).rejects.toThrow(/adoption refused.*disable-all-custom-nodes/s);
    expect(alive(proc.pid)).toBe(true); // refusal never signals the stranger
    const status = await comfySupervisorStatus(cfg);
    expect(status.state).toBe('stopped');
    expect(status.foreign).toBe(true); // honest: something we can't vouch for holds the port
    expect(status.lastError?.error).toMatch(/adoption refused/); // the card's named reason

    await killAndWait(proc);
  }, LAUNCH_TIMEOUT);
});

describe('comfyui-supervisor without an install (fail-closed lane)', () => {
  test('ensureComfyReady names the missing install; status carries the reason', async () => {
    // A dead port no other integration file uses (job-lane owns 8196/8197):
    // the "not installed" verdict must not race a sibling suite's live engine.
    const absent = resolveComfyConfig({ COMFYUI_URL: 'http://127.0.0.1:8288', COMFYUI_DATA_DIR: dataDir });
    await expect(ensureComfyReady(absent)).rejects.toThrow(/not installed/);
    const status = await comfySupervisorStatus(absent);
    expect(status.install.installed).toBe(false);
    expect(status.install.reason).toContain('COMFYUI_INSTALL_DIR');
  });
});
