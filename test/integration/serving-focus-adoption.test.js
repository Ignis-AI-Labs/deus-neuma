/**
 * THE FOCUS LAW (Design note, 2026-08-21: the model the operator loaded LAST is the
 * standing focus until HE changes it — no relight may fall past it to an env
 * default. Under test: adoptLiveSelection against a REAL http server (RULE 0
 * — a scripted real server across a real socket, zero mocks) and a REAL
 * catalog on disk. A live answer becomes the selection; a second look is
 * idempotent; a newer load becomes the new focus; a dead server or an
 * unknown model NEVER resets the focus the operator holds.
 *
 * The claim dir is pinned to a temp root (the substrate-test law): this
 * suite must never stomp the live machine's standing selection.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import { promises as fs } from 'fs';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import { getConfig, setConfig } from '../../backend/services/llm-selection.js';
import { adoptLiveSelection } from '../../backend/services/substrate-lifecycle.js';
import { readSelection } from '../../backend/services/substrate-claim-registry.js';

let claimDir, modelsDir, server, port, env, originalConfig, prevClaimDir;
let servedPath; // what the live server claims to have loaded right now

const selectionOnDisk = async () => {
  try {
    return JSON.parse(await fs.readFile(path.join(claimDir, 'substrate-selection.json'), 'utf8'));
  } catch {
    return null;
  }
};

beforeAll(async () => {
  claimDir = await createTempDir('focus-claim');
  modelsDir = await createTempDir('focus-models');
  await fs.writeFile(path.join(modelsDir, 'qwen-test.gguf'), 'GGUF-fixture');
  await fs.writeFile(path.join(modelsDir, 'other-test.gguf'), 'GGUF-fixture');
  servedPath = path.join(modelsDir, 'qwen-test.gguf');

  prevClaimDir = process.env.NEUMA_SUBSTRATE_CLAIM_DIR;
  process.env.NEUMA_SUBSTRATE_CLAIM_DIR = claimDir;

  // A real server speaking the two endpoints the truth channel reads —
  // /health for liveness, /v1/models for what is actually loaded (llama.cpp
  // reports the model PATH as the id, and so does this).
  server = http.createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/health') return res.end(JSON.stringify({ status: 'ok' }));
    if (req.url === '/v1/models') return res.end(JSON.stringify({ data: [{ id: servedPath }] }));
    res.statusCode = 404;
    res.end('{}');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;

  env = { NEUMA_MODELS_DIRS: modelsDir, LLAMA_SERVER_URL: `http://127.0.0.1:${port}` };
  originalConfig = getConfig();
  setConfig({ provider: 'llama-server', endpoint: `http://127.0.0.1:${port}` });
});

afterAll(async () => {
  if (prevClaimDir === undefined) delete process.env.NEUMA_SUBSTRATE_CLAIM_DIR;
  else process.env.NEUMA_SUBSTRATE_CLAIM_DIR = prevClaimDir;
  setConfig(originalConfig);
  await new Promise((resolve) => server.close(resolve));
});

describe('the focus law — the live truth becomes the standing selection', () => {
  it('adopts what the live server actually serves', async () => {
    expect(readSelection()).toBeNull();
    const adopted = await adoptLiveSelection(env);
    expect(adopted).toBe('qwen-test');
    const sel = await selectionOnDisk();
    expect(sel.path).toBe(servedPath);
    expect(sel.key).toBe('qwen-test');
  });

  it('is idempotent — a standing focus is never rewritten for nothing', async () => {
    const before = await selectionOnDisk();
    expect(await adoptLiveSelection(env)).toBeNull();
    expect(await selectionOnDisk()).toEqual(before);
  });

  it('a newer load becomes the new focus — LAST loaded wins', async () => {
    servedPath = path.join(modelsDir, 'other-test.gguf');
    expect(await adoptLiveSelection(env)).toBe('other-test');
    expect((await selectionOnDisk()).key).toBe('other-test');
  });

  it('a model the catalog cannot name never adopts — and never resets the focus', async () => {
    servedPath = '/nonexistent/mystery-model.gguf';
    expect(await adoptLiveSelection(env)).toBeNull();
    expect((await selectionOnDisk()).key).toBe('other-test');
  });

  it('a dead server never resets the focus the operator holds', async () => {
    await new Promise((resolve) => server.close(resolve));
    expect(await adoptLiveSelection(env)).toBeNull();
    expect((await selectionOnDisk()).key).toBe('other-test');
    // relight the fixture server so afterAll's close has a live handle
    await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  });
});
