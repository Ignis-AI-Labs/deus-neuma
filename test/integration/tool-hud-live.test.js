/**
 * THE TOOL HUD, LIVE — with two doors on the wire, a real model still finds
 * and uses its tools (Design note, 2026-10-14: […]).
 *
 * RULE 0: the real agent seat (cli/commands/agent.js runAgent — the same entry
 * the benchmark proxy and the desk's turn share), a real temp realm, a real
 * being and a real harness lane, and the real model on :8089 reached through
 * a pass-through recorder (read only; the lm-studio door, no supervisor).
 *
 * Each seat is handed a folder holding a file and asked to read it and write a
 * derived answer to a new file. Proven on DISK, never by the model's word:
 *   1. the answer file holds the right content;
 *   2. every request's wire carried exactly the two doors — nothing more,
 *      never growing round to round (no chat re-read for a tool);
 *   3. the work went through system/call (the door), unwrapped to the real tool.
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
const TASK = 'In your ground there is a file named notes.txt. Read it, then write a new file named answer.txt in the same folder containing ONLY its first line in capital letters. Then say "done".';

let root; let saved; let recorder; let liveModel = null; let runAgent; let lanes = {};
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

describe.each(['harness', 'being'])('the %s, holding only the two doors', (seat) => {
  test('reads a file and writes the answer — through system/call, on a wire that never changed', async (ctx) => {
    if (!liveModel) ctx.skip();
    const ground = await fs.mkdtemp(path.join(root, `ground-${seat}-`));
    await fs.writeFile(path.join(ground, 'notes.txt'), 'lantern\nsecond line\n');
    const before = seen.length;
    const stderr = sink();
    const code = await runAgent({
      cwd: process.cwd(), stdin: Readable.from([]), stdout: sink(), stderr,
      argv: { task: TASK, workspace: lanes[seat], ground, rounds: 8, timeout: 300, yes: true },
    });
    expect(code, stderr.text().slice(-600)).toBe(0);

    // 1. ON DISK: the answer is right
    expect((await fs.readFile(path.join(ground, 'answer.txt'), 'utf8')).trim()).toBe('LANTERN');

    // 2. THE WIRE: every request carried exactly the two doors, never more
    const turns = seen.slice(before).filter((body) => (body.messages || []).length > 1);
    expect(turns.length).toBeGreaterThan(1); // it used tools: more than one round
    for (const body of turns) {
      expect((body.tools || []).map((t) => t.function?.name).sort()).toEqual(['system__call', 'system__tool_search']);
    }

    // 3. THE DOOR: the model's own calls went through system/call
    const doorCalls = turns.flatMap((body) => (body.messages || [])
      .filter((m) => m.role === 'assistant' && Array.isArray(m.tool_calls))
      .flatMap((m) => m.tool_calls.map((c) => c.function?.name)));
    expect(doorCalls).toContain('system__call');
    // what it reached for, in order — a receipt for the reader
    const reached = turns.at(-1).messages.filter((m) => m.role === 'assistant' && Array.isArray(m.tool_calls))
      .flatMap((m) => m.tool_calls.map((c) => {
        const args = (() => { try { return JSON.parse(c.function.arguments); } catch { return {}; } })();
        return c.function.name === 'system__call' ? `call→${args.tool}` : `search(${args.query})`;
      }));
    if (process.env.TOOL_HUD_RECEIPT) await fs.appendFile(process.env.TOOL_HUD_RECEIPT, `${seat}: ${reached.join(' · ')} · ${turns.length} requests\n`);
  }, 600000);
});
