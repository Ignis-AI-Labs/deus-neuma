/* global process, setTimeout */
// One setup job, even at two presses; a record that always lands; a failure told plainly. The REAL
// job (managed-ollama.js startJob with no plan, exactly what POST /install calls) reads the REAL
// machine (substrate-setup's hardware read, the discovery sweep pinned to one port) and talks over
// real HTTP to a loopback server answering Ollama 0.40.7's own endpoints with the shapes the live
// 0.40.7 answers (/api/version, /api/tags, /api/chat), counting every chat. The real provider
// choice and record land on a real disk. No mocks (RULE 0). The real Ollama, a real model pull and
// a restart are proven live (docs/work/model-setup-bulletproof-linux.md).
//
// On the old code (2026-10-23) two presses started two jobs: two answer checks, and
// […] as both renamed one tmp.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createTempDir } from '../helpers/temp-fs.js';

const ENV_KEYS = ['NEUMA_DATA_ROOT', 'NEUMA_OLLAMA_ENDPOINT', 'NEUMA_DISCOVERY_PORTS', 'NEUMA_MODEL_BUDGET_GB', 'NEUMA_PROVIDER_CHOICE_PATH', 'LLAMA_SERVER_URL'];
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
let server; let dataRoot; let choicePath; let endpoint; let ref; let chats = 0; let chatMode = 'answer';
let M;

const ollama = (req, res) => {
  const json = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(body)); };
  if (req.url === '/api/version') return json(200, { version: '0.40.7' });
  if (req.url === '/api/tags') return json(200, { models: [{ name: ref, model: ref, size: 2_800_000_000 }] });
  if (req.url === '/api/chat' && req.method === 'POST') {
    chats += 1;
    return req.on('data', () => {}).on('end', () => (chatMode === 'answer'
      ? json(200, { model: ref, created_at: new Date().toISOString(), message: { role: 'assistant', content: 'ready' }, done: true, done_reason: 'stop' })
      : json(500, { error: 'model requires more system memory (9.1 GiB) than is available (3.2 GiB)' })));
  }
  return json(404, { error: 'not found' });
};

const settle = async () => {
  for (let i = 0; i < 600 && M.jobStatus().state === 'running'; i += 1) await new Promise((r) => setTimeout(r, 100));
  return M.jobStatus();
};

beforeAll(async () => {
  dataRoot = await createTempDir('managed-ollama-job');
  choicePath = path.join(dataRoot, 'settings-store', 'llm-provider.json');
  server = http.createServer(ollama);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  endpoint = `http://127.0.0.1:${port}`;
  Object.assign(process.env, {
    NEUMA_DATA_ROOT: dataRoot,
    NEUMA_OLLAMA_ENDPOINT: endpoint,
    NEUMA_DISCOVERY_PORTS: String(port),
    NEUMA_MODEL_BUDGET_GB: '16', // the smallest card with a recommendation (12 GB is the minimum; its rung waits on its gate)
    NEUMA_PROVIDER_CHOICE_PATH: choicePath,
    LLAMA_SERVER_URL: 'http://127.0.0.1:9',
  });
  // the model this machine is matched to, as the plan will name it
  const { getSetupStatus } = await import('../../backend/services/substrate-setup.js');
  const { ollamaModelRef, pullableChoice } = await import('../../backend/services/managed-ollama-plan.js');
  ref = ollamaModelRef(pullableChoice((await getSetupStatus()).recommendation).choice);
  M = await import('../../backend/services/managed-ollama.js');
}, 60_000);
afterAll(async () => {
  await new Promise((r) => server.close(r));
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

describe('the setup job', () => {
  it('two presses make ONE job: one answer check, the route adopted, the record whole', async () => {
    expect(ref).toMatch(/^hf\.co\//);
    const [a, b] = await Promise.all([M.startJob(), M.startJob()]);
    expect(a.state).toBe('running');
    expect(b).toBe(a);
    const done = await settle();
    expect(done).toMatchObject({ state: 'done', error: null });
    expect(chats).toBe(1);
    expect(JSON.parse(fs.readFileSync(choicePath, 'utf8'))).toMatchObject({ provider: 'ollama', endpoint, model: ref, chosenBy: 'operator' });
    expect(M.readRecord()).toMatchObject({ endpoint, model: ref, version: '0.40.7', managed: false });
    expect(fs.readdirSync(path.join(dataRoot, 'model-server')).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  }, 60_000);

  it('the model-server folder deleted: the next setup makes it again and its record lands', async () => {
    fs.rmSync(path.join(dataRoot, 'model-server'), { recursive: true, force: true });
    chats = 0;
    await M.startJob();
    expect(await settle()).toMatchObject({ state: 'done', error: null });
    expect(M.readRecord()).toMatchObject({ endpoint, model: ref });
  }, 60_000);

  it('a model that will not answer is tried once more by the job itself, then told in plain words, the cause kept apart', async () => {
    chatMode = 'refuse';
    chats = 0;
    await M.startJob();
    const failed = await settle();
    expect(chats).toBe(2);
    expect(failed.state).toBe('failed');
    expect(failed.error).toBe('The model is downloaded but did not answer a test message. Close other programs to free memory, then press TRY AGAIN.');
    expect(failed.detail).toMatch(/more system memory/);
    chatMode = 'answer';
  }, 60_000);
});
