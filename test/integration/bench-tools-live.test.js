/**
 * BENCHMARKS FROM THE HARNESS, LIVE — asked in plain words, the model finds the
 * bench family, lists the connected repository's benchmarks with its own tool,
 * and answers with real cell ids (Design note, 2026-10-15: […]).
 *
 * RULE 0: the real agent seat (cli/commands/agent.js runAgent), a real temp
 * realm and harness lane, THIS machine's benchmarks repository (read only —
 * nothing is launched), and the real model on :8089 through a pass-through
 * recorder (read only; the lm-studio door, no supervisor).
 *
 * Proven from the wire and the repository, never by the model's word:
 *   1. the model called bench/bench_list (through system/call);
 *   2. its answer names cell ids that exist in the repository's catalog.
 */
import fs from 'fs/promises';
import http from 'http';
import os from 'os';
import path from 'path';
import { Readable } from 'stream';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

const MODEL = 'http://127.0.0.1:8089';
const ENV_DOORS = [
  'WORKSPACES_ROOT', 'WORKSPACES_PIN', 'HARNESS_ROOT', 'WITNESSES_ROOT', 'NEUMA_DATA_ROOT', 'NEUMA_REALM_ROOT',
  'NEUMA_VAULT_ROOT', 'NEUMA_ROOT_LOCK_PATH', 'NEUMA_SECRETS_FILE', 'NEUMA_PROVIDER_CREDENTIALS_PATH',
  'NEUMA_ROUTES_PATH', 'NEUMA_CONNECTIONS_PATH', 'NEUMA_WORKING_SET_PATH', 'NEUMA_CHAT_TOOLS_PATH',
  'NEUMA_DISCOVERY_PORTS', 'DNA_ENCRYPTION_KEY',
];
const TASK = 'Which benchmarks can I run here? Name three of their ids exactly, one per line.';

let root; let saved; let recorder; let liveModel = null; let runAgent; let lanes = {}; let cellIds = [];
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
  try {
    liveModel = (await (await fetch(`${MODEL}/v1/models`, { signal: AbortSignal.timeout(3000) })).json())?.data?.[0]?.id || null;
  } catch { liveModel = null; }
  saved = Object.fromEntries(ENV_DOORS.map((k) => [k, process.env[k]]));
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'tool-hud-live-'));
  const dir = async (n) => { const p = path.join(root, n); await fs.mkdir(p, { recursive: true }); return p; };
  Object.assign(process.env, {
    WORKSPACES_ROOT: await dir('house'), WORKSPACES_PIN: 'env', HARNESS_ROOT: await dir('harness'),
    WITNESSES_ROOT: await dir('witnesses'), NEUMA_DATA_ROOT: await dir('data'), NEUMA_REALM_ROOT: await dir('realm'),
    NEUMA_VAULT_ROOT: await dir('vault'), NEUMA_ROOT_LOCK_PATH: path.join(root, 'lock.json'),
    NEUMA_SECRETS_FILE: path.join(root, 'secrets.json'), NEUMA_PROVIDER_CREDENTIALS_PATH: path.join(root, 'cred.json'),
    NEUMA_ROUTES_PATH: path.join(root, 'routes.json'), NEUMA_CONNECTIONS_PATH: path.join(root, 'conn.json'),
    NEUMA_WORKING_SET_PATH: path.join(root, 'ws.json'), NEUMA_CHAT_TOOLS_PATH: path.join(root, 'chat-tools.json'),
    NEUMA_DISCOVERY_PORTS: '1', DNA_ENCRYPTION_KEY: 'tool-hud-live-key-long-enough-for-the-law',
  });
  recorder = await startRecorder();
  if (!liveModel) return;
  const { default: workspace, setWorkspacesRoot } = await import('../../core/workspace/neuma-workspace.js');
  setWorkspacesRoot(process.env.WORKSPACES_ROOT);
  const { setHarnessRoot } = await import('../../core/workspace/lane-grounds.js');
  setHarnessRoot(process.env.HARNESS_ROOT);
  const { setCredential } = await import('../../backend/services/provider-credentials.js');
  const { setRoute } = await import('../../backend/services/neuma-routes-store.js');
  const { ensureHarnessLane } = await import('../../backend/services/harness-lane.js');
  const { generateKeypair } = await import('../../core/weave/keypair.js');
  ({ runAgent } = await import('../../cli/commands/agent.js'));
  const { listCells } = await import('../../backend/services/bench/bench-catalog.js');
  cellIds = (await listCells().catch(() => [])).map((c) => c.id);
  await setCredential('lm-studio', { endpoint: `http://127.0.0.1:${recorder.address().port}` });
  const wallet = generateKeypair().address.toLowerCase();
  await workspace.create('hud-being');
  await workspace.writeDNA('hud-being', { version: '1.0.0', identity: { name: 'Hud' } });
  await fs.writeFile(path.join(workspace.pathFor('hud-being'), 'owner.json'), JSON.stringify({ wallet, claimedAt: Date.now() }));
  await setRoute('hud-being', { provider: 'lm-studio', model: liveModel });
  lanes = { being: 'hud-being', harness: (await ensureHarnessLane(wallet, { providerId: 'lm-studio', model: liveModel })).laneId };
}, 60000);

afterAll(async () => {
  await new Promise((resolve) => recorder.close(resolve));
  const { setHarnessRoot } = await import('../../core/workspace/lane-grounds.js');
  setHarnessRoot(null);
  for (const k of ENV_DOORS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  await fs.rm(root, { recursive: true, force: true });
});

test('asked which benchmarks it can run, the harness lists them with its own tool and names real ones', async (ctx) => {
  if (!liveModel || !cellIds.length) ctx.skip();
  const before = seen.length;
  const out = sink(); const stderr = sink();
  const code = await runAgent({
    cwd: process.cwd(), stdin: Readable.from([]), stdout: out, stderr,
    argv: { task: TASK, workspace: lanes.harness, rounds: 6, timeout: 300, yes: true },
  });
  expect(code, stderr.text().slice(-600)).toBe(0);
  const turns = seen.slice(before).filter((body) => (body.messages || []).length > 1);
  const reached = turns.at(-1).messages.filter((m) => m.role === 'assistant' && Array.isArray(m.tool_calls))
    .flatMap((m) => m.tool_calls.map((c) => {
      const args = (() => { try { return JSON.parse(c.function.arguments); } catch { return {}; } })();
      return c.function.name === 'system__call' ? `call→${args.tool}` : `search(${args.query})`;
    }));
  expect(reached).toContain('call→bench/bench_list');
  const named = cellIds.filter((id) => new RegExp(`(^|[^a-z0-9-])${id}([^a-z0-9-]|$)`, 'm').test(out.text()));
  expect(named.length, out.text().slice(-800)).toBeGreaterThanOrEqual(3);
  if (process.env.TOOL_HUD_RECEIPT) await fs.appendFile(process.env.TOOL_HUD_RECEIPT, `bench: ${reached.join(' · ')} · named ${named.slice(0, 5).join(', ')}\n`);
}, 600000);
