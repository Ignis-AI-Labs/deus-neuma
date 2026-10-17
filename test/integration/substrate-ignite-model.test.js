/**
 * Global ignite — the model-selection path proven on the REAL exec boundary
 * (RULE 0): genuine child processes spawned/reloaded through the same
 * supervisor code that owns llama-server in production. The stand-in binary is
 * a real executable serving a real /health; only the multi-GB weights file is
 * substituted, because weights prove nothing about selection/spawn/reload.
 *
 * Pins the selection contract: one runtime selection is the single truth for
 * activeLaunchConfig (every orchestration site) AND activeServedModelKey (the
 * serving law), and igniteConfigured with a selection reloads the supervised
 * server onto the selected model — refusing an unowned server.
 */
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { writeFile, chmod } from 'fs/promises';
import { createServer } from 'http';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import { withEnv } from '../helpers/with-env.js';
import {
  resolveServingLaunchConfig, activeLaunchConfig, activeServedModelKey,
  selectSubstrateModel, stopSupervised, isServing, supervisorStatus,
} from '../../backend/services/llama-server-supervisor.js';
import { readSelection } from '../../backend/services/substrate-claim-registry.js';
import { igniteConfigured } from '../../backend/services/substrate-lifecycle.js';
import { lastActivity } from '../../backend/services/substrate-idle.js';

const freePort = () => new Promise((resolve) => {
  const srv = createServer();
  srv.listen(0, '127.0.0.1', () => {
    const { port } = srv.address();
    srv.close(() => resolve(port));
  });
});

// A real executable answering 200 {status:'ok'} on every path (like a healthy
// llama-server's /health; /slots parses as a non-array → honestly not busy).
// Weights arrive as an inherited descriptor (--model /proc/self/fd/N — the
// production custody), so the stub reads the fd's ACTUAL BYTES and reports
// them: a test asks a REAL server which weights won a race by content, the
// one identity fd-custody cannot hide. delayMs holds the boot window open.
const makeSubstrateBin = async (dir, { delayMs = 0 } = {}) => {
  const server = path.join(dir, 'serve-health.mjs');
  await writeFile(server, `
import http from 'http';
import { readFileSync } from 'fs';
const port = Number(process.argv[process.argv.indexOf('--port') + 1]);
const model = process.argv[process.argv.indexOf('--model') + 1] || '';
const mmprojIdx = process.argv.indexOf('--mmproj');
const mmproj = mmprojIdx > -1 ? process.argv[mmprojIdx + 1] : null;
let weights = '';
try { weights = readFileSync(model, 'utf8'); } catch {}
setTimeout(() => {
  http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', model_path: model, weights, mmproj }));
  }).listen(port, '127.0.0.1');
}, ${delayMs});
`);
  const bin = path.join(dir, 'fake-substrate');
  await writeFile(bin, `#!/bin/sh\nexec "${process.execPath}" "${server}" "$@"\n`);
  await chmod(bin, 0o755);
  return bin;
};

const waitFor = async (probe, timeoutMs = 15000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await probe()) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
};

// The claim + selection markers are CROSS-PROCESS state (~/.neuma by default),
// shared with any live desk on this machine: unpinned, a test selection would
// steer the operator's next real relight, and a test claim would overwrite the
// live serving's identity.
let savedClaimDir;
beforeEach(async () => {
  savedClaimDir = process.env.NEUMA_SUBSTRATE_CLAIM_DIR;
  process.env.NEUMA_SUBSTRATE_CLAIM_DIR = await createTempDir('ignite-claims');
});

afterEach(async () => {
  selectSubstrateModel(null);
  await stopSupervised();
  if (savedClaimDir === undefined) delete process.env.NEUMA_SUBSTRATE_CLAIM_DIR;
  else process.env.NEUMA_SUBSTRATE_CLAIM_DIR = savedClaimDir;
});

