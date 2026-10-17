/**
 * A DESK RESTART NEVER ASKS A RUNNING SERVER AGAIN (2026-10-13), proven over
 * real HTTP (RULE 0). The reasoning-shape probe is a real completion, and on
 * llama.cpp each one takes a slot by LRU — the slot holding the oldest parked
 * chat. Live, every desk start asked once per bound being: the asks took all
 * four slots and Founder's 128k-token chat re-read itself (69 s).
 *
 * A loopback server answers the probe as llama.cpp does (a reasoning field,
 * `Server: llama.cpp`) and counts every ask; the machine claim names it, as
 * the supervisor's launch does.
 */
import { createServer } from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { getThinkBehavior, expireRuntimeModelCaches } from '../../backend/services/llm-provider.js';
import { writeClaim, clearClaim } from '../../backend/services/substrate-claim-registry.js';
import { servedInstance, _forgetKeptShapes } from '../../backend/services/think-shape-store.js';
import { isThinkProbe } from '../helpers/think-probe.js';

const LLAMA_SHAPE = { thinks: true, implicitOpen: false, serverBudget: true };
const NO_SHAPE = { thinks: false, implicitOpen: false };

let server, port, asks, failNext, claimDir, priorClaimDir;

beforeEach(async () => {
  asks = 0;
  failNext = false;
  priorClaimDir = process.env.NEUMA_SUBSTRATE_CLAIM_DIR;
  claimDir = await fs.mkdtemp(path.join(os.tmpdir(), 'think-shape-claim-'));
  process.env.NEUMA_SUBSTRATE_CLAIM_DIR = claimDir;
  await fs.rm(process.env.NEUMA_THINK_SHAPES_PATH, { force: true });
  _forgetKeptShapes();
  expireRuntimeModelCaches();
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : null;
      if (req.method !== 'POST' || !isThinkProbe(body)) return res.writeHead(404).end();
      asks += 1;
      if (failNext) {
        failNext = false;
        return res.writeHead(503).end();
      }
      res.writeHead(200, { 'Content-Type': 'application/json', Server: 'llama.cpp' });
      return res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'ready', reasoning_content: 'One word: ready.' }, finish_reason: 'stop' }] }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
});

afterEach(async () => {
  clearClaim();
  if (priorClaimDir === undefined) delete process.env.NEUMA_SUBSTRATE_CLAIM_DIR;
  else process.env.NEUMA_SUBSTRATE_CLAIM_DIR = priorClaimDir;
  await fs.rm(claimDir, { recursive: true, force: true });
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  expireRuntimeModelCaches();
});

// Each bound being reaches the supervised server by its own route.
const beingRoutes = () => [
  { provider: 'custom', endpoint: `http://127.0.0.1:${port}`, model: '/proc/self/fd/4', apiKey: '', accountId: 'metidar' },
  { provider: 'custom', endpoint: `http://localhost:${port}`, model: '/proc/self/fd/4', apiKey: '', accountId: 'keir' },
  { provider: 'custom', endpoint: `http://127.0.0.1:${port}/`, model: '/proc/self/fd/4', apiKey: '', accountId: 'signal' },
  { provider: 'custom', endpoint: `http://127.0.0.1:${port}`, model: '/proc/self/fd/4', apiKey: '' },
];
const restartDesk = () => { _forgetKeptShapes(); expireRuntimeModelCaches(); };

describe('the supervised server is asked its reasoning shape once — never again at a desk restart', () => {
  test('every bound being shares one ask; a restarted desk reads the kept shape; a relaunched server is asked again', async () => {
    writeClaim(process.pid, port, {});
    const routes = beingRoutes();
    // The desk binds every being at once — each warm-up wants the shape.
    expect(await Promise.all(routes.map((route) => getThinkBehavior(route)))).toEqual(routes.map(() => LLAMA_SHAPE));
    expect(asks).toBe(1);

    // The desk restarts onto the same running server: nothing is asked.
    restartDesk();
    expect(await Promise.all(routes.map((route) => getThinkBehavior(route)))).toEqual(routes.map(() => LLAMA_SHAPE));
    expect(asks).toBe(1);

    // The model server relaunches — a new claim, its slots empty: asked once more.
    await new Promise((resolve) => setTimeout(resolve, 5));
    clearClaim();
    writeClaim(process.pid, port, {});
    expect(await getThinkBehavior(routes[1])).toEqual(LLAMA_SHAPE);
    expect(asks).toBe(2);
  });

  test('a failed ask is never kept — the next one asks again', async () => {
    writeClaim(process.pid, port, {});
    const [route] = beingRoutes();
    failNext = true;
    expect(await getThinkBehavior(route)).toEqual(NO_SHAPE);
    restartDesk();
    expect(await getThinkBehavior(route)).toEqual(LLAMA_SHAPE);
    expect(asks).toBe(2);
  });

  test('a server NEUMA holds no claim for keeps the old way: one ask in flight, nothing kept on disk', async () => {
    const [route] = beingRoutes();
    await Promise.all([getThinkBehavior(route), getThinkBehavior(route), getThinkBehavior(route)]);
    expect(asks).toBe(1);
    await expect(fs.access(process.env.NEUMA_THINK_SHAPES_PATH)).rejects.toThrow();
    restartDesk();
    expect(await getThinkBehavior(route)).toEqual(LLAMA_SHAPE);
    expect(asks).toBe(2);
  });

  test('the instance is the claimed loopback port, whatever the provider label — never another host', () => {
    writeClaim(process.pid, port, {});
    const local = servedInstance({ provider: 'llama-server', endpoint: `http://127.0.0.1:${port}` });
    expect(local).toMatch(new RegExp(`^served::${process.pid}::`));
    expect(servedInstance({ provider: 'custom', endpoint: `http://localhost:${port}` })).toBe(local);
    expect(servedInstance({ provider: 'llama-server', endpoint: `http://10.0.0.5:${port}` })).toBeNull();
    expect(servedInstance({ provider: 'custom', endpoint: `https://api.example.com:${port}` })).toBeNull();
    expect(servedInstance({ provider: 'lm-studio', endpoint: `http://127.0.0.1:${port}` })).toBeNull();
    expect(servedInstance({ provider: 'custom', endpoint: `http://127.0.0.1:${port + 1}` })).toBeNull();
  });
});
