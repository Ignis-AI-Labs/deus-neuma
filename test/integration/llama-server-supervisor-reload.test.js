// Cross-process substrate reload (2026-07-22, Rugevil's verify at 'unowned').
//
// An app restart orphans the supervised llama-server: the new process has no
// in-process `child`, and reloadSupervised used to refuse exactly that shape
// as 'unowned' — even when the claim file proved a NEUMA process spawned it.
// The claim law (writeClaim/readClaim/stopClaimed) already covers this for
// stopSupervised; reloadSupervised now honors it too.
//
// Proven the honest way (RULE 0): one process, two GENERATIONS of the real
// supervisor module. Generation 1 spawns a real child (a stand-in binary
// serving real /health on a real port) — the claim lands on real disk.
// Generation 2 is a FRESH module instance (vi.resetModules — its `child` is
// null, exactly the post-restart shape) reading the same claim file against
// the same live server. Its reloadSupervised must stop the old server and
// boot a new one — never 'unowned'. Nothing is mocked: the processes, the
// sockets, the signals, and the claim file are all real.

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { writeFile, chmod, mkdir } from 'fs/promises';
import { createServer } from 'http';
import path from 'path';
import { createTempDir, unsealDirectories } from '../helpers/temp-fs.js';

const freePort = () => new Promise((resolve) => {
  const srv = createServer();
  srv.listen(0, '127.0.0.1', () => {
    const { port } = srv.address();
    srv.close(() => resolve(port));
  });
});

// A real executable answering /health like llama-server does.
const makeSubstrateBin = async (dir) => {
  const server = path.join(dir, 'serve-health.mjs');
  await writeFile(server, `
import http from 'http';
const port = Number(process.argv[process.argv.indexOf('--port') + 1]);
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: 'ok' }));
}).listen(port, '127.0.0.1');
`);
  const bin = path.join(dir, 'fake-substrate');
  await writeFile(bin, `#!/bin/sh\nexec "${process.execPath}" "${server}" "$@"\n`);
  await chmod(bin, 0o755);
  return bin;
};