describe('runtime model selection (one truth for launch config + serving law)', () => {
  // a dead ephemeral port: the served-key channel probes the launch URL, and
  // this test's claims are about the RESTING ladder, not a live server.
  const deadEnv = async () => ({
    LLAMA_SERVER_MODEL: '/env/base.gguf',
    SUBSTRATE_MODEL: 'env-key',
    LLAMA_SERVER_URL: `http://127.0.0.1:${await freePort()}`,
  });

  test('activeLaunchConfig follows the selection; only an explicit clear restores env truth', async () => {
    const env = await deadEnv();
    expect(activeLaunchConfig(env).model).toBe('/env/base.gguf');
    expect(await activeServedModelKey(env)).toBe('env-key');

    selectSubstrateModel('/other/model.gguf', 'pub/other/model');
    expect(activeLaunchConfig(env).model).toBe('/other/model.gguf');
    expect(await activeServedModelKey(env)).toBe('pub/other/model');
    // resolveServingLaunchConfig itself stays pure env truth
    expect(resolveServingLaunchConfig(env).model).toBe('/env/base.gguf');

    // selecting the env model still PINS it — what the operator launched
    // stands under its own key, never silently demoted to the env default
    selectSubstrateModel('/env/base.gguf', 'pinned-env');
    expect(activeLaunchConfig(env).model).toBe('/env/base.gguf');
    expect(await activeServedModelKey(env)).toBe('pinned-env');

    selectSubstrateModel(null);
    expect(activeLaunchConfig(env).model).toBe('/env/base.gguf');
    expect(await activeServedModelKey(env)).toBe('env-key');
  });

  test('the selection survives the backend that recorded it (disk marker)', async () => {
    const env = await deadEnv();
    selectSubstrateModel('/other/model.gguf', 'pub/other/model');
    expect(readSelection()).toEqual({ path: '/other/model.gguf', key: 'pub/other/model' });
    // a fresh module world — a restarted backend — resolves the same launch
    vi.resetModules();
    const fresh = await import('../../backend/services/llama-server-supervisor.js');
    expect(fresh.activeLaunchConfig(env).model).toBe('/other/model.gguf');
    expect(await fresh.activeServedModelKey(env)).toBe('pub/other/model');
  });
});

