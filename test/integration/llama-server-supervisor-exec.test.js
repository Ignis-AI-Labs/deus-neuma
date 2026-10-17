/**
 * The supervisor's exec boundary, proven on the REAL path (RULE 0): a genuine
 * child process is spawned through the same spawn/health-poll/SIGTERM code that
 * owns llama-server in production. The stand-in binary is a real executable
 * that serves a real /health on the configured port — everything the supervisor
 * touches (process table, sockets, signals) is real; only the 31GB model is
 * substituted, because a weights file proves nothing about process ownership.
 *
 * Pins the boot-JOIN contract: a summon that lands while a boot is in flight
 * awaits the same boot and resolves 'serving' — it must never be waved through
 * with 'start-in-progress' to stream against a server that isn't healthy yet
 * (the launch-window defect flagged by paired review 2026-07-10).
 */
import { describe, test, expect, afterEach, beforeAll, afterAll } from 'vitest';
import { writeFile, chmod, mkdir, readlink, realpath } from 'fs/promises';
import { createServer } from 'http';
import path from 'path';
import { createTempDir, unsealDirectories } from '../helpers/temp-fs.js';
import {
  resolveServingLaunchConfig, startSupervised, ensureServing, stopSupervised,
  isServing, supervisorStatus,
} from '../../backend/services/llama-server-supervisor.js';

const freePort = () => new Promise((resolve) => {
  const srv = createServer();
  srv.listen(0, '127.0.0.1', () => {
    const { port } = srv.address();
    srv.close(() => resolve(port));
  });
});

// A real executable that answers /health like llama-server does, honoring the
// --port the supervisor passes and an optional startup delay (to hold the boot
// window open long enough to prove the join).
const makeSubstrateBin = async (dir, { delayMs = 0 } = {}) => {
  const server = path.join(dir, 'serve-health.mjs');
  await writeFile(server, `
import http from 'http';
const port = Number(process.argv[process.argv.indexOf('--port') + 1]);
const argv = process.argv.slice(2);
setTimeout(() => {
  http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    if (req.url === '/health') return res.end(JSON.stringify({ status: 'ok' }));
    if (req.url === '/argv') return res.end(JSON.stringify(argv));
    if (req.url === '/lora-adapters') return res.end('[]');
    res.end('{}');
  }).listen(port, '127.0.0.1');
}, ${delayMs});
`);
  const bin = path.join(dir, 'fake-substrate');
  await writeFile(bin, `#!/bin/sh\nexec "${process.execPath}" "${server}" "$@"\n`);
  await chmod(bin, 0o755);
  return bin;
};

const cfgFor = (bin, port) => resolveServingLaunchConfig({
  LLAMA_SERVER_BIN: bin,
  LLAMA_SERVER_MODEL: bin, // launchReady wants an existing file; the bin is one
  LLAMA_SERVER_URL: `http://127.0.0.1:${port}`,
});

afterEach(async () => { await stopSupervised(); });

// Claims and immutable staging are isolated from a live desk and made writable
// again only for the global real-temp cleanup.
let prevClaimDir, prevDataRoot, dataRoot;

beforeAll(async () => {
  prevClaimDir = process.env.NEUMA_SUBSTRATE_CLAIM_DIR;
  prevDataRoot = process.env.NEUMA_DATA_ROOT;
  const root = await createTempDir('supervisor-exec');
  process.env.NEUMA_SUBSTRATE_CLAIM_DIR = path.join(root, 'claims');
  dataRoot = path.join(root, 'data');
  // The data root is a PLATFORM PRECONDITION, not something the artifact store
  // provisions: the CAS pins path.dirname(refinement-artifacts) and refuses a
  // root that does not exist. Production creates it at boot (server.js
  // ensureDirectories). Pointing NEUMA_DATA_ROOT at an uncreated path is a
  // shape production never has, and it failed here as a bare ENOENT realpath.
  await mkdir(dataRoot, { recursive: true });
  process.env.NEUMA_DATA_ROOT = dataRoot;
});
afterAll(async () => {
  await unsealDirectories(dataRoot);
  if (prevClaimDir === undefined) delete process.env.NEUMA_SUBSTRATE_CLAIM_DIR;
  else process.env.NEUMA_SUBSTRATE_CLAIM_DIR = prevClaimDir;
  if (prevDataRoot === undefined) delete process.env.NEUMA_DATA_ROOT;
  else process.env.NEUMA_DATA_ROOT = prevDataRoot;
});

