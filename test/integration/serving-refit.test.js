/* global process, fetch, setTimeout, AbortSignal */
import { createServer } from 'node:http';
import path from 'node:path';
import { chmod, readFile, writeFile } from 'node:fs/promises';
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { createTempDir } from '../helpers/temp-fs.js';
import { withEnv } from '../helpers/with-env.js';
import {
  resolveServingLaunchConfig, selectSubstrateModel, startSupervised, stopSupervised,
} from '../../backend/services/llama-server-supervisor.js';
import { refitServing } from '../../backend/services/serving-refit.js';

const freePort = () => new Promise((resolve) => {
  const server = createServer();
  server.listen(0, '127.0.0.1', () => {
    const { port } = server.address();
    server.close(() => resolve(port));
  });
});

const waitFor = async (probe, timeoutMs = 15000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await probe()) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
};

const makeServerBin = async (dir) => {
  const script = path.join(dir, 'serve.mjs');
  const busyFile = path.join(dir, 'busy');
  await writeFile(script, `
import http from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
const port = Number(process.argv[process.argv.indexOf('--port') + 1]);
const context = Number(process.argv[process.argv.indexOf('-c') + 1]);
const model = process.argv[process.argv.indexOf('--model') + 1];
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  if (req.url === '/slots') {
    res.end(JSON.stringify([{ is_processing: existsSync(${JSON.stringify(busyFile)}) }]));
    return;
  }
  let weights = '';
  try { weights = readFileSync(model, 'utf8'); } catch {}
  res.end(JSON.stringify({ status: 'ok', model_path: model, weights, context, pid: process.pid }));
}).listen(port, '127.0.0.1');
`);
  const bin = path.join(dir, 'server-bin');
  await writeFile(bin, `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`);
  await chmod(bin, 0o755);
  return { bin, busyFile };
};

const health = async (port) => {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1000) });
    return response.ok ? response.json() : null;
  } catch {
    return null;
  }
};

let claimDir;
beforeEach(async () => {
  claimDir = process.env.NEUMA_SUBSTRATE_CLAIM_DIR;
  process.env.NEUMA_SUBSTRATE_CLAIM_DIR = await createTempDir('serving-refit-claims');
});

afterEach(async () => {
  selectSubstrateModel(null);
  await stopSupervised();
  if (claimDir === undefined) delete process.env.NEUMA_SUBSTRATE_CLAIM_DIR;
  else process.env.NEUMA_SUBSTRATE_CLAIM_DIR = claimDir;
});

describe('same-server context refit', () => {
  test('saves the share and restarts the same model on the same port once', async () => {
    const dir = await createTempDir('serving-refit-process');
    const { bin, busyFile } = await makeServerBin(dir);
    const model = path.join(dir, 'model.gguf');
    await writeFile(model, 'same-weights');
    const port = await freePort();

    await withEnv('LLAMA_SERVER_BIN', bin, () => withEnv('LLAMA_SERVER_MODEL', model, () =>
      withEnv('LLAMA_SERVER_URL', `http://127.0.0.1:${port}`, () =>
        withEnv('SUBSTRATE_CONTEXT_LENGTH', '4096', async () => {
          const launch = resolveServingLaunchConfig(process.env);
          await startSupervised(launch);
          const before = await health(port);
          expect(before).toMatchObject({ weights: 'same-weights', context: 4096 });

          const accepted = await refitServing(launch, 85);
          expect(accepted).toEqual({ status: 'igniting', sharePct: 85 });
          expect(await refitServing(launch, 85)).toEqual({ status: 'busy', reason: 'relaunch-in-flight' });
          expect(await waitFor(async () => {
            const next = await health(port);
            return next && next.pid !== before.pid;
          })).toBe(true);

          const after = await health(port);
          expect(after).toMatchObject({ weights: 'same-weights', context: 4096 });
          const saved = JSON.parse(await readFile(path.join(process.env.NEUMA_SUBSTRATE_CLAIM_DIR, 'serving-fit.json'), 'utf8'));
          expect(saved.sharePct).toBe(85);

          await writeFile(busyFile, 'processing');
          let refused = null;
          expect(await waitFor(async () => {
            refused = await refitServing(launch, 85);
            return refused.status === 'busy' && refused.reason === undefined;
          })).toBe(true);
          expect(refused).toEqual({ status: 'busy' });
          expect((await health(port)).pid).toBe(after.pid);
        }))));
  }, 30000);

  test('a healthy server NEUMA does not own is left running and untouched', async () => {
    const dir = await createTempDir('serving-refit-foreign');
    const { bin } = await makeServerBin(dir);
    const model = path.join(dir, 'model.gguf');
    await writeFile(model, 'weights');
    const port = await freePort();
    const foreign = createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
    });
    await new Promise((resolve) => foreign.listen(port, '127.0.0.1', resolve));
    try {
      const launch = resolveServingLaunchConfig({
        LLAMA_SERVER_BIN: bin,
        LLAMA_SERVER_MODEL: model,
        LLAMA_SERVER_URL: `http://127.0.0.1:${port}`,
      });
      expect(await refitServing(launch, 85)).toEqual({ status: 'unowned' });
      expect((await fetch(`http://127.0.0.1:${port}/health`)).ok).toBe(true);
    } finally {
      await new Promise((resolve) => foreign.close(resolve));
    }
  }, 15000);
});
