/**
 * VISION-PROOF, LIVE — a six-digit number that exists only as pixels rides the
 * agent transcript in the benchmarks relay's shape (one user message: a text
 * part and an image_url data URI, no tools) to the real model on :8089, on the
 * harness seat and on a being's seat (Design note, 2026-10-16: […]).
 *
 * RULE 0: the real agent seat (cli/commands/agent.js runAgent), a real temp
 * realm, harness lane and being lane, and the real model through a
 * pass-through recorder (read only; the lm-studio door, no supervisor).
 * Summoned only: the substrate-live lane by name AND RUN_GPU_ENGINE_TESTS=1
 * (test/helpers/gpu-optin.js) — presence is not consent.
 *
 * Proven from the wire and the receipt, the model's word last:
 *   1. a recorded request carried the PNG's data URI byte for byte;
 *   2. receipt.benchmark.imagesSent is exactly that PNG's {sha256, mediaType, bytes};
 *   3. the answer names the number.
 */
import { createHash } from 'crypto';
import fs from 'fs/promises';
import http from 'http';
import os from 'os';
import path from 'path';
import { Readable } from 'stream';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { pixelPng } from '../helpers/image-fixtures.js';
import { shouldRunGpuEngineTests } from '../helpers/gpu-optin.js';

const MODEL = 'http://127.0.0.1:8089';
const ENV_DOORS = [
  'WORKSPACES_ROOT', 'WORKSPACES_PIN', 'HARNESS_ROOT', 'WITNESSES_ROOT', 'NEUMA_DATA_ROOT', 'NEUMA_REALM_ROOT',
  'NEUMA_VAULT_ROOT', 'NEUMA_ROOT_LOCK_PATH', 'NEUMA_SECRETS_FILE', 'NEUMA_PROVIDER_CREDENTIALS_PATH',
  'NEUMA_ROUTES_PATH', 'NEUMA_CONNECTIONS_PATH', 'NEUMA_WORKING_SET_PATH', 'NEUMA_CHAT_TOOLS_PATH',
  'NEUMA_DISCOVERY_PORTS', 'DNA_ENCRYPTION_KEY',
];

// A 3×5 digit face, drawn ten pixels to the cell, black on white.
const FONT = Object.freeze({
  0: ['111', '101', '101', '101', '111'], 1: ['010', '110', '010', '010', '111'], 2: ['111', '001', '111', '100', '111'],
  3: ['111', '001', '111', '001', '111'], 4: ['101', '101', '111', '001', '001'], 5: ['111', '100', '111', '001', '111'],
  6: ['111', '100', '111', '101', '111'], 7: ['111', '001', '001', '001', '001'], 8: ['111', '101', '111', '101', '111'],
  9: ['111', '101', '111', '001', '111'],
});
const CELL = 10;
const MARGIN = 2;
const digitsPng = (digits) => pixelPng((digits.length * 4 - 1 + MARGIN * 2) * CELL, (5 + MARGIN * 2) * CELL, (x, y) => {
  const cx = Math.floor(x / CELL) - MARGIN;
  const cy = Math.floor(y / CELL) - MARGIN;
  const digit = digits[Math.floor(cx / 4)];
  const ink = cx >= 0 && cy >= 0 && cy < 5 && digit !== undefined && cx % 4 < 3 && FONT[digit][cy][cx % 4] === '1';
  return ink ? [0, 0, 0] : [255, 255, 255];
});

const NUMBER = String(100000 + Math.floor(Math.random() * 900000));
const PNG = digitsPng(NUMBER);
const URI = `data:image/png;base64,${PNG.toString('base64')}`;
const ITEM = [{ role: 'user', content: [
  { type: 'text', text: 'What six-digit number is shown in the image? Answer with the number only.' },
  { type: 'image_url', image_url: { url: URI } },
] }];

let root; let saved; let recorder; let liveModel = null; let runAgent; let lanes = {}; let ground;
const seen = [];

const startRecorder = () => new Promise((resolve) => {
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      if (req.method === 'POST' && req.url.includes('/chat/completions')) {
        try { seen.push(JSON.parse(body.toString('utf8'))); } catch { /* not JSON */ }
      }
      const target = new URL(req.url, MODEL);
      const up = http.request(target, { method: req.method, headers: { ...req.headers, host: target.host } }, (upRes) => {
        res.writeHead(upRes.statusCode, upRes.headers);
        upRes.pipe(res);
      });
      up.on('error', () => { res.writeHead(502); res.end(); });
      up.end(body);
    });
  });
  server.listen(0, '127.0.0.1', () => resolve(server));
});

const sink = () => { const out = []; return { write: (c) => { out.push(String(c)); return true; }, text: () => out.join('') }; };

