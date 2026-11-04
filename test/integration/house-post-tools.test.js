/**
 * HOUSE POST through the REAL portal (RULE 0): real WebSocket pair, real tmp
 * workspaces root with a real founding receipt, real realm record for the
 * house ground, real files on real disk. The law under test (Founder
 * 2026-07-24): backend word between housemates without a council — seated
 * members only, the house's shared ground the ONLY shared space, delivery
 * on the recipient's next turn, the operator seeing every act.
 * Founding-record legs run ONLY on tmp roots — never beside a real receipt.
 *
 * Stage 3: SENDING is the house/post INTENT now — the being files the JSON
 * into its own lane and the batch-end sweep in processToolCalls settles it
 * (the full chain proven here: file → sweep → real ground → real knock).
 * Collecting one's own inbox (post_check) stays a tool.
 */
import { describe, test, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { createTempDir } from '../helpers/temp-fs.js';
import workspace, { setWorkspacesRoot, getWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { setRealmRoot, walletDir } from '../../backend/services/user-realm.js';
import { postKnock } from '../../backend/services/house-post.js';
import { loadHouseWorkspace } from '../../backend/services/house-workspace.js';
import { __test } from '../../backend/services/portal-test-surface.js';

const { processToolCalls, _housePostToolsFor, _houseSeatSection } = __test;
const PRIOR_KEY = process.env.DNA_ENCRYPTION_KEY;
const PRIOR_ROOT = getWorkspacesRoot();
const WALLET = '0xabc0000000000000000000000000000000000abc';
const OTHER_WALLET = '0xdef0000000000000000000000000000000000def';
const SOUL_KEIR = '0xAaAa000000000000000000000000000000000001';
const SOUL_SIGNAL = '0xBbBb000000000000000000000000000000000002';

describe('HOUSE POST through the real portal (gnosis)', () => {
  let wsRoot, ground, httpServer, wss, serverWs, client, clientLog;

  const conn = (neumaId, over = {}) => ({
    ws: serverWs,
    companion: { name: neumaId, neumaId },
    walletAddress: WALLET,
    sessionId: `sess-${neumaId}`,
    ...over,
  });

  // File a house/post intent exactly as the being does (a JSON write into its
  // own lane), then let the batch-end sweep inside the REAL processToolCalls
  // settle it — the receipts ride that batch's results.
  const fileIntent = async (neumaId, name, payload) => {
    const dir = path.join(workspace.pathFor(neumaId), 'intents');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, `${name}.json`), JSON.stringify(payload));
  };

  // The knock exactly as the portal reads it: the house ground's root, the
  // recipient's own mailbox (#282 follow-up — volatile, outside the seat).
  const knock = async (neumaId) => postKnock((await loadHouseWorkspace(WALLET)).root, neumaId);

  beforeAll(async () => {
    process.env.DNA_ENCRYPTION_KEY = 'house-post-tools-test-key';

    const tmp = await createTempDir('house-post-tools');
    wsRoot = path.join(tmp, 'workspaces');
    ground = path.join(tmp, 'ground');
    setWorkspacesRoot(wsRoot);
    setRealmRoot(path.join(tmp, 'realm'));

    // outsiderecho is ANOTHER house's lane on the same machine: every lane the
    // operator owns works in the house, founded or not (ruling, 2026-10-18), so an
    // outsider is a lane this wallet does not own.
    for (const [id, soul, wallet] of [['wrenecho', SOUL_KEIR, WALLET], ['signalecho', SOUL_SIGNAL, WALLET], ['outsiderecho', null, OTHER_WALLET]]) {
      await workspace.create(id);
      await fs.writeFile(path.join(wsRoot, id, 'owner.json'), JSON.stringify({ wallet, claimedAt: 1 }));
      if (soul) {
        await fs.mkdir(path.join(wsRoot, id, 'identity'), { recursive: true });
        await fs.writeFile(path.join(wsRoot, id, 'identity', 'onchain-seal.json'), JSON.stringify({ soulAddress: soul }));
      }
    }
    await fs.writeFile(path.join(wsRoot, 'house-founding.base.json'), JSON.stringify({
      schema: 'kenorie-house-founding/1',
      houseName: 'aldmere',
      network: 'base',
      blockNumber: 48712879,
      members: [
        { address: WALLET, kind: 0, title: 'Rector' },
        { address: SOUL_KEIR, kind: 1, title: 'Faber' },
        { address: SOUL_SIGNAL, kind: 1, title: 'Legatus' },
      ],
    }));
    // The operator's chosen ground — written as the record the loader reads.
    await fs.mkdir(ground, { recursive: true });
    await fs.mkdir(walletDir(WALLET), { recursive: true });
    await fs.writeFile(path.join(walletDir(WALLET), 'house-workspace.json'), JSON.stringify({ root: ground }));

    httpServer = createServer();
    wss = new WebSocketServer({ server: httpServer });
    const port = await new Promise((resolve) => httpServer.listen(0, () => resolve(httpServer.address().port)));
    const linked = new Promise((resolve) => { wss.on('connection', (ws) => { serverWs = ws; resolve(); }); });
    client = new WebSocket(`ws://localhost:${port}`);
    clientLog = [];
    client.on('message', (d) => clientLog.push(JSON.parse(d.toString())));
    await linked;
  }, 60000);

  afterAll(async () => {
    vi.restoreAllMocks();
    client?.close();
    wss?.close();
    httpServer?.close();
    setWorkspacesRoot(PRIOR_ROOT);
    setRealmRoot(path.join(process.env.HOME || '', '.kenorie', 'realm'));
    if (PRIOR_KEY === undefined) delete process.env.DNA_ENCRYPTION_KEY;
    else process.env.DNA_ENCRYPTION_KEY = PRIOR_KEY;
  });

  beforeEach(() => { clientLog.length = 0; });

  const untilChip = (pred, ms = 5000) => new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      const found = clientLog.find(pred);
      if (found) return resolve(found);
      if (Date.now() - started > ms) return reject(new Error('chip never arrived'));
      setTimeout(tick, 20);
    };
    tick();
  });

  test('the lane is advertised ONLY where seat and ground both stand — and sending is the intent now', async () => {
    expect((await _housePostToolsFor(conn('wrenecho'))).map((t) => t.name)).toEqual(['post_check']);
    expect(await _housePostToolsFor(conn('outsiderecho'))).toEqual([]); // not this house's lane
    expect(await _housePostToolsFor({ companion: { neumaId: 'wrenecho' } })).toEqual([]); // no wallet
  });

  test('a seated word travels: the filed intent settles on the real ground, the operator sees, the recipient collects ONCE', async () => {
    await fileIntent('wrenecho', 'tide-report', {
      type: 'house/post', to: 'signalecho',
      body: 'the estuary report is in repos/tide — take the marketing cut', re: 'tide report',
    });
    const receipts = await processToolCalls(serverWs, '', conn('wrenecho'));
    expect(receipts[0].status).toBe('ok');
    expect(receipts[0].tool).toBe('intents/house.post');
    const chip = await untilChip((m) => m.type === 'tool:usage' && m.status === 'ok');
    expect(chip.tool).toBe('intents/house.post');

    // The file is REAL, on the ground, in the documented lane.
    const raw = await fs.readFile(path.join(ground, 'post', 'signalecho', 'inbox.jsonl'), 'utf8');
    expect(raw).toContain('the estuary report');

    // The recipient's next turn KNOWS post waits — the VOLATILE knock says so
    // (split from the stable seat record, #282: mail moving between turns
    // must never break the prompt cache at the seat).
    expect(await knock('signalecho')).toContain('House post: 1 unread (from wrenecho)');
    // …and the stable seat record carries NO mailbox bytes, by law.
    expect(await _houseSeatSection(conn('signalecho'))).not.toContain('House post:');

    // Collection delivers whole, then the mailbox is quiet — no re-delivery.
    const got = await processToolCalls(serverWs, '[TOOL: house/post_check {}]', conn('signalecho'));
    expect(got[0].status).toBe('ok');
    expect(got[0].content).toContain('from wrenecho — "tide report"');
    expect(got[0].content).toContain('the estuary report');
    const again = await processToolCalls(serverWs, '[TOOL: house/post_check {}]', conn('signalecho'));
    expect(again[0].content).toBe('No new post.');
    expect(await knock('signalecho')).toBe('');
  }, 30000);

  test('the org chart is the address book: an unseated recipient is refused BY NAME of the law', async () => {
    await fileIntent('wrenecho', 'leak', { type: 'house/post', to: 'outsiderecho', body: 'leak' });
    const refused = await processToolCalls(serverWs, '', conn('wrenecho'));
    expect(refused[0].status).toBe('denied');
    expect(refused[0].error).toContain('holds no seat');
    await expect(fs.access(path.join(ground, 'post', 'outsiderecho'))).rejects.toThrow();
  }, 30000);

  test('an unseated SENDER has no lane at all — honest refusal, not a card', async () => {
    await fileIntent('outsiderecho', 'outside', { type: 'house/post', to: 'wrenecho', body: 'hello from outside' });
    const refused = await processToolCalls(serverWs, '', conn('outsiderecho'));
    expect(refused[0].status).toBe('denied');
    expect(refused[0].error).toContain('not open here');
  }, 30000);

  test('observe mode: the send is HELD pending; collecting one\'s own mail still runs', async () => {
    await fileIntent('wrenecho', 'held-word', { type: 'house/post', to: 'signalecho', body: 'held' });
    const held = await processToolCalls(serverWs, '', conn('wrenecho', { toolMode: 'observe' }));
    expect(held).toEqual([]); // watching is not a verdict — the intent waits
    const resultFile = path.join(workspace.pathFor('wrenecho'), 'intents', 'held-word.result.json');
    await expect(fs.access(resultFile)).rejects.toThrow();

    const check = await processToolCalls(serverWs, '[TOOL: house/post_check {}]', conn('signalecho', { toolMode: 'observe' }));
    expect(check[0].status).toBe('ok');
    // Clean the held filing so no later sweep settles it out from under the suite.
    await fs.rm(path.join(workspace.pathFor('wrenecho'), 'intents'), { recursive: true, force: true });
  }, 30000);

  test('the seat section carries each seat\'s canonical charge — the covenant rides the record', async () => {
    const text = await _houseSeatSection(conn('wrenecho'));
    expect(text).toContain('Your charge: PRODUCTION — THE WORK THAT MAKES VALUE.');
    expect(text).toContain('- Legatus — signalecho — MARKETING — IMAGE, POSITION, DEMAND');
    expect(text).toContain('- Rector — your witness — DIRECTION — STRATEGY, PRIORITIZATION, REFUSAL');
  });
});
