/* global process, setTimeout, fetch */
// An answer on Ollama's port is not the model server (PR600 audit P6-153). Two real loopback
// responders answer Ollama's own endpoints with a new enough version and the recommended model:
// one in this process (this account), and one started under ANOTHER account: a child in a user
// namespace mapped to this account's subordinate ids, so the kernel records its listening socket
// under a different uid, exactly as it would another person's program. The real serverState reads
// the kernel's table (/proc/net/tcp) for each; the real installPlan decides from what it returns.
// Skipped where this machine cannot start a process under a subordinate id. The other account's
// responder ends itself when asked to (GET /quit) or after a minute. No mocks (RULE 0).
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { serverState, usableServer } from '../../backend/services/ollama-server-state.js';
import { checkSavedRoutes, assertRouteOwned, clearRouteRefusals } from '../../backend/services/loopback-route-owner.js';
import { createStreamRequest } from '../../backend/services/llm-provider.js';
import { OLLAMA_VERSION, installPlan, managedEndpoints, ollamaModelRef } from '../../backend/services/managed-ollama-plan.js';

const REC = Object.freeze({ model: 'Qwen3.8-4B (distilled)', quant: 'Q4_K_M', sizeGB: 2.8, source: 'empero-ai/Qwen3.8-4B-Distill-GGUF' });
const REF = ollamaModelRef(REC);
const AS_ANOTHER = ['--user', '--map-users=auto', '--map-groups=auto', '--setuid', '0', '--setgid', '0'];
const can = process.platform === 'linux'
  && spawnSync('unshare', [...AS_ANOTHER, process.execPath, '-e', '0'], { cwd: '/', timeout: 10_000 }).status === 0;

const RESPONDER = `const http = require('node:http');
const server = http.createServer((req, res) => {
  const json = (body) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  if (req.url === '/quit') { json({}); return server.close(() => process.exit(0)); }
  if (req.url === '/api/version') return json({ version: '9.9.9' });
  return json({ models: [{ name: ${JSON.stringify(REF)} }] });
}).listen(0, '127.0.0.1', () => process.stdout.write(String(server.address().port) + '\\n'));
setTimeout(() => process.exit(0), 60000);
`;

let mine; let mineAt; let theirsAt;
const planFor = (running, endpoint) => installPlan({
  platform: 'linux', arch: 'x64', recommendation: REC, running, system: null, managedInstalled: false, freeBytes: 100e9,
  endpoints: { usual: endpoint, alt: managedEndpoints().alt },
});

beforeAll(async () => {
  if (!can) return;
  mine = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(req.url === '/api/version' ? { version: OLLAMA_VERSION } : { models: [{ name: REF }] }));
  });
  await new Promise((r) => mine.listen(0, '127.0.0.1', r));
  mineAt = `http://127.0.0.1:${mine.address().port}`;
  const theirs = spawn('unshare', [...AS_ANOTHER, process.execPath, '-e', RESPONDER], { cwd: '/', stdio: ['ignore', 'pipe', 'ignore'] });
  const port = await new Promise((resolve, reject) => {
    theirs.stdout.once('data', (chunk) => resolve(Number(String(chunk).trim())));
    theirs.once('exit', () => reject(new Error('the other account\'s responder did not start')));
    setTimeout(() => reject(new Error('the other account\'s responder named no port')), 15_000);
  });
  theirsAt = `http://127.0.0.1:${port}`;
}, 30_000);
afterAll(async () => {
  if (theirsAt) await fetch(`${theirsAt}/quit`).catch(() => {});
  if (mine) await new Promise((r) => mine.close(r));
});

describe.skipIf(!can)('a server answering where Ollama would', () => {
  it('run by this account: used as it is, and the plan adopts it', async () => {
    expect(REF).toMatch(/^hf\.co\//);
    const state = await serverState(mineAt);
    expect(state).toEqual({ up: true, version: OLLAMA_VERSION, models: [REF] });
    expect(usableServer(state)).toBe(true);
    expect(planFor(state, mineAt)).toMatchObject({ supported: true, server: 'running', managed: false, endpoint: mineAt });
  });

  it('run by another account: it really answers as a newer Ollama holding the model, and is never used', async () => {
    const said = await (await fetch(`${theirsAt}/api/version`)).json();
    expect(said).toEqual({ version: '9.9.9' });
    const state = await serverState(theirsAt);
    expect(state).toMatchObject({ up: true, foreign: true, version: null, models: [] });
    expect(state.ownerUid).not.toBe(process.getuid());
    expect(usableServer(state)).toBe(false);
    const plan = planFor(state, theirsAt);
    expect(plan.server).toBe('download');
    expect(plan.managed).toBe(true);
    expect(plan.endpoint).not.toBe(theirsAt);
    expect(plan.notes.join(' ')).toMatch(/run by another account on this computer/);
    expect(plan.steps.map((s) => s.id)).toEqual(['download', 'unpack', 'start', 'pull', 'verify']);
  });

  it('a saved route is checked again at start: another account\'s is refused for every model request, this account\'s is not', async () => {
    try {
      const found = await checkSavedRoutes([mineAt, theirsAt, 'https://api.example.com/v1', 'http://127.0.0.1:1', null]);
      expect(found).toEqual([{ endpoint: theirsAt, uid: expect.any(Number) }]);
      expect(() => assertRouteOwned(mineAt)).not.toThrow();
      expect(() => assertRouteOwned(theirsAt)).toThrow(/run by another account on this computer/);
      const route = { provider: 'ollama', endpoint: theirsAt, model: REF, source: 'harness' };
      await expect(createStreamRequest([{ role: 'user', content: 'hello' }], { route })).rejects.toThrow(/run by another account/);
    } finally {
      clearRouteRefusals();
    }
    expect(() => assertRouteOwned(theirsAt)).not.toThrow();
  });

  it('read the macOS way (lsof, which this computer has): this account\'s server is used, another account\'s is never adopted', async () => {
    expect(await serverState(mineAt, { platform: 'darwin' })).toEqual({ up: true, version: OLLAMA_VERSION, models: [REF] });
    expect(await serverState(theirsAt, { platform: 'darwin' })).toMatchObject({ up: true, foreign: true, models: [] });
  });

  it('where the owner cannot be read the Windows way (no such commands here), what answers is never adopted', async () => {
    expect(await serverState(mineAt, { platform: 'win32' })).toMatchObject({ up: true, foreign: true, ownerUid: null, models: [] });
  });
});
