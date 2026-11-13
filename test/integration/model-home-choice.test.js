/* global process, fetch */
// The model folder is the person's, chosen before anything downloads (Design note, 2026-11-13: a
// teammate's Windows setup put its model on a full C: drive). The REAL routes (model-server-routes.js)
// over real HTTP, as the install owner at the desk; the REAL plan read of this machine (discovery
// pinned to one closed port, as managed-ollama-job.test.js does); real folders on a real disk.
// No mocks (RULE 0).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createTempDir } from '../helpers/temp-fs.js';
import { makeInstallOwner } from '../helpers/install-owner-kit.js';

const ENV_KEYS = ['NEUMA_DATA_ROOT', 'NEUMA_OLLAMA_ENDPOINT', 'NEUMA_DISCOVERY_PORTS', 'NEUMA_PROVIDER_CHOICE_PATH', 'LLAMA_SERVER_URL'];
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
const OWN_FOLDER = ['download', 'managed', 'engine-download', 'engine-installed'];
let server; let base; let headers; let dataRoot;

const call = async (method, url, body) => {
  const res = await fetch(`${base}${url}`, { method, headers: { ...headers, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json() };
};

beforeAll(async () => {
  dataRoot = await createTempDir('model-home');
  process.env.NEUMA_DATA_ROOT = dataRoot;
  process.env.NEUMA_OLLAMA_ENDPOINT = 'http://127.0.0.1:9';
  process.env.NEUMA_DISCOVERY_PORTS = '9';
  process.env.NEUMA_PROVIDER_CHOICE_PATH = path.join(dataRoot, 'provider-choice.json');
  process.env.LLAMA_SERVER_URL = 'http://127.0.0.1:9';
  const { fullAuth } = await import('../helpers/audit-auth.js');
  const auth = await fullAuth();
  await makeInstallOwner(auth.address);
  headers = { Authorization: `Bearer ${auth.token}` };
  const { default: router } = await import('../../backend/routes/model-server-routes.js');
  const app = express();
  app.use(express.json());
  app.use('/api/v1/model-server', router);
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
}, 60_000);

afterAll(async () => {
  server?.closeAllConnections();
  if (server?.listening) await new Promise((resolve) => server.close(resolve));
  for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});

describe('the folder the models go in is chosen before the setup', () => {
  it('starts beside the data, then follows the folder the person picks, measured on its own drive', async () => {
    const before = await call('GET', '/api/v1/model-server/plan');
    expect(before.status).toBe(200);
    expect(before.body.homePath).toBe(path.join(dataRoot, 'model-server'));
    expect(before.body.homeChangeable).toBe(OWN_FOLDER.includes(before.body.plan?.server));

    // another drive's folder, not there yet: made, checked writable, kept
    const other = path.join(await createTempDir('model-home-other-drive'), 'Deus Neuma', 'models');
    const after = await call('POST', '/api/v1/model-server/home', { home: other });
    expect(after.status).toBe(200);
    expect(after.body.homePath).toBe(other);
    expect(fs.statSync(other).isDirectory()).toBe(true);
    expect(fs.readdirSync(other)).toEqual([]); // the write check leaves nothing behind
    const kept = JSON.parse(fs.readFileSync(path.join(dataRoot, 'settings', 'model-home.json'), 'utf8'));
    expect(kept.home).toBe(other);
    // the free space the plan reports is the chosen folder's drive
    if (after.body.plan?.freeBytes != null) {
      const s = fs.statfsSync(other);
      expect(Math.abs(after.body.plan.freeBytes - s.bavail * s.bsize)).toBeLessThan(512 * 1024 * 1024);
    }
    // and it stays chosen for the next read
    expect((await call('GET', '/api/v1/model-server/plan')).body.homePath).toBe(other);
  }, 60_000);

  it('refuses a folder named by part of a path, and one it cannot write in, and keeps the last choice', async () => {
    const kept = (await call('GET', '/api/v1/model-server/plan')).body.homePath;
    const relative = await call('POST', '/api/v1/model-server/home', { home: 'models' });
    expect(relative.status).toBe(400);
    expect(relative.body.error).toMatch(/full path/);

    const locked = path.join(await createTempDir('model-home-locked'), 'ro');
    fs.mkdirSync(locked);
    fs.chmodSync(locked, 0o500);
    try {
      const refused = await call('POST', '/api/v1/model-server/home', { home: path.join(locked, 'models') });
      if (process.getuid?.() !== 0) {
        expect(refused.status).toBe(400);
        expect(refused.body.error).toMatch(/cannot write/);
      }
    } finally {
      fs.chmodSync(locked, 0o700);
    }
    expect((await call('GET', '/api/v1/model-server/plan')).body.homePath).toBe(kept);
  }, 60_000);
});

describe('a setup that already lives in one folder, and a new choice', () => {
  it('the next setup goes where the person chose; the record (what boot starts) keeps the old folder until then', async () => {
    const { writeManagedRecord, readManagedRecord } = await import('../../backend/services/managed-ollama-record.js');
    const ollama = await import('../../backend/services/managed-ollama.js');
    fs.rmSync(path.join(dataRoot, 'settings', 'model-home.json'), { force: true });
    const oldHome = path.join(await createTempDir('model-home-old-c-drive'), 'model-server');
    await writeManagedRecord({ managed: true, bin: path.join(oldHome, 'ollama', 'ollama'), endpoint: 'http://127.0.0.1:9', home: oldHome, modelsDir: path.join(oldHome, 'models') });
    expect(ollama.installHomePath()).toBe(oldHome);

    const newHome = path.join(await createTempDir('model-home-new-d-drive'), 'models');
    const res = await call('POST', '/api/v1/model-server/home', { home: newHome });
    expect(res.status).toBe(200);
    expect(ollama.installHomePath()).toBe(newHome);
    expect(readManagedRecord().home).toBe(oldHome);
  });
});

describe('the Windows installer\'s folder', () => {
  it('reads ModelHome from reg query, and nothing else', async () => {
    const { parseRegistryHome } = await import('../../backend/services/model-home.js');
    const out = '\r\nHKEY_CURRENT_USER\\Software\\Deus Neuma\r\n    ModelHome    REG_SZ    D:\\Deus Neuma\\models\r\n\r\n';
    expect(parseRegistryHome(out)).toBe('D:\\Deus Neuma\\models');
    expect(parseRegistryHome('    StartMenu    REG_SZ    Deus Neuma\r\n')).toBeNull();
    expect(parseRegistryHome('    ModelHome    REG_SZ    models\r\n')).toBeNull();
    expect(parseRegistryHome('')).toBeNull();
  });
});