describe('igniteConfigured with a selection, against real processes', () => {
  const cfg = { provider: 'llama-server' };

  test('switch: reloads the supervised server onto the selected model', async () => {
    const dir = await createTempDir('ignite-model');
    const bin = await makeSubstrateBin(dir);
    const port = await freePort();
    // two real weight stand-ins — launchReady demands existing files
    const baseModel = path.join(dir, 'base.gguf');
    const nextModel = path.join(dir, 'next.gguf');
    await writeFile(baseModel, 'base');
    await writeFile(nextModel, 'next');

    // The switch path re-resolves from process.env exactly as production
    // does — the test's rig must live there, not in a synthetic object.
    await withEnv('SUBSTRATE_MODEL', undefined, () => withEnv('LLAMA_SERVER_BIN', bin, () =>
      withEnv('LLAMA_SERVER_MODEL', baseModel, () =>
        withEnv('LLAMA_SERVER_URL', `http://127.0.0.1:${port}`, async () => {
          const launchCfg = activeLaunchConfig(process.env);

          // ignite the base — no selection
          const first = await igniteConfigured(cfg, launchCfg, null, null);
          expect(first.status).toBe('igniting');
          expect(await waitFor(() => isServing(port))).toBe(true);
          const stBase = await supervisorStatus(launchCfg);
          expect(stBase.owned).toBe(true);

          // switch to the other model — the selection records, the server reloads
          const result = await igniteConfigured(cfg, launchCfg, null, { path: nextModel, key: 'pub/next' });
          expect(result.status).toBe('igniting');
          expect(activeLaunchConfig(process.env).model).toBe(nextModel);
          expect(await activeServedModelKey(process.env)).toBe('pub/next');
          expect(await waitFor(async () => {
            const st = await supervisorStatus({ ...launchCfg, model: nextModel });
            return st.serving && st.owned;
          })).toBe(true);
        }))));
  }, 30000);

  test('a switch landing MID-BOOT drains the old boot and the NEW model wins', async () => {
    // The 2026-07-19 race: reload killed the loading process but then JOINED
    // its dying bootPromise — neither model came up. The switch must drain
    // the old boot fully, then spawn the selection.
    const dir = await createTempDir('ignite-midboot');
    const bin = await makeSubstrateBin(dir, { delayMs: 2500 }); // boot window held open
    const port = await freePort();
    const baseModel = path.join(dir, 'base.gguf');
    const nextModel = path.join(dir, 'next.gguf');
    await writeFile(baseModel, 'base');
    await writeFile(nextModel, 'next');
    await withEnv('SUBSTRATE_MODEL', undefined, () => withEnv('LLAMA_SERVER_BIN', bin, () =>
      withEnv('LLAMA_SERVER_MODEL', baseModel, () =>
        withEnv('LLAMA_SERVER_URL', `http://127.0.0.1:${port}`, async () => {
    const launchCfg = activeLaunchConfig(process.env);

    // preflight-style boot of the base — do NOT await; the switch lands mid-boot
    const preboot = igniteConfigured(cfg, launchCfg, null, null);
    await new Promise((r) => setTimeout(r, 300)); // boot in flight, not yet healthy
    const switched = await igniteConfigured(cfg, launchCfg, null, { path: nextModel, key: 'pub/next' });
    expect(switched.status).toBe('igniting');
    await preboot.catch(() => {}); // the aborted boot may reject — that is its honest end

    expect(await waitFor(async () => {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1000) });
        if (!res.ok) return false;
        return (await res.json()).weights === 'next'; // the NEW weights answer, by content
      } catch { return false; }
    }, 20000)).toBe(true);
        }))));
  }, 30000);

  test('a switch resolves the NEW model fully — its projector rides the boot', async () => {
    // The 2026-07-20 blindness: the switch hand-patched {model} onto a config
    // resolved for the OLD model, so Gemma booted without its mmproj. The
    // switched boot must go through activeLaunchConfig with the selection set.
    const dir = await createTempDir('ignite-projector');
    const bin = await makeSubstrateBin(dir);
    const port = await freePort();
    const baseModel = path.join(dir, 'base.gguf');
    const nextDir = path.join(dir, 'seeing');
    await writeFile(baseModel, 'base');
    await (await import('fs/promises')).mkdir(nextDir, { recursive: true });
    const nextModel = path.join(nextDir, 'seer.gguf');
    const projector = path.join(nextDir, 'mmproj-seer-f16.gguf');
    await writeFile(nextModel, 'next');
    await writeFile(projector, 'proj');

    await withEnv('SUBSTRATE_MODEL', undefined, () => withEnv('LLAMA_SERVER_BIN', bin, () =>
      withEnv('LLAMA_SERVER_MODEL', baseModel, () =>
        withEnv('LLAMA_SERVER_URL', `http://127.0.0.1:${port}`, async () => {
          const launchCfg = activeLaunchConfig(process.env);
          const first = await igniteConfigured(cfg, launchCfg, null, null);
          expect(first.status).toBe('igniting');
          expect(await waitFor(() => isServing(port))).toBe(true);

          const switched = await igniteConfigured(cfg, launchCfg, null, { path: nextModel, key: 'seeing/seer' });
          expect(switched.status).toBe('igniting');
          expect(await waitFor(async () => {
            try {
              const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1000) });
              if (!res.ok) return false;
              const body = await res.json();
              return body.weights === 'next' && body.mmproj === projector;
            } catch { return false; }
          }, 20000)).toBe(true);
        }))));
  }, 30000);

  test('an ignite marks idle activity — a fresh boot is never reaped on a stale clock', async () => {
    // The 2026-07-19 defect: only the stream path marked activity, so a fresh
    // ignite inherited a 13.5h-old clock and the idle monitor unloaded it at
    // the next tick. An ignite must restart the clock itself.
    const dir = await createTempDir('ignite-activity');
    const bin = await makeSubstrateBin(dir);
    const port = await freePort();
    const baseModel = path.join(dir, 'base.gguf');
    await writeFile(baseModel, 'base');
    const launchCfg = resolveServingLaunchConfig({
      LLAMA_SERVER_BIN: bin,
      LLAMA_SERVER_MODEL: baseModel,
      LLAMA_SERVER_URL: `http://127.0.0.1:${port}`,
    });

    const before = lastActivity();
    await new Promise((r) => setTimeout(r, 10)); // let the clock tick past `before`
    const result = await igniteConfigured(cfg, launchCfg, null, null);
    expect(['igniting', 'already-loaded']).toContain(result.status);
    expect(lastActivity()).toBeGreaterThan(before);
  }, 30000);

  test('switch refuses a serving server NEUMA does not own', async () => {
    const dir = await createTempDir('ignite-unowned');
    const bin = await makeSubstrateBin(dir);
    const port = await freePort();
    const baseModel = path.join(dir, 'base.gguf');
    const nextModel = path.join(dir, 'next.gguf');
    await writeFile(baseModel, 'base');
    await writeFile(nextModel, 'next');

    // a REAL healthy server on the port that the supervisor did not start
    const foreign = createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
    });
    await new Promise((r) => foreign.listen(port, '127.0.0.1', r));
    try {
      const launchCfg = resolveServingLaunchConfig({
        LLAMA_SERVER_BIN: bin,
        LLAMA_SERVER_MODEL: baseModel,
        LLAMA_SERVER_URL: `http://127.0.0.1:${port}`,
      });
      const result = await igniteConfigured(cfg, launchCfg, null, { path: nextModel, key: 'pub/next' });
      expect(result.status).toBe('unowned');
      // the refusal must leave the selection untouched — memory AND disk
      expect(readSelection()).toBeNull();
      await withEnv('LLAMA_SERVER_MODEL', baseModel, async () => {
        expect(activeLaunchConfig(process.env).model).toBe(baseModel);
      });
    } finally {
      await new Promise((r) => foreign.close(r));
    }
  }, 15000);

  test('after a stop, an empty relight lands on the SELECTED model — never the env default', async () => {
    // 2026-08-20: qwen was launched and serving; the dev stack's stop took the
    // server with it, and the next boot relit the env default (gemma) because
    // the selection lived only in memory. The selection must outlive the
    // server AND the backend: a preflight-shaped empty ignite relights what
    // the operator launched.
    const dir = await createTempDir('ignite-relight');
    const bin = await makeSubstrateBin(dir);
    const port = await freePort();
    const baseModel = path.join(dir, 'base.gguf');
    const nextModel = path.join(dir, 'next.gguf');
    await writeFile(baseModel, 'base');
    await writeFile(nextModel, 'next');
    await withEnv('SUBSTRATE_MODEL', undefined, () => withEnv('LLAMA_SERVER_BIN', bin, () =>
      withEnv('LLAMA_SERVER_MODEL', baseModel, () =>
        withEnv('LLAMA_SERVER_URL', `http://127.0.0.1:${port}`, async () => {
          const lit = await igniteConfigured(cfg, activeLaunchConfig(process.env), null, { path: nextModel, key: 'pub/next' });
          expect(lit.status).toBe('igniting');
          expect(await waitFor(() => isServing(port))).toBe(true);

          // the server dies — a stop clears the claim, never the selection
          await stopSupervised();
          expect(await isServing(port)).toBe(false);

          const relit = await igniteConfigured(cfg, activeLaunchConfig(process.env), null, null);
          expect(relit.status).toBe('igniting');
          expect(await waitFor(async () => {
            try {
              const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1000) });
              return res.ok && (await res.json()).weights === 'next';
            } catch { return false; }
          }, 20000)).toBe(true);
        }))));
  }, 30000);
});