describe('reloadSupervised — the claim law across process generations', () => {
  let dir, claimDir, port, bin, prevClaimDir, prevDataRoot, dataRoot;

  beforeAll(async () => {
    dir = await createTempDir('supervisor-reload');
    claimDir = await createTempDir('supervisor-reload-claim');
    port = await freePort();
    bin = await makeSubstrateBin(dir);
    prevClaimDir = process.env.NEUMA_SUBSTRATE_CLAIM_DIR;
    process.env.NEUMA_SUBSTRATE_CLAIM_DIR = claimDir;
    // Without this the immutable artifact store resolved to the REPO's data/ and
    // published real CAS objects into the working tree — sealed 0o500, so they
    // survived every cleanup. The claim dir was already isolated; the data root
    // was not. It is also a platform precondition the store pins and never
    // creates, so it must exist before the first staging call.
    prevDataRoot = process.env.NEUMA_DATA_ROOT;
    dataRoot = path.join(await createTempDir('supervisor-reload-data'), 'data');
    await mkdir(dataRoot, { recursive: true });
    process.env.NEUMA_DATA_ROOT = dataRoot;
  });

  afterAll(async () => {
    // Generation 2 owns whatever is running at the end — stop it for real.
    const gen2 = await import('../../backend/services/llama-server-supervisor.js');
    await gen2.stopSupervised();
    if (prevClaimDir === undefined) delete process.env.NEUMA_SUBSTRATE_CLAIM_DIR;
    else process.env.NEUMA_SUBSTRATE_CLAIM_DIR = prevClaimDir;
    await unsealDirectories(dataRoot);
    if (prevDataRoot === undefined) delete process.env.NEUMA_DATA_ROOT;
    else process.env.NEUMA_DATA_ROOT = prevDataRoot;
  });

  test('a doubled launch of the same config no-ops instead of killing the healthy server', async () => {
    // The 2026-09-18 desk double-fire: a second reload landed after the fresh
    // server was already healthy (a page-cached 31GB model loads in seconds)
    // and SIGKILLed it mid-teardown. The reload must recognize its own healthy
    // identical launch and stand down. Real binary, real port, real claim —
    // the pid continuity IS the proof the server was never stopped.
    const sup = await import('../../backend/services/llama-server-supervisor.js');
    const cfg = sup.resolveServingLaunchConfig({
      LLAMA_SERVER_BIN: bin, LLAMA_SERVER_MODEL: bin,
      LLAMA_SERVER_URL: `http://127.0.0.1:${port}`,
    });
    const started = await sup.startSupervised(cfg, { waitMs: 15000 });
    expect(started.status).toBe('serving');
    const pidBefore = sup.readClaim().pid;

    const again = await sup.reloadSupervised(cfg);
    expect(again.status).toBe('already-serving');   // stood down — no restart
    expect(sup.readClaim().pid).toBe(pidBefore);    // the same server still owns the claim
    expect(await sup.isServing(port)).toBe(true);   // never went down

    // A genuinely different launch still takes the full reload lane.
    const changed = sup.resolveServingLaunchConfig({
      LLAMA_SERVER_BIN: bin, LLAMA_SERVER_MODEL: bin,
      LLAMA_SERVER_URL: `http://127.0.0.1:${port}`,
      SUBSTRATE_CONTEXT_LENGTH: '32768',
    });
    const reloaded = await sup.reloadSupervised(changed);
    expect(reloaded.status).toBe('serving');
    expect(reloaded.pid).not.toBe(pidBefore);       // a real restart happened
    expect(await sup.isServing(port)).toBe(true);

    // Leave the generation clean: the next test expects no in-process child.
    await sup.stopSupervised();
    expect(sup.readClaim()).toBeNull();
  }, 30000);

  test('a fresh module generation reloads a claimed server it did not spawn', async () => {
    // Generation 1: spawn + claim, as the app instance that started the day.
    const gen1 = await import('../../backend/services/llama-server-supervisor.js');
    const cfg1 = gen1.resolveServingLaunchConfig({
      LLAMA_SERVER_BIN: bin, LLAMA_SERVER_MODEL: bin,
      LLAMA_SERVER_URL: `http://127.0.0.1:${port}`,
    });
    const started = await gen1.startSupervised(cfg1, { waitMs: 15000 });
    expect(started.status).toBe('serving');
    expect(await gen1.isServing(port)).toBe(true);
    expect(gen1.readClaim()).toMatchObject({ port });

    // Generation 2: a FRESH module — the app after a restart. Its in-process
    // child is null; only the claim on disk connects it to the live server.
    // (vitest runs test FILES in separate processes, but module state is
    // shared per file — resetModules gives us the honest post-restart shape.)
    const { vi } = await import('vitest');
    vi.resetModules();
    const gen2 = await import('../../backend/services/llama-server-supervisor.js');
    expect(gen2.readClaim()).toMatchObject({ port }); // the claim survived the "restart"
    const cfg2 = gen2.resolveServingLaunchConfig({
      LLAMA_SERVER_BIN: bin, LLAMA_SERVER_MODEL: bin,
      LLAMA_SERVER_URL: `http://127.0.0.1:${port}`,
    });

    const out = await gen2.reloadSupervised(cfg2);
    expect(out.status).toBe('serving');           // NOT 'unowned' — the claim was honored
    expect(out.pid).not.toBe(started.pid);        // a NEW server: the old one was stopped
    expect(await gen2.isServing(port)).toBe(true);
  }, 30000);

  test('a truly foreign server on the port still refuses', async () => {
    const gen2 = await import('../../backend/services/llama-server-supervisor.js');
    // Stop ours + drop the claim, then stand up a bare server NEUMA never spawned.
    await gen2.stopSupervised();
    gen2.clearClaim();
    const foreign = createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
    });
    await new Promise((r) => foreign.listen(port, '127.0.0.1', r));
    try {
      const cfg = gen2.resolveServingLaunchConfig({
        LLAMA_SERVER_BIN: bin, LLAMA_SERVER_MODEL: bin,
        LLAMA_SERVER_URL: `http://127.0.0.1:${port}`,
      });
      const out = await gen2.reloadSupervised(cfg);
      expect(out.status).toBe('unowned');
    } finally {
      await new Promise((r) => foreign.close(r));
    }
  }, 30000);
});
