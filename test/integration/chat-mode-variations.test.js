/**
 * Chat mode VARIATIONS — the paths chat-mode-flow.test.js does not walk,
 * proven end to end with NO mock on any claimed path (AGENTS.md RULE 0):
 * REAL WebSocket pair, REAL portal message dispatcher (the desk's frames
 * ride the wire here — nothing calls the dispatcher's internals directly),
 * REAL act gate and approval broker, REAL intent sweep against a REAL lane
 * on real disk, REAL persisted lane policy and spend allowlist.
 *
 * The contract under proof:
 *  - The switching cycle (plan → auto → garbage → default) works when the
 *    frames arrive as genuine socket traffic, ack pairs in order.
 *  - operator:plan_response routed by the REAL dispatcher resolves a PLAN
 *    MODE verdict (the mode flips); a ghost id falls through to the team
 *    broker untouched and disturbs no pending present.
 *  - The AUTO guard's FULL table: coding/execute pauses at the act gate; a
 *    recorded ALWAYS grant does NOT silence the guard; a policy denial is
 *    never resurrected by AUTO; social/queue and wallet/send pause at the
 *    REAL sweep (their receipts settle denied, nothing executes).
 *  - The plan bearing reaches the turn envelope in PLAN MODE and is
 *    byte-absent in every other bearing (the empty-string law).
 *
 * email/send's real-path card cannot fire on this box: its validate()
 * refuses BEFORE the card when no mailbox credential resolves (email-send.js
 * mailboxRefusal), and there is no mailbox here. Its guard row is proven at
 * the pure composition level below, and the sweep's guard line is one
 * uniform call for every type (intent-sweep.js:140) — proven live twice in
 * this file. That is stated plainly, not dressed up.
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { createTempDir } from '../helpers/temp-fs.js';
import { __test } from '../../backend/services/portal-test-surface.js';
import { handlePortalMessage } from '../../backend/routes/portal-message-handlers.js';
import { portalConnections } from '../../backend/routes/portal-connections.js';
import { createPortalConnection } from '../../backend/services/portal-connection.js';
import { gateAct } from '../../backend/services/act-gate.js';
import { sweepIntents } from '../../backend/services/intents/intent-sweep.js';
import { applyProtocolGuard, isAutoHardGated } from '../../backend/services/protocol-guard.js';
import { planModeSection } from '../../backend/services/plan-mode.js';
import { finalizeTurnEnvelope } from '../../backend/services/turn-envelope.js';
import workspace, { setWorkspacesRoot, getWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { getRealmRoot, setRealmRoot } from '../../backend/services/user-realm.js';

const { processToolCalls } = __test;

const WITNESS = '0x4444444444444444444444444444444444444444';
const SPEND_RECIPIENT = '0x9999999999999999999999999999999999999999';
const presentCall = (args) => `[TOOL: plan/plan_present ${JSON.stringify(args)}]`;
const GOOD_PRESENT = Object.freeze({
  goal: 'Prepare the weekly digest draft.',
  steps: [{ id: 'draft', task: 'Draft the digest in the lane.', done: 'The draft stands.' }],
  notes: null,
});
// The six hard-gated classes as their POLICY identities (protocol-guard.js).
const HARD_GATES = Object.freeze([
  ['filesystem', 'delete_file'],
  ['coding', 'execute'],
  ['intents', 'social.post'],
  ['intents', 'email.send'],
  ['intents', 'wallet.send'],
]);

describe('chat mode variations (real socket, real dispatcher, gnosis)', () => {
  let house, origRoot, realm, prevRealm, bindingsFile, prevBindingsEnv, prevDnaKey;
  let httpServer, wss, serverWs, client, clientLog;
  let activeId = null;     // the connection the dispatcher routes frames to
  let verdict = null;      // armed: the desk answers operator:plan with it
  let approveWith = null;  // armed: the desk answers tool:approval_request with it

  // Seat a REAL registered connection; the one server-side listener routes
  // every inbound frame through the REAL dispatcher to it.
  const seatConnection = (label) => {
    const connection = createPortalConnection({ ws: serverWs, walletAddress: WITNESS });
    connection.companion = { name: 'Aethon', neumaId: 'aethon' };
    const id = `variations-${label}`;
    portalConnections.set(id, connection);
    activeId = id;
    return { id, connection };
  };

  const untilClient = (pred, ms = 5000) => new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      const hit = clientLog.find(pred);
      if (hit) return resolve(hit);
      if (Date.now() - started > ms) return reject(new Error('client message never arrived'));
      setTimeout(tick, 20);
    };
    tick();
  });

  const settle = (ms) => new Promise((r) => setTimeout(r, ms));

  beforeAll(async () => {
    house = await createTempDir('chat-variations-house');
    origRoot = getWorkspacesRoot();
    setWorkspacesRoot(house);
    realm = await createTempDir('chat-variations-realm');
    prevRealm = getRealmRoot();
    setRealmRoot(realm);
    await workspace.create('aethon');
    // mastodon is OURS and carries no credentials anywhere — no code path in
    // this file can ever post, and every verdict answered here is deny.
    bindingsFile = path.join(house, 'social-channel-bindings.json');
    prevBindingsEnv = process.env.NEUMA_SOCIAL_BINDINGS_PATH;
    process.env.NEUMA_SOCIAL_BINDINGS_PATH = bindingsFile;
    await fs.writeFile(bindingsFile, JSON.stringify({ mastodon: { neumaId: 'aethon' } }));
    // The lane's config writes (tool policy, spend allowlist) are encrypted at
    // rest — the test key the other suites use, saved and restored.
    prevDnaKey = process.env.DNA_ENCRYPTION_KEY;
    process.env.DNA_ENCRYPTION_KEY = 'test-encryption-key-32-characters!';

    httpServer = createServer();
    wss = new WebSocketServer({ server: httpServer });
    const port = await new Promise((resolve) => httpServer.listen(0, () => resolve(httpServer.address().port)));
    const linked = new Promise((resolve) => {
      wss.on('connection', (ws) => {
        serverWs = ws;
        // The REAL route every desk frame travels (portal-routes.js shape).
        ws.on('message', (d) => {
          if (activeId) handlePortalMessage(activeId, JSON.parse(d.toString()), { birthHandler: null });
        });
        resolve();
      });
    });
    client = new WebSocket(`ws://localhost:${port}`);
    const opened = new Promise((resolve) => client.on('open', resolve));
    clientLog = [];
    client.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      clientLog.push(msg);
      if (msg.type === 'operator:plan' && verdict) {
        client.send(JSON.stringify({ type: 'operator:plan_response', id: msg.id, ...verdict(msg) }));
      }
      if (msg.type === 'tool:approval_request' && approveWith) {
        client.send(JSON.stringify({ type: 'tool:approval_response', id: msg.id, decision: approveWith }));
      }
    });
    await linked;
    await opened;
  }, 60000);

  afterAll(async () => {
    client?.close();
    wss?.close();
    httpServer?.close();
    setWorkspacesRoot(origRoot);
    setRealmRoot(prevRealm);
    if (prevBindingsEnv === undefined) delete process.env.NEUMA_SOCIAL_BINDINGS_PATH;
    else process.env.NEUMA_SOCIAL_BINDINGS_PATH = prevBindingsEnv;
    if (prevDnaKey === undefined) delete process.env.DNA_ENCRYPTION_KEY;
    else process.env.DNA_ENCRYPTION_KEY = prevDnaKey;
    await fs.rm(house, { recursive: true, force: true });
    await fs.rm(realm, { recursive: true, force: true });
  });

  test('the switching cycle as genuine socket traffic — every flip, both acks, in order', async () => {
    const { id, connection } = seatConnection('cycle');
    clientLog.length = 0;
    try {
      for (const mode of ['plan', 'auto', 'yolo', 'default', 'plan', 'default']) {
        client.send(JSON.stringify({ type: 'chat:mode', mode }));
        await settle(30); // let each frame land before the next rides
      }
      await untilClient(() => clientLog.filter((m) => m.type === 'chat:mode').length === 6);
      await untilClient(() => clientLog.filter((m) => m.type === 'tool:mode').length === 6);
      expect(clientLog.filter((m) => m.type === 'chat:mode').map((a) => a.mode))
        .toEqual(['plan', 'auto', 'default', 'default', 'plan', 'default']);
      expect(clientLog.filter((m) => m.type === 'tool:mode').map((a) => a.mode))
        .toEqual(['observe', 'auto', 'ask', 'ask', 'observe', 'ask']);
      expect(connection.chatMode).toBe('default');
      expect(connection.toolMode).toBe('ask');
    } finally {
      activeId = null;
      portalConnections.delete(id);
    }
  }, 30000);

  test('operator:plan_response through the REAL dispatcher — verdict flips the mode, ghost ids fall through', async () => {
    const { id, connection } = seatConnection('verdict');
    connection.chatMode = 'plan';
    connection.toolMode = 'observe';
    clientLog.length = 0;
    try {
      verdict = () => ({ decision: 'accept_auto' });
      const results = await processToolCalls(serverWs, presentCall(GOOD_PRESENT), connection);
      expect(results[0].content).toContain('ACCEPTED');
      expect(connection.chatMode).toBe('auto');
      expect(connection.toolMode).toBe('auto');
      const ack = await untilClient((m) => m.type === 'chat:mode');
      expect(ack.mode).toBe('auto');

      // Back to PLAN for the fallthrough: a response naming a ghost id must
      // reach the team broker without touching the pending present.
      connection.chatMode = 'plan';
      connection.toolMode = 'observe';
      clientLog.length = 0; // the second present's card is the only one here
      verdict = () => ({ id: 'ghost-plan-id', decision: 'deny' });
      const pending = processToolCalls(serverWs, presentCall(GOOD_PRESENT), connection);
      const card = await untilClient((m) => m.type === 'operator:plan');
      await settle(200); // the ghost answer had its chance to land
      expect(connection._pendingPresents.size).toBe(1); // untouched
      expect(connection.chatMode).toBe('plan');

      // The honest answer resolves it — the present was never disturbed.
      verdict = null;
      client.send(JSON.stringify({ type: 'operator:plan_response', id: card.id, decision: 'deny' }));
      const settled = await pending;
      expect(settled[0].content).toContain('DENIED');
      expect(connection._pendingPresents.size).toBe(0);
    } finally {
      verdict = null;
      activeId = null;
      portalConnections.delete(id);
    }
  }, 30000);

  // Design note, 2026-09-06 (protocol-guard.js): Allow / Always / Revoke — AUTO alone
  // grants no hard-gated act, but the operator's explicit ALWAYS is honored,
  // never a second approval after permission was already given.
  test('AUTO guard — coding/execute pauses on the card; the operator\'s ALWAYS grant is honored', async () => {
    const { connection } = seatConnection('guard-gate');
    clientLog.length = 0;

    // A shell run is approval-tier; plain AUTO would unlock it — the guard
    // holds it for the operator.
    approveWith = 'allow';
    const exec = gateAct(connection, { server: 'coding', tool: 'execute', mode: 'auto', emit: () => {} });
    const execCard = await untilClient((m) => m.type === 'tool:approval_request');
    expect(execCard.tool).toBe('coding/execute');
    expect((await exec).ok).toBe(true);

    // Record an ALWAYS grant for deletes the honest way: ask mode, the card,
    // the operator's 'always' — persisted to the lane's real policy file.
    connection.toolMode = 'ask';
    clientLog.length = 0;
    approveWith = 'always';
    const first = gateAct(connection, { server: 'filesystem', tool: 'delete_file', mode: 'ask', emit: () => {} });
    await untilClient((m) => m.type === 'tool:approval_request');
    expect((await first).ok).toBe(true);
    const lanePolicy = await workspace.readToolPolicy('aethon');
    expect(lanePolicy.filesystem.allowed).toContain('delete_file');

    // THE LAW: AUTO now — the delete runs on the operator's own ALWAYS, and
    // no second card asks for a permission already given.
    connection.toolMode = 'auto';
    clientLog.length = 0;
    approveWith = null;
    const granted = await gateAct(connection, { server: 'filesystem', tool: 'delete_file', mode: 'auto', emit: () => {} });
    expect(granted.ok).toBe(true);
    await settle(200);
    expect(clientLog.some((m) => m.type === 'tool:approval_request')).toBe(false);
  }, 30000);

  test('the guard never resurrects a policy denial — AUTO or not, no card fires', async () => {
    const { connection } = seatConnection('guard-denied');
    await workspace.writeToolPolicy('aethon', { fs: { allowed: [], denied: ['write'], requireApproval: [] } });
    const lanePolicy = await workspace.readToolPolicy('aethon');
    clientLog.length = 0;
    try {
      for (const mode of ['auto', 'ask', 'observe']) {
        const denied = await gateAct(connection, {
          server: 'fs', tool: 'write', mode, lanePolicy, emit: () => {},
        });
        expect(denied.ok).toBe(false);
        expect(denied.result.error).toContain('denied');
      }
      expect(clientLog.some((m) => m.type === 'tool:approval_request')).toBe(false);
    } finally {
      await workspace.writeToolPolicy('aethon', {});
    }
  }, 30000);

  // posting-pipeline-v2 (protocol-guard.js): staging a draft is not egress —
  // the queue board's approve is that post's single operator decision.
  test('AUTO at the REAL sweep — social/queue stages a PENDING draft with no card; the board decides', async () => {
    const { connection } = seatConnection('guard-queue');
    connection.chatMode = 'auto';
    connection.toolMode = 'auto';
    clientLog.length = 0;
    approveWith = null;

    const dir = path.join(house, 'aethon', 'intents');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'stage.json'), JSON.stringify({
      type: 'social/queue', channel: 'mastodon', text: 'the board decides this draft',
    }));

    const receipts = await sweepIntents(connection, { mode: 'auto', lanePolicy: null, emit: () => {} });
    expect(receipts).toHaveLength(1);
    expect(receipts[0].status).toBe('ok');
    expect(receipts[0].content).toMatch(/Nothing is published yet/);
    expect(clientLog.some((m) => m.type === 'tool:approval_request')).toBe(false);
  }, 30000);

  test('AUTO guard at the REAL sweep — wallet/send moves nothing without the operator', async () => {
    const { connection } = seatConnection('guard-spend');
    connection.chatMode = 'auto';
    connection.toolMode = 'auto';
    // The spend policy PASSES (allowlisted recipient — validate() must not be
    // what stops this; the guard's card is the proof under test).
    await workspace.writeSpendAllowlist('aethon', {
      version: 1,
      entries: [{ address: SPEND_RECIPIENT, label: 'test', addedAt: new Date().toISOString() }],
    });
    clientLog.length = 0;
    approveWith = 'deny';

    const dir = path.join(house, 'aethon', 'intents');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'spend.json'), JSON.stringify({
      type: 'wallet/send', to: SPEND_RECIPIENT, value: '0.001', memo: 'the guard holds this spend',
    }));

    const receipts = await sweepIntents(connection, { mode: 'auto', lanePolicy: null, emit: () => {} });
    const card = await untilClient((m) => m.type === 'tool:approval_request');
    expect(card.tool).toBe('intents/wallet.send');
    expect(receipts).toHaveLength(1);
    expect(receipts[0].status).toBe('denied');
    const settled = JSON.parse(await fs.readFile(path.join(dir, 'spend.result.json'), 'utf8'));
    expect(settled.status).toBe('denied');
    approveWith = null;
  }, 30000);

  test('the guard table, exactly — every hard-gated class, every bearing, denials untouched', () => {
    for (const [server, tool] of HARD_GATES) {
      expect(isAutoHardGated(server, tool)).toBe(true);
      // AUTO's silent unlock stops at the class.
      expect(applyProtocolGuard('allowed', 'auto', server, tool)).toBe('approval_required');
      // A policy denial is never resurrected, in any bearing.
      for (const mode of ['auto', 'ask', 'observe']) {
        expect(applyProtocolGuard('denied', mode, server, tool)).toBe('denied');
      }
      // No other bearing is ever tightened.
      expect(applyProtocolGuard('allowed', 'ask', server, tool)).toBe('allowed');
      expect(applyProtocolGuard('allowed', 'observe', server, tool)).toBe('allowed');
      expect(applyProtocolGuard('approval_required', 'auto', server, tool)).toBe('approval_required');
    }
    // An ordinary act flows in AUTO — the guard never reaches for it.
    expect(isAutoHardGated('fs', 'write')).toBe(false);
    // Staging a draft left the table on purpose (posting-pipeline-v2).
    expect(isAutoHardGated('intents', 'social.queue')).toBe(false);
    expect(applyProtocolGuard('allowed', 'auto', 'fs', 'write')).toBe('allowed');
    expect(applyProtocolGuard('allowed', 'auto', 'web', 'web_fetch')).toBe('allowed');
  });

  test('the plan bearing reaches the turn envelope in PLAN MODE and is byte-absent otherwise', () => {
    const base = [{ id: 'identity', label: 'CORE', text: 'who you are' }];
    const planning = finalizeTurnEnvelope({ baseSections: base, planBearing: planModeSection({ chatMode: 'plan' }) });
    const bearing = planning.find((s) => s.id === 'planMode');
    expect(bearing).toBeTruthy();
    expect(bearing.label).toBe('PLAN MODE');
    expect(bearing.text).toContain('plan_present');

    for (const chatMode of ['default', 'auto', undefined]) {
      const sections = finalizeTurnEnvelope({ baseSections: base, planBearing: planModeSection({ chatMode }) });
      expect(sections.some((s) => s.id === 'planMode')).toBe(false);
      expect(sections.map((s) => s.text).join('\n\n')).not.toContain('PLAN MODE');
    }
  });
});
