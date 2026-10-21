/**
 * The being's own records, opened (self-records-tools.js) — journal_read,
 * chats_list, chat_read, charter_read — through a WHOLE real turn: the real
 * catalog (the mind family carries them), the real dispatch and policy gate,
 * real encrypted lanes, a real charter in the real house store, over a real
 * loopback provider that streams the native calls. No mock (RULE 0); no
 * weights run — the model's choices are scripted, everything after is real.
 *
 * Claims: each door returns the being's own record; the charter is the ONE
 * its operator's house wrote (another house's never reaches it); a chat that
 * is not the being's own is refused; the doors stand in the turn's catalog.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { startLocalProvider } from '../helpers/local-provider.js';
import { claimOwner } from '../helpers/claim-owner.js';

const ENV_DOORS = ['WORKSPACES_ROOT', 'NEUMA_PROVIDER_CREDENTIALS_PATH', 'NEUMA_ROUTES_PATH', 'DNA_ENCRYPTION_KEY', 'NEUMA_CMO_PATH', 'NEUMA_DATA_ROOT'];
const LANE = 'recordsbeing';
const MODEL = 'qwen2.5-7b-instruct';
const WALLET = '0x2222222222222222222222222222222222222222';
const OTHER_HOUSE = '0x3333333333333333333333333333333333333333';

let root, saved, savedHouse, savedRealm, savedConfig, provider, llm, realm, catalog;

beforeAll(async () => {
  saved = Object.fromEntries(ENV_DOORS.map((key) => [key, process.env[key]]));
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'self-records-'));
  const settings = path.join(root, 'settings');
  await fs.mkdir(settings, { recursive: true });
  Object.assign(process.env, {
    DNA_ENCRYPTION_KEY: 'self-records-test-key-long-enough-for-aes',
    WORKSPACES_ROOT: path.join(root, 'house'),
    NEUMA_PROVIDER_CREDENTIALS_PATH: path.join(settings, 'credentials.json'),
    NEUMA_ROUTES_PATH: path.join(settings, 'routes.json'),
    NEUMA_CMO_PATH: path.join(settings, 'cmo.json'),
    NEUMA_DATA_ROOT: path.join(root, 'data'),
  });
  const ws = await import('../../core/workspace/neuma-workspace.js');
  llm = await import('../../backend/services/llm-provider.js');
  realm = await import('../../backend/services/user-realm.js');
  savedHouse = ws.getWorkspacesRoot();
  savedRealm = realm.getRealmRoot();
  savedConfig = llm.getConfig();
  ws.setWorkspacesRoot(process.env.WORKSPACES_ROOT);
  realm.setRealmRoot(path.join(root, 'realm'));
  const workspace = ws.default;
  await workspace.create(LANE);
  await workspace.writeDNA(LANE, { version: '1.0.0', identity: { name: 'Ondine', essence: 'Ondine, summoned for a records proof.' } });
  await fs.writeFile(path.join(workspace.pathFor(LANE), 'dna', 'genesis.md'), '# Ondine\nOndine, summoned for a records proof.\n');
  await claimOwner(process.env.WORKSPACES_ROOT, LANE, WALLET);
  await workspace.addJournalEntry(LANE, { type: 'benchmark', content: 'Self-check ran while the Marigold archive was reindexed.' });
  await workspace.addJournalEntry(LANE, { type: 'tool_call', content: 'read the tide tables' });
  await workspace.appendMessage(LANE, 'sess-old', { role: 'user', content: 'Where does the observatory key hang?' });
  await workspace.appendMessage(LANE, 'sess-old', { role: 'assistant', content: 'Behind the Halvorsen print in the hallway.' });
  const { writeCharter } = await import('../../backend/services/house-clock/charter-store.js');
  await writeCharter(WALLET, { goal: 'Publish the Thessaly almanac every quarter.', seats: [{ laneId: LANE, dailyCap: 3 }] }, { by: WALLET, ownedLanes: [LANE] });
  await writeCharter(OTHER_HOUSE, { goal: 'Another house entirely: the Corvane ledger.', seats: [{ laneId: 'elsewhere', dailyCap: 1 }] }, { by: OTHER_HOUSE, ownedLanes: ['elsewhere'] });

  provider = await startLocalProvider({
    models: [MODEL], contextLength: 131072,
    script: [
      { reply: 'Looking.', toolCalls: [
        { id: 'j', name: 'memory__journal_read', args: { type: 'benchmark' } },
        { id: 'l', name: 'memory__chats_list', args: {} },
        { id: 'r', name: 'memory__chat_read', args: { chat: 'sess-old' } },
        { id: 'x', name: 'memory__chat_read', args: { chat: 'sess-not-mine' } },
        { id: 'c', name: 'house__charter_read', args: {} },
      ] },
      { reply: 'Done.' },
    ],
  });
  llm.setConfig({ provider: 'lm-studio', endpoint: provider.endpoint, apiKey: '', model: MODEL });

  const { streamConsciousness } = await import('../../backend/services/portal-stream.js');
  const { createPortalConnection } = await import('../../backend/services/portal-connection.js');
  let done;
  const complete = new Promise((resolve) => { done = resolve; });
  const connection = createPortalConnection({
    ws: { OPEN: 1, readyState: 1, send: (str) => { if (JSON.parse(str).type === 'consciousness:complete') done(); } },
    walletAddress: WALLET,
  });
  connection.companion = { name: 'Ondine', neumaId: LANE };
  connection.toolMode = 'ask';
  connection._approvalRefusal = 'no card in a test';
  await streamConsciousness(connection, { thought: 'Read your records.' });
  await complete;
  catalog = (connection._turnCatalog || []).map((t) => `${t.server}/${t.name}`);
}, 60_000);

afterAll(async () => {
  await provider?.close();
  if (savedConfig) llm?.setConfig(savedConfig);
  const ws = await import('../../core/workspace/neuma-workspace.js');
  if (savedHouse) ws.setWorkspacesRoot(savedHouse);
  if (savedRealm) realm?.setRealmRoot(savedRealm);
  for (const [key, value] of Object.entries(saved || {})) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  if (root) await fs.rm(root, { recursive: true, force: true });
});

// The tool results the being was handed, as the second completion carried them.
const told = () => JSON.stringify(provider.turns.at(-1)?.messages ?? []);

describe('the being\'s own records, through a real turn', () => {
  it('all four doors stand in the being\'s catalog', () => {
    for (const id of ['memory/journal_read', 'memory/chats_list', 'memory/chat_read', 'house/charter_read']) expect(catalog).toContain(id);
  });

  it('journal_read returns its own journal, counted by type and filtered', () => {
    expect(told()).toContain('Your journal holds 2 entries');
    expect(told()).toContain('Marigold archive');
    expect(told()).not.toContain('read the tide tables');
  });

  it('chats_list and chat_read reach its own past conversation', () => {
    expect(told()).toContain('You have 1 past conversation');
    expect(told()).toContain('Where does the observatory key hang?');
    expect(told()).toContain('Behind the Halvorsen print');
  });

  it('a chat that is not its own is refused', () => {
    expect(told()).toContain('no chat \\"sess-not-mine\\" is yours');
  });

  it('charter_read reads its OWN house\'s charter — never another house\'s', () => {
    expect(told()).toContain('Publish the Thessaly almanac every quarter.');
    expect(told()).toContain('NOT yet approved');
    expect(told()).not.toContain('Corvane');
  });
});
