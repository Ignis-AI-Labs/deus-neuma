import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const {
  CHALLENGE_HEADER,
  PROOF_HEADER,
  healthProof,
  waitForBackendHealth,
} = require('../../electron/backend-health.cjs');

const ROOT = path.resolve(import.meta.dirname, '../..');
const children = [];
const servers = [];
const roots = [];
let backend;
let backendOrigin;
let backendToken;

const childSource = `
import express from 'express';
import { createServer } from 'node:http';
import healthRouter from './backend/routes/health-routes.js';
import { listenServer } from './backend/services/server-listen.js';
import { mcpService } from './backend/services/mcp.js';
const app = express();
app.use('/api/v1/health', healthRouter);
const server = createServer(app);
listenServer({
  server,
  config: { port: 0, host: '127.0.0.1', frontendPort: 0, nodeEnv: 'production' },
  log: console,
  mcpService,
});
process.on('SIGTERM', () => server.close(() => process.exit(0)));
`;

const hostileServer = async (proofFor) => {
  const server = createServer((req, res) => {
    const proof = proofFor?.(req.headers[CHALLENGE_HEADER]);
    if (proof) res.setHeader(PROOF_HEADER, proof);
    res.writeHead(200, { 'content-type': 'application/json' }).end('{"status":"healthy"}');
  });
  servers.push(server);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}`;
};

beforeAll(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-backend-auth-'));
  roots.push(root);
  backend = spawn(process.execPath, ['--input-type=module', '-e', childSource], {
    cwd: ROOT,
    env: { ...process.env, NEUMA_DESK_PID: String(process.pid), WORKSPACES_ROOT: root },
    stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
  });
  children.push(backend);
  const ready = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('real backend child did not become ready')), 15000);
    backend.once('error', reject);
    backend.once('exit', (code) => reject(new Error(`real backend child exited ${code}`)));
    backend.on('message', (message) => {
      if (message?.type === 'neuma:backend-ready') {
        clearTimeout(timer);
        resolve(message);
      }
    });
  });
  backendToken = ready.healthToken;
  backendOrigin = `http://127.0.0.1:${ready.port}`;
}, 20000);

afterAll(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = new Promise((resolve) => child.once('exit', resolve));
      child.kill('SIGTERM');
      await exited;
    }
  }
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});

describe('Electron backend launch authentication', () => {
  it('receives a random launch token over private IPC and accepts the genuine health proof', async () => {
    expect(backendToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    await expect(waitForBackendHealth({ origin: backendOrigin, token: backendToken, timeoutMs: 1000 })).resolves.toBeUndefined();
    await expect(waitForBackendHealth({ origin: backendOrigin, token: null, timeoutMs: 0 })).rejects.toThrow(/launch credential/);
  });

  it('keeps public liveness available without exposing the token or a proof', async () => {
    const response = await fetch(`${backendOrigin}/api/v1/health`);
    expect(response.status).toBe(200);
    expect(response.headers.get(PROOF_HEADER)).toBeNull();
    expect(await response.text()).not.toContain(backendToken);
  });

  it('refuses an independent HTTP 200 impostor with no proof', async () => {
    const origin = await hostileServer();
    await expect(waitForBackendHealth({ origin, token: backendToken, timeoutMs: 0 })).rejects.toThrow(/launch identity/);
  });

  it('refuses a fresh challenge answered with a proof under the wrong token', async () => {
    const origin = await hostileServer((challenge) => healthProof('the wrong launch token', challenge));
    await expect(waitForBackendHealth({ origin, token: backendToken, timeoutMs: 0 })).rejects.toThrow(/launch identity/);
  });
});