beforeAll(async () => {
  if (!shouldRunGpuEngineTests()) return;
  try {
    liveModel = (await (await fetch(`${MODEL}/v1/models`, { signal: AbortSignal.timeout(3000) })).json())?.data?.[0]?.id || null;
  } catch { liveModel = null; }
  if (!liveModel) return;
  saved = Object.fromEntries(ENV_DOORS.map((k) => [k, process.env[k]]));
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'vision-transcript-live-'));
  const dir = async (n) => { const p = path.join(root, n); await fs.mkdir(p, { recursive: true }); return p; };
  Object.assign(process.env, {
    WORKSPACES_ROOT: await dir('house'), WORKSPACES_PIN: 'env', HARNESS_ROOT: await dir('harness'),
    WITNESSES_ROOT: await dir('witnesses'), NEUMA_DATA_ROOT: await dir('data'), NEUMA_REALM_ROOT: await dir('realm'),
    NEUMA_VAULT_ROOT: await dir('vault'), NEUMA_ROOT_LOCK_PATH: path.join(root, 'lock.json'),
    NEUMA_SECRETS_FILE: path.join(root, 'secrets.json'), NEUMA_PROVIDER_CREDENTIALS_PATH: path.join(root, 'cred.json'),
    NEUMA_ROUTES_PATH: path.join(root, 'routes.json'), NEUMA_CONNECTIONS_PATH: path.join(root, 'conn.json'),
    NEUMA_WORKING_SET_PATH: path.join(root, 'ws.json'), NEUMA_CHAT_TOOLS_PATH: path.join(root, 'chat-tools.json'),
    NEUMA_DISCOVERY_PORTS: '1', DNA_ENCRYPTION_KEY: 'vision-transcript-live-key-long-enough-for-the-law',
  });
  ground = await dir('ground');
  recorder = await startRecorder();
  const { default: workspace, setWorkspacesRoot } = await import('../../core/workspace/neuma-workspace.js');
  setWorkspacesRoot(process.env.WORKSPACES_ROOT);
  const { setHarnessRoot } = await import('../../core/workspace/lane-grounds.js');
  setHarnessRoot(process.env.HARNESS_ROOT);
  const { setCredential } = await import('../../backend/services/provider-credentials.js');
  const { setRoute } = await import('../../backend/services/neuma-routes-store.js');
  const { ensureHarnessLane } = await import('../../backend/services/harness-lane.js');
  const { generateKeypair } = await import('../../core/weave/keypair.js');
  ({ runAgent } = await import('../../cli/commands/agent.js'));
  await setCredential('lm-studio', { endpoint: `http://127.0.0.1:${recorder.address().port}` });
  const wallet = generateKeypair().address.toLowerCase();
  await workspace.create('sight-being');
  await workspace.writeDNA('sight-being', { version: '1.0.0', identity: { name: 'Sight' } });
  await fs.writeFile(path.join(workspace.pathFor('sight-being'), 'owner.json'), JSON.stringify({ wallet, claimedAt: Date.now() }));
  await setRoute('sight-being', { provider: 'lm-studio', model: liveModel });
  lanes = { being: 'sight-being', harness: (await ensureHarnessLane(wallet, { providerId: 'lm-studio', model: liveModel })).laneId };
}, 60000);

afterAll(async () => {
  if (!root) return;
  await new Promise((resolve) => recorder.close(resolve));
  const { setHarnessRoot } = await import('../../core/workspace/lane-grounds.js');
  setHarnessRoot(null);
  for (const k of ENV_DOORS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  await fs.rm(root, { recursive: true, force: true });
});

for (const seat of ['harness', 'being']) test(`the ${seat} seat reads a number that exists only as pixels`, async (ctx) => {
  if (!liveModel) ctx.skip();
  const before = seen.length;
  const receiptPath = path.join(root, `${seat}-receipt.json`);
  const out = sink(); const stderr = sink();
  const code = await runAgent({
    cwd: process.cwd(), stdin: Readable.from([]), stdout: out, stderr,
    argv: {
      transcript: ITEM, callerTools: [], workspace: lanes[seat], ground, receipt: receiptPath, rounds: 4, timeout: 600, yes: true,
      benchmarkBaseWeights: true, benchmarkSeed: 7, benchmarkTemperature: 0, benchmarkTopP: 1, benchmarkMaxTokens: 8192,
    },
  });
  expect(code, stderr.text().slice(-600)).toBe(0);
  const carried = seen.slice(before).flatMap((body) => body.messages ?? [])
    .flatMap((m) => (Array.isArray(m.content) ? m.content : [])).filter((p) => p.type === 'image_url').map((p) => p.image_url.url);
  expect(carried).toContain(URI);
  const receipt = JSON.parse(await fs.readFile(receiptPath, 'utf8'));
  expect(receipt.benchmark.imagesSent).toEqual([{ sha256: createHash('sha256').update(PNG).digest('hex'), mediaType: 'image/png', bytes: PNG.length }]);
  expect(out.text(), out.text().slice(-400)).toContain(NUMBER);
}, 900000);