describe('llama-server supervisor — real spawn, real health, real signals', () => {
  test('fresh zero-adapter base boot holds the verified model descriptor and owns the child', async () => {
    const dir = await createTempDir('supervisor-live');
    const port = await freePort();
    const cfg = cfgFor(await makeSubstrateBin(dir), port);

    const started = await startSupervised(cfg, { waitMs: 15000 });
    expect(started.status).toBe('serving');
    expect(started.pid).toBeGreaterThan(0);
    await expect(isServing(port)).resolves.toBe(true);
    const argv = await fetch(`http://127.0.0.1:${port}/argv`).then((res) => res.json());
    const modelPath = argv[argv.indexOf('--model') + 1];
    // The child boards the model through an INHERITED DESCRIPTOR, never a
    // path it could re-point (friction-map T7: base-only now HOLDS the
    // operator's own file in place — the lineage path's shipped law — instead
    // of copying 31GB into the CAS per ignition). The descriptor must resolve
    // to the REAL source file: digest-verified and inode-pinned before serve,
    // fd custody pins the verified opened inode for the child.
    expect(modelPath).not.toBe(cfg.model);
    expect(modelPath).toMatch(/^\/proc\/self\/fd\/\d+$/);
    const boarded = await readlink(
      `/proc/${started.pid}/fd/${modelPath.slice('/proc/self/fd/'.length)}`,
    );
    expect(boarded).toBe(await realpath(cfg.model));
    expect(argv).not.toContain('--lora');

    const st = await supervisorStatus(cfg);
    expect(st).toMatchObject({ serving: true, owned: true, lastError: null });
    await expect(stopSupervised()).resolves.toEqual({ status: 'stopped' });
    await expect(isServing(port)).resolves.toBe(false);
    expect((await supervisorStatus(cfg)).owned).toBe(false);
  });

  test('an uncommitted adapter input is refused before any child can board it', async () => {
    const dir = await createTempDir('supervisor-uncommitted-adapter');
    const port = await freePort();
    const bin = await makeSubstrateBin(dir);
    const adapter = path.join(dir, 'uncommitted.gguf');
    await writeFile(adapter, 'uncommitted adapter bytes');
    const cfg = { ...cfgFor(bin, port), loras: [adapter] };
    await expect(startSupervised(cfg, { waitMs: 15000 })).rejects.toThrow(/uncommitted adapter launch input refused/);
    await expect(isServing(port)).resolves.toBe(false);
  });

  test('a summon landing mid-boot JOINS the boot and resolves serving', async () => {
    const dir = await createTempDir('supervisor-join');
    const port = await freePort();
    // 2s before the child listens — the boot window the join must survive.
    const cfg = cfgFor(await makeSubstrateBin(dir, { delayMs: 2000 }), port);

    const boot = startSupervised(cfg, { waitMs: 15000 });
    const summon = ensureServing(cfg); // arrives while the boot is in flight
    const [bootResult, summonResult] = await Promise.all([boot, summon]);

    expect(bootResult.status).toBe('serving');
    // The join contract: never 'start-in-progress' — the summon waited for
    // health, so streaming right now would reach a live server.
    expect(summonResult.status).toBe('serving');
    await expect(isServing(port)).resolves.toBe(true);
  });

  test('refuses to stop a server it does not own, and honors it as serving', async () => {
    const port = await freePort();
    const foreign = createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
    });
    await new Promise((resolve) => foreign.listen(port, '127.0.0.1', resolve));
    try {
      const dir = await createTempDir('supervisor-foreign');
      const cfg = cfgFor(await makeSubstrateBin(dir), port);

      await expect(startSupervised(cfg)).resolves.toEqual({ status: 'already-serving' });
      // Not ours — stop must be a no-op, and the foreign server must survive.
      await expect(stopSupervised()).resolves.toEqual({ status: 'not-running' });
      await expect(isServing(port)).resolves.toBe(true);
    } finally {
      await new Promise((resolve) => foreign.close(resolve));
    }
  });

  test('the port answers BEFORE staging: already-serving wins even when staging would fail (T8)', async () => {
    const port = await freePort();
    const foreign = createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
    });
    await new Promise((resolve) => foreign.listen(port, '127.0.0.1', resolve));
    try {
      const dir = await createTempDir('supervisor-probe-first');
      const bin = await makeSubstrateBin(dir);
      // The model file does NOT exist: the old order (stage → probe) threw on
      // staging before ever learning the port was served — the full multi-GB
      // staging cost was paid and thrown away on every foreign-held port. The
      // hoisted probe must answer first.
      const cfg = resolveServingLaunchConfig({
        LLAMA_SERVER_BIN: bin,
        LLAMA_SERVER_MODEL: path.join(dir, 'does-not-exist.gguf'),
        LLAMA_SERVER_URL: `http://127.0.0.1:${port}`,
      });
      await expect(startSupervised(cfg)).resolves.toEqual({ status: 'already-serving' });
      await expect(isServing(port)).resolves.toBe(true);
    } finally {
      await new Promise((resolve) => foreign.close(resolve));
    }
  });
});
