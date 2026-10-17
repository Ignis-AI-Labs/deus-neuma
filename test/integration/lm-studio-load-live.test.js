/**
 * A HARNESS ON LM STUDIO, LIVE — a downloaded model nobody loaded still answers
 * (Design note, 2026-10-14: the harness said […] —
 * LM Studio held 44 downloaded models, none loaded, and its own JIT loading
 * was off: […]).
 *
 * RULE 0: this machine's real LM Studio (:1234), the real agent seat
 * (cli/commands/agent.js runAgent), a real harness lane routed to LM Studio
 * with its SMALLEST downloaded chat model — light on the GPU — on a temp realm.
 * Skips when LM Studio is not serving, or the model is already loaded (it
 * would prove nothing and must not be unloaded from under its user). Then
 * FREE (local-server-release.js) unloads it — only when nothing else of the
 * user's is loaded, since FREE unloads everything LM Studio holds.
 */
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { Readable } from 'stream';
import { afterAll, beforeAll, expect, test } from 'vitest';

const LM = 'http://127.0.0.1:1234';
const ENV_DOORS = [
  'WORKSPACES_ROOT', 'WORKSPACES_PIN', 'HARNESS_ROOT', 'WITNESSES_ROOT', 'NEUMA_DATA_ROOT', 'NEUMA_REALM_ROOT',
  'NEUMA_VAULT_ROOT', 'NEUMA_ROOT_LOCK_PATH', 'NEUMA_SECRETS_FILE', 'NEUMA_PROVIDER_CREDENTIALS_PATH',
  'NEUMA_ROUTES_PATH', 'NEUMA_CONNECTIONS_PATH', 'NEUMA_WORKING_SET_PATH', 'NEUMA_CHAT_TOOLS_PATH',
  'NEUMA_DISCOVERY_PORTS', 'DNA_ENCRYPTION_KEY',
];
const catalog = async () => (await (await fetch(`${LM}/api/v1/models`, { signal: AbortSignal.timeout(3000) })).json()).models || [];

let root; let saved; let small = null; let lane = null; let runAgent; let othersLoaded = true;

beforeAll(async () => {
  try {
    small = (await catalog()).filter((m) => m.type === 'llm' && m.size_bytes)
      .sort((a, b) => a.size_bytes - b.size_bytes)[0] || null;
  } catch { small = null; }
  if (small?.loaded_instances?.length) small = null;
  // FREE unloads EVERY model LM Studio holds — proven only when nothing of its user's is loaded
  try { othersLoaded = (await catalog()).some((m) => m.loaded_instances?.length); } catch { othersLoaded = true; }
  saved = Object.fromEntries(ENV_DOORS.map((k) => [k, process.env[k]]));
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'lm-studio-load-live-'));
  const dir = async (n) => { const p = path.join(root, n); await fs.mkdir(p, { recursive: true }); return p; };
  Object.assign(process.env, {
    WORKSPACES_ROOT: await dir('house'), WORKSPACES_PIN: 'env', HARNESS_ROOT: await dir('harness'),
    WITNESSES_ROOT: await dir('witnesses'), NEUMA_DATA_ROOT: await dir('data'), NEUMA_REALM_ROOT: await dir('realm'),
    NEUMA_VAULT_ROOT: await dir('vault'), NEUMA_ROOT_LOCK_PATH: path.join(root, 'lock.json'),
    NEUMA_SECRETS_FILE: path.join(root, 'secrets.json'), NEUMA_PROVIDER_CREDENTIALS_PATH: path.join(root, 'cred.json'),
    NEUMA_ROUTES_PATH: path.join(root, 'routes.json'), NEUMA_CONNECTIONS_PATH: path.join(root, 'conn.json'),
    NEUMA_WORKING_SET_PATH: path.join(root, 'ws.json'), NEUMA_CHAT_TOOLS_PATH: path.join(root, 'chat-tools.json'),
    NEUMA_DISCOVERY_PORTS: '1', DNA_ENCRYPTION_KEY: 'lm-studio-load-live-key-long-enough-for-the-law',
  });
  if (!small) return;
  const { setHarnessRoot } = await import('../../core/workspace/lane-grounds.js');
  setHarnessRoot(process.env.HARNESS_ROOT);
  const { setCredential } = await import('../../backend/services/provider-credentials.js');
  const { ensureHarnessLane } = await import('../../backend/services/harness-lane.js');
  const { generateKeypair } = await import('../../core/weave/keypair.js');
  ({ runAgent } = await import('../../cli/commands/agent.js'));
  await setCredential('lm-studio', { endpoint: LM });
  lane = (await ensureHarnessLane(generateKeypair().address.toLowerCase(), { providerId: 'lm-studio', model: small.key })).laneId;
}, 60000);

afterAll(async () => {
  if (small) {
    const mine = (await catalog().catch(() => [])).find((m) => m.key === small.key)?.loaded_instances || [];
    for (const { id } of mine) {
      await fetch(`${LM}/api/v1/models/unload`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ instance_id: id }),
      }).catch(() => {});
    }
  }
  const { setHarnessRoot } = await import('../../core/workspace/lane-grounds.js');
  setHarnessRoot(null);
  for (const k of ENV_DOORS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  await fs.rm(root, { recursive: true, force: true });
});

test('the harness turn loads the chosen model in LM Studio, then the model answers', async (ctx) => {
  if (!small) ctx.skip();
  const out = []; const err = [];
  const sink = (into) => ({ write: (c) => { into.push(String(c)); return true; } });
  const code = await runAgent({
    cwd: process.cwd(), stdin: Readable.from([]), stdout: sink(out), stderr: sink(err),
    argv: { task: 'What is the capital of France? Answer with the city name only.', workspace: lane, rounds: 2, timeout: 600, yes: true },
  });
  expect(code, err.join('').slice(-800)).toBe(0);
  expect((await catalog()).find((m) => m.key === small.key)?.loaded_instances?.length).toBeGreaterThan(0);
  expect(out.join('')).toMatch(/paris/i);
}, 900000);

test('FREE gives LM Studio\'s memory back: the model this test loaded is unloaded', async (ctx) => {
  if (!small || othersLoaded) ctx.skip();
  const { releaseLocalServer } = await import('../../backend/services/local-server-release.js');
  const before = (await catalog()).find((m) => m.key === small.key)?.loaded_instances?.length || 0;
  if (!before) ctx.skip(); // the turn above did not leave it loaded — nothing to prove here
  const freed = await releaseLocalServer({ providerId: 'lm-studio', endpoint: LM });
  expect(freed).toMatchObject({ ok: true });
  expect(freed.freed.length).toBeGreaterThan(0);
  expect((await catalog()).every((m) => !m.loaded_instances?.length)).toBe(true);
}, 120000);
