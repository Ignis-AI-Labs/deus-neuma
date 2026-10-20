/**
 * THE SELF-CHECK SITTING through a WHOLE real turn — streamConsciousness on
 * the one connection factory, real encrypted workspace on temp disk, real
 * recall, real policy cascade, real tool dispatch, over a real loopback
 * OpenAI-wire provider that streams native tool calls (local-provider.js).
 * No mock on any claimed path (RULE 0). No weights run: the model's choices
 * are scripted; everything the platform does with them is real.
 *
 * Claims (Design note, 2026-10-19 — the being's own flight check reads, never writes):
 *   - a memory read runs and returns the being's own planted memory;
 *   - a write in the same round (memory_note, fs/write) is refused with the
 *     self-check reason, in the order called;
 *   - every byte under the temp root is identical after the turn — no session,
 *     no observation, no mind residue, no usual-tools record, no card;
 *   - the control: the SAME scripted turn as an ordinary chat does write,
 *     so the snapshot is able to see a write at all.
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import crypto from 'crypto';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { startLocalProvider } from '../helpers/local-provider.js';
import { claimOwner } from '../helpers/claim-owner.js';

const ENV_DOORS = [
  'WORKSPACES_ROOT', 'NEUMA_PROVIDER_CREDENTIALS_PATH', 'NEUMA_ROUTES_PATH', 'NEUMA_REALM_ROOT',
  'DNA_ENCRYPTION_KEY', 'NEUMA_CMO_PATH', 'NEUMA_DATA_ROOT',
];
const LANE = 'selfcheck-being';
const MODEL = 'qwen2.5-7b-instruct';
const WALLET = '0x1111111111111111111111111111111111111111';
const PLANTED = 'The lighthouse keeper who taught me the tide tables was named Ottoline.';

// impure — sha256 of every file under root, keyed by relative path.
const snapshot = async (root) => {
  const out = {};
  const walk = async (dir) => {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) out[path.relative(root, full)] = crypto.createHash('sha256').update(await fs.readFile(full)).digest('hex');
    }
  };
  await walk(root);
  return out;
};

const changedPaths = (before, after) => [...new Set([...Object.keys(before), ...Object.keys(after)])]
  .filter((key) => before[key] !== after[key]).sort();

const SCRIPT = [
  { reply: 'Let me look.', toolCalls: [
    { id: 'c1', name: 'memory__memory_search', args: { query: 'lighthouse keeper tide tables' } },
    { id: 'c2', name: 'memory__memory_note', args: { content: 'I was asked about the lighthouse keeper.' } },
    { id: 'c3', name: 'fs__write', args: { path: 'notes/check.md', content: 'written during a self-check' } },
  ] },
  { reply: 'The keeper was Ottoline.' },
];

let root;
let provider;
let saved;
let savedConfig;
let savedHouse;
let api;

describe('the self-check sitting (a whole real turn)', () => {
  beforeAll(async () => {
    saved = Object.fromEntries(ENV_DOORS.map((key) => [key, process.env[key]]));
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'self-check-sitting-'));
    const settings = path.join(root, 'settings');
    await fs.mkdir(settings, { recursive: true });
    Object.assign(process.env, {
      DNA_ENCRYPTION_KEY: 'self-check-sitting-test-key-long-enough',
      WORKSPACES_ROOT: path.join(root, 'house'),
      NEUMA_PROVIDER_CREDENTIALS_PATH: path.join(settings, 'credentials.json'),
      NEUMA_ROUTES_PATH: path.join(settings, 'routes.json'),
      NEUMA_REALM_ROOT: path.join(settings, 'realm'),
      NEUMA_CMO_PATH: path.join(settings, 'cmo.json'),
      NEUMA_DATA_ROOT: path.join(root, 'data'),
    });
    const ws = await import('../../core/workspace/neuma-workspace.js');
    const llm = await import('../../backend/services/llm-provider.js');
    savedHouse = ws.getWorkspacesRoot();
    ws.setWorkspacesRoot(process.env.WORKSPACES_ROOT);
    savedConfig = llm.getConfig();
    const workspace = ws.default;
    await workspace.create(LANE);
    await workspace.writeDNA(LANE, { version: '1.0.0', identity: { name: 'Ondine', essence: 'Ondine, summoned for a self-check proof.' } });
    await fs.writeFile(path.join(workspace.pathFor(LANE), 'dna', 'genesis.md'), '# Ondine\nOndine, summoned for a self-check proof.\n');
    await claimOwner(process.env.WORKSPACES_ROOT, LANE, WALLET);
    await workspace.addObservation(LANE, {
      type: 'exchange', userMessage: 'Who taught you the tides?', response: PLANTED, significance: 0.9,
    });
    api = {
      llm,
      ...(await import('../../backend/services/self-check/self-check-turn.js')),
      ...(await import('../../backend/services/self-check/self-check-sitting.js')),
    };
  }, 60_000);

  afterAll(async () => {
    await provider?.close();
    if (savedConfig) api?.llm.setConfig(savedConfig);
    const ws = await import('../../core/workspace/neuma-workspace.js');
    if (savedHouse) ws.setWorkspacesRoot(savedHouse);
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    if (root) await fs.rm(root, { recursive: true, force: true });
  });

  const useScript = async () => {
    await provider?.close();
    // A model id the capability registry knows (native tools, a real window) — as the house serves one.
    provider = await startLocalProvider({ script: SCRIPT, models: [MODEL], contextLength: 131072 });
    api.llm.setConfig({ provider: 'lm-studio', endpoint: provider.endpoint, apiKey: '', model: MODEL });
  };

  test('reads run, writes are refused in the order called, and not one byte changes', async () => {
    await useScript();
    const before = await snapshot(root);
    const result = await api.askSelfCheckItem({ neumaId: LANE, name: 'Ondine', wallet: WALLET, question: 'Who taught you the tide tables?' });
    const after = await snapshot(root);

    expect(result.answer).toContain('Ottoline');
    const byTool = Object.fromEntries(result.acts.map((act) => [act.tool, act]));
    expect(byTool['memory/memory_search']?.status).not.toBe('denied');
    // The read reached the being's own record — the second completion carries its result.
    expect(JSON.stringify(provider.turns.at(-1))).toContain('Ottoline');
    // The writes never ran: the model was told why, in its own tool results.
    const told = JSON.stringify(provider.turns.at(-1));
    expect(told).toContain('read-only self-check');
    expect(changedPaths(before, after)).toEqual([]);
  }, 60_000);

  test('the control: the same scripted turn as an ordinary chat leaves a record', async () => {
    await useScript();
    const { streamConsciousness } = await import('../../backend/services/portal-stream.js');
    const { createPortalConnection } = await import('../../backend/services/portal-connection.js');
    const before = await snapshot(root);
    let done;
    const complete = new Promise((resolve) => { done = resolve; });
    const connection = createPortalConnection({
      ws: { OPEN: 1, readyState: 1, send: (str) => { if (JSON.parse(str).type === 'consciousness:complete') done(); } },
      walletAddress: WALLET,
    });
    connection.companion = { name: 'Ondine', neumaId: LANE };
    connection.toolMode = 'ask';
    connection._approvalRefusal = 'no card in a test';
    await streamConsciousness(connection, { thought: 'Who taught you the tide tables?' });
    await complete;
    const changed = changedPaths(before, await snapshot(root));
    expect(changed.some((p) => p.includes('sessions'))).toBe(true);
  }, 60_000);
});
