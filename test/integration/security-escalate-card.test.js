/**
 * THE ESCALATE CARD SHOWS WHAT GOES OUT (re-audit 2026-10-29, NEW-M5). security/escalate publishes
 * a GitHub issue under the operator's own gh login; its card used to show only {id}. Now the card
 * carries the issue's title and body exactly as filed, and a text carrying a key is refused before
 * any card. REAL designation, REAL threat ledger on temp disk, REAL filed intents settled by the
 * REAL sweep, the approval asked and answered over a REAL WebSocket pair. No mocks (RULE 0).
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { createTempDir } from '../helpers/temp-fs.js';
import { csoDesignation } from '../../backend/services/security/cso-designation.js';
import { threatLedgerFor } from '../../backend/services/security/threat-ledger.js';
import { getRealmRoot, setRealmRoot } from '../../backend/services/user-realm.js';
import { writeOwner } from '../helpers/audit-auth.js';
import { resolveToolApproval } from '../../backend/services/tool-approval.js';
import { sweepIntents } from '../../backend/services/intents/intent-sweep.js';
import workspace, { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';

const LANE = 'cardguardian';
const WALLET = '0xcccc00000000000000000000000000000000cccc';
const ENV = ['NEUMA_DATA_ROOT', 'NEUMA_SECURITY_CSO_PATH', 'NEUMA_SECURITY_THREATS_PATH', 'NEUMA_SECURITY_WATCH_PATH'];
const THREAT = { layer: 'software', source: 'osv', repo: 'neuma', severity: 'high', affected: [{ package: 'fixture', version: '1.0.0' }] };

describe('the security/escalate card', () => {
  let house, httpServer, wss, serverWs, client, priorRealm, connection;
  const frames = [];
  const saved = {};

  const confirmed = async (externalId, title, summary) => {
    const ledger = await threatLedgerFor(WALLET);
    await ledger.ingest([{ ...THREAT, externalId, title, summary }]);
    const entry = (await ledger.load()).find((e) => e.externalId === externalId);
    await ledger.assess(entry.id, { status: 'confirmed', assessment: 'it bites', assessedBy: LANE });
    return entry;
  };
  const escalate = async (name, id) => {
    const dir = path.join(workspace.pathFor(LANE), 'intents');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, `${name}.json`), JSON.stringify({ type: 'security/escalate', id }));
    return sweepIntents(connection, { mode: 'ask', lanePolicy: null, emit: () => {} });
  };

  beforeAll(async () => {
    house = await createTempDir('escalate-card-house');
    for (const k of ENV) saved[k] = process.env[k];
    process.env.NEUMA_DATA_ROOT = house;
    process.env.NEUMA_SECURITY_CSO_PATH = path.join(house, 'cso.json');
    process.env.NEUMA_SECURITY_THREATS_PATH = path.join(house, 'threats.json');
    process.env.NEUMA_SECURITY_WATCH_PATH = path.join(house, 'watch.json');
    setWorkspacesRoot(path.join(house, 'workspaces'));
    await fs.mkdir(path.join(house, 'workspaces', LANE), { recursive: true });
    await writeOwner(path.join(house, 'workspaces'), LANE, WALLET);
    priorRealm = getRealmRoot();
    setRealmRoot(path.join(house, 'realm'));
    httpServer = createServer();
    wss = new WebSocketServer({ server: httpServer });
    const port = await new Promise((resolve) => httpServer.listen(0, () => resolve(httpServer.address().port)));
    const linked = new Promise((resolve) => wss.on('connection', (ws) => {
      serverWs = ws;
      ws.on('message', (raw) => {
        const frame = JSON.parse(raw.toString());
        if (frame.type === 'tool:approval_response') resolveToolApproval(connection, frame.id, frame.decision);
      });
      resolve();
    }));
    client = new WebSocket(`ws://localhost:${port}`);
    client.on('message', (raw) => {
      const frame = JSON.parse(raw.toString());
      frames.push(frame);
      // the operator reads the card and denies: nothing may be filed
      if (frame.type === 'tool:approval_request') client.send(JSON.stringify({ type: 'tool:approval_response', id: frame.id, decision: 'deny' }));
    });
    await linked;
    connection = { ws: serverWs, walletAddress: WALLET, companion: { name: 'CardEcho', neumaId: LANE } };
    await csoDesignation.designate(WALLET, LANE);
  }, 60000);

  afterAll(async () => {
    for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    setWorkspacesRoot(null);
    setRealmRoot(priorRealm);
    client?.close();
    wss?.close();
    httpServer?.close();
  });

  test('shows the whole issue it would publish; a deny files nothing', async () => {
    const entry = await confirmed('GHSA-card-0001', 'card fixture advisory', 'words the CSO wrote, shown before they go out');
    const before = frames.length;
    const settled = await escalate('card-escalate', entry.id);
    const card = frames.slice(before).find((f) => f.type === 'tool:approval_request' && f.tool === 'intents/security.escalate');
    expect(card).toBeTruthy();
    const shown = typeof card.args === 'string' ? card.args : JSON.stringify(card.args);
    expect(shown).toContain('[WATCHTOWER] card fixture advisory');
    expect(shown).toContain('words the CSO wrote, shown before they go out');
    expect(settled[0].status).toBe('denied');
    expect((await (await threatLedgerFor(WALLET)).get(entry.id)).githubIssue).toBeNull();
  }, 30000);

  test('an issue text carrying a key, even encoded, is refused before any card', async () => {
    const key = ['gh', 'p_', 'k'.repeat(36)].join('');
    const entry = await confirmed('GHSA-card-0002', 'leaky fixture', `the token is ${Buffer.from(key).toString('base64')}`);
    const before = frames.length;
    const settled = await escalate('leaky-escalate', entry.id);
    expect(settled[0].status).toBe('denied');
    expect(settled[0].error).toMatch(/github-token/);
    expect(frames.slice(before).some((f) => f.type === 'tool:approval_request')).toBe(false);
  }, 30000);
});
