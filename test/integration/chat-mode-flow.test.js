/**
 * Chat modes (default / plan / auto) + the AUTO protocol guard — proven end
 * to end with NO mock on any claimed path (AGENTS.md RULE 0): REAL
 * WebSocket pair, REAL portal message dispatcher, REAL processToolCalls
 * dispatch, REAL act gate and approval broker, REAL intent sweep against a
 * REAL lane on real disk, REAL channel-binding store on a tmp file.
 *
 * The contract under proof:
 *  - chat:mode derives the ACTS tier (default→ask, plan→observe, auto→auto),
 *    fails closed to default, and acks BOTH truths to the desk.
 *  - PLAN MODE is read-only by construction (the derived observe tier holds
 *    a write at the ONE act gate) and its plan_present card carries the chat
 *    verdicts: accept_default / accept_auto flip the connection's mode at
 *    the verdict; adjust returns the operator's notes; deny holds the plan
 *    dead. A presentation outside PLAN MODE refuses honestly.
 *  - AUTO's protocol guard re-gates the hard classes — a delete at the act
 *    gate, an outward social.post at the REAL intent sweep — while an
 *    ordinary allowed act flows. (The sweep's post can NEVER leave the
 *    machine here: the bound channel is mastodon, which carries no
 *    credentials on any test box, and the verdict answered is deny.)
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
import { resolveToolApproval } from '../../backend/services/tool-approval.js';
import { sweepIntents } from '../../backend/services/intents/intent-sweep.js';
import {
  normalizePresentArgs, requestPlanVerdict, resolvePlanVerdict,
  expirePendingPresents, planModeSection, PLAN_PRESENT_TOOL,
} from '../../backend/services/plan-mode.js';
import { normalizeChatMode, toolModeForChatMode } from '../../backend/services/tool-policy.js';
import workspace, { setWorkspacesRoot, getWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { getRealmRoot, setRealmRoot } from '../../backend/services/user-realm.js';

const { processToolCalls } = __test;

const WITNESS = '0x3333333333333333333333333333333333333333';
const presentCall = (args) => `[TOOL: plan/plan_present ${JSON.stringify(args)}]`;
const GOOD_PRESENT = Object.freeze({
  goal: 'Write the launch announcement into the lane.',
  steps: [
    { id: 'draft', task: 'Draft the announcement in the workspace.', done: 'The draft file stands.' },
    { id: 'polish', task: 'Tighten it against the house voice.' },
  ],
  notes: 'One file, no outward speech.',
});

describe('chat modes + protocol guard (real WS, real gates, gnosis)', () => {
  let house, origRoot, realm, prevRealm, bindingsFile, prevBindingsEnv;
  let httpServer, wss, serverWs, client, clientLog;
  let verdict = null;       // armed: the desk answers operator:plan with it
  let approveWith = null;   // armed: the desk answers tool:approval_request with it

  const freshConnection = () => ({
    ws: serverWs,
    companion: { name: 'Aethon', neumaId: 'aethon' },
    walletAddress: WITNESS,
  });

  // Mirror the route (portal-message-handlers.js): the plan-mode registry
  // answers first, the approval broker answers tool cards.
  const wireVerdicts = (connection) => {
    serverWs.on('message', (d) => {
      const m = JSON.parse(d.toString());
      if (m.type === 'operator:plan_response') resolvePlanVerdict(connection, m.id, m.decision, m.notes);
      if (m.type === 'tool:approval_response') resolveToolApproval(connection, m.id, m.decision);
    });
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

  beforeAll(async () => {
    house = await createTempDir('chat-modes-house');
    origRoot = getWorkspacesRoot();
    setWorkspacesRoot(house);
    realm = await createTempDir('chat-modes-realm');
    prevRealm = getRealmRoot();
    setRealmRoot(realm);
    await workspace.create('aethon');
    // The sweep fixture's channel binding: mastodon is OURS — and carries no
    // credentials anywhere, so no code path in this file can ever post.
    bindingsFile = path.join(house, 'social-channel-bindings.json');
    prevBindingsEnv = process.env.NEUMA_SOCIAL_BINDINGS_PATH;
    process.env.NEUMA_SOCIAL_BINDINGS_PATH = bindingsFile;
    // The lane is the house's own, and the house bound it (house-positions.js).
    await fs.writeFile(path.join(house, 'aethon', 'owner.json'), JSON.stringify({ wallet: WITNESS }));
    await fs.writeFile(bindingsFile, JSON.stringify({ mastodon: { neumaId: 'aethon', boundBy: WITNESS } }));

    httpServer = createServer();
    wss = new WebSocketServer({ server: httpServer });
    const port = await new Promise((resolve) => httpServer.listen(0, () => resolve(httpServer.address().port)));
    const linked = new Promise((resolve) => { wss.on('connection', (ws) => { serverWs = ws; resolve(); }); });
    client = new WebSocket(`ws://localhost:${port}`);
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
  }, 60000);

  afterAll(async () => {
    client?.close();
    wss?.close();
    httpServer?.close();
    setWorkspacesRoot(origRoot);
    setRealmRoot(prevRealm);
    if (prevBindingsEnv === undefined) delete process.env.NEUMA_SOCIAL_BINDINGS_PATH;
    else process.env.NEUMA_SOCIAL_BINDINGS_PATH = prevBindingsEnv;
    await fs.rm(house, { recursive: true, force: true });
    await fs.rm(realm, { recursive: true, force: true });
  });

  test('chat:mode through the REAL dispatcher — derivation, both acks, fail-closed', async () => {
    const connection = createPortalConnection({ ws: serverWs, walletAddress: WITNESS });
    const id = 'chat-mode-test-conn';
    portalConnections.set(id, connection);
    clientLog.length = 0;
    try {
      await handlePortalMessage(id, { type: 'chat:mode', mode: 'plan' }, { birthHandler: null });
      expect(connection.chatMode).toBe('plan');
      expect(connection.toolMode).toBe('observe'); // planning never acts
      let ack = await untilClient((m) => m.type === 'chat:mode');
      expect(ack.mode).toBe('plan');
      ack = await untilClient((m) => m.type === 'tool:mode');
      expect(ack.mode).toBe('observe');

      await handlePortalMessage(id, { type: 'chat:mode', mode: 'auto' }, { birthHandler: null });
      expect(connection.toolMode).toBe('auto');

      // Garbage fails closed to the least authority — free flow, per-act cards.
      await handlePortalMessage(id, { type: 'chat:mode', mode: 'yolo' }, { birthHandler: null });
      expect(connection.chatMode).toBe('default');
      expect(connection.toolMode).toBe('ask');
      // Drain ALL THREE ack pairs before the next test — frames in flight
      // must never land in another test's window.
      await untilClient(() => clientLog.filter((m) => m.type === 'chat:mode').length === 3);
      await untilClient(() => clientLog.filter((m) => m.type === 'tool:mode').length === 3);
      const acks = clientLog.filter((m) => m.type === 'chat:mode');
      expect(acks.map((a) => a.mode)).toEqual(['plan', 'auto', 'default']);
    } finally {
      portalConnections.delete(id);
    }
  }, 30000);

  test('the derivation table holds for every bearing', () => {
    expect(toolModeForChatMode('default')).toBe('ask');
    expect(toolModeForChatMode('plan')).toBe('observe');
    expect(toolModeForChatMode('auto')).toBe('auto');
    expect(normalizeChatMode('plan')).toBe('plan');
    expect(normalizeChatMode(undefined)).toBe('default');
    expect(planModeSection({ chatMode: 'plan' })).toContain('PLAN MODE');
    expect(planModeSection({ chatMode: 'default' })).toBe(''); // the empty-string law
    expect(PLAN_PRESENT_TOOL.inputSchema.required).toEqual(expect.arrayContaining(['goal', 'steps']));
  });

  test('PLAN MODE is read-only by construction — the ONE act gate holds a write, a read opens', async () => {
    const connection = freshConnection();
    const write = await gateAct(connection, { server: 'fs', tool: 'write', mode: 'observe', emit: () => {} });
    expect(write.ok).toBe(false);
    expect(write.result.error).toContain('observe');
    const read = await gateAct(connection, { server: 'fs', tool: 'read', mode: 'observe', emit: () => {} });
    expect(read.ok).toBe(true);
  });

  test('ACCEPT → DEFAULT — the verdict flips the mode and the desk hears it', async () => {
    const connection = freshConnection();
    connection.chatMode = 'plan';
    connection.toolMode = 'observe';
    wireVerdicts(connection);
    clientLog.length = 0;
    verdict = () => ({ decision: 'accept_default' });

    const results = await processToolCalls(serverWs, presentCall(GOOD_PRESENT), connection);

    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('ok');
    expect(results[0].content).toContain('ACCEPTED');
    expect(results[0].content).toContain('DEFAULT');
    // The mode flipped AT THE VERDICT — the being's next act carries it.
    expect(connection.chatMode).toBe('default');
    expect(connection.toolMode).toBe('ask');

    const card = await untilClient((m) => m.type === 'operator:plan');
    expect(card.kind).toBe('chat');
    expect(card.goal).toBe(GOOD_PRESENT.goal);
    expect(card.detail).toBe(GOOD_PRESENT.notes);
    expect(card.steps.map((s) => s.id)).toEqual(['draft', 'polish']);
    expect(card.steps[0].member).toBe('Aethon');
    expect(card.steps[0].done).toContain('draft file');
    const resolved = await untilClient((m) => m.type === 'operator:plan_resolved' && m.id === card.id);
    expect(resolved.status).toBe('accept_default');
    // The desk's chip lands on server truth — the ack pair rode the wire.
    const chatAck = await untilClient((m) => m.type === 'chat:mode');
    expect(chatAck.mode).toBe('default');
    const toolAck = await untilClient((m) => m.type === 'tool:mode');
    expect(toolAck.mode).toBe('ask');
    expect(connection._pendingPresents.size).toBe(0);
  }, 30000);

  test('ACCEPT → AUTO — hands-off lands with the derivation', async () => {
    const connection = freshConnection();
    connection.chatMode = 'plan';
    connection.toolMode = 'observe';
    wireVerdicts(connection);
    clientLog.length = 0;
    verdict = () => ({ decision: 'accept_auto' });

    const results = await processToolCalls(serverWs, presentCall(GOOD_PRESENT), connection);
    expect(results[0].content).toContain('ACCEPTED');
    expect(results[0].content).toContain('AUTO');
    expect(connection.chatMode).toBe('auto');
    expect(connection.toolMode).toBe('auto');
    const chatAck = await untilClient((m) => m.type === 'chat:mode');
    expect(chatAck.mode).toBe('auto');
  }, 30000);

  test('ADJUST returns the operator\'s notes; DENY holds the plan dead — both stay in PLAN', async () => {
    const connection = freshConnection();
    connection.chatMode = 'plan';
    wireVerdicts(connection);
    clientLog.length = 0;
    verdict = () => ({ decision: 'adjust', notes: 'Add a verify step before polish.' });

    let results = await processToolCalls(serverWs, presentCall(GOOD_PRESENT), connection);
    expect(results[0].content).toContain('ADJUSTMENTS');
    expect(results[0].content).toContain('Add a verify step before polish.');
    expect(connection.chatMode).toBe('plan'); // still planning

    verdict = () => ({ decision: 'deny' });
    results = await processToolCalls(serverWs, presentCall(GOOD_PRESENT), connection);
    expect(results[0].content).toContain('DENIED');
    expect(results[0].content).toContain('Do not execute');
    expect(connection.chatMode).toBe('plan');
  }, 30000);

  test('plan_present outside PLAN MODE refuses honestly, and malformed input never raises a card', async () => {
    const connection = freshConnection(); // chatMode unset → default
    clientLog.length = 0;
    verdict = () => { throw new Error('a card fired outside PLAN MODE'); };

    let results = await processToolCalls(serverWs, presentCall(GOOD_PRESENT), connection);
    expect(results[0].status).toBe('error');
    expect(results[0].error).toContain('PLAN MODE');

    connection.chatMode = 'plan';
    results = await processToolCalls(serverWs, presentCall({ steps: GOOD_PRESENT.steps }), connection);
    expect(results[0].status).toBe('error');
    expect(results[0].error).toContain('goal');
    expect(clientLog.some((m) => m.type === 'operator:plan')).toBe(false);
    verdict = null; // disarm the thrower — later tests raise real cards
  }, 30000);

  test('AUTO guard at the act gate — a delete pauses on the card, an ordinary write flows', async () => {
    const connection = freshConnection();
    wireVerdicts(connection);
    clientLog.length = 0;
    approveWith = 'allow';

    // filesystem/delete_file is approval-tier; plain AUTO would unlock it —
    // the protocol guard re-gates it (deletes are irreversible).
    const gated = gateAct(connection, {
      server: 'filesystem', tool: 'delete_file', mode: 'auto', emit: () => {},
    });
    const card = await untilClient((m) => m.type === 'tool:approval_request');
    expect(card.tool).toBe('filesystem/delete_file');
    expect((await gated).ok).toBe(true);

    // An ordinary allowed act flows in AUTO — the guard never tightens it.
    clientLog.length = 0;
    const write = await gateAct(connection, { server: 'fs', tool: 'write', mode: 'auto', emit: () => {} });
    expect(write.ok).toBe(true);
    expect(clientLog.some((m) => m.type === 'tool:approval_request')).toBe(false);

    // And the guard never tightens DEFAULT — the same delete asks there too,
    // on the tier alone (the pre-existing law, unchanged).
    clientLog.length = 0;
    const asked = gateAct(connection, {
      server: 'filesystem', tool: 'delete_file', mode: 'ask', emit: () => {},
    });
    await untilClient((m) => m.type === 'tool:approval_request');
    expect((await asked).ok).toBe(true);
    approveWith = null;
  }, 30000);

  test('AUTO guard at the REAL intent sweep — social.post pauses on the card instead of posting', async () => {
    const connection = freshConnection();
    connection.chatMode = 'auto';
    connection.toolMode = 'auto';
    wireVerdicts(connection);
    clientLog.length = 0;
    approveWith = 'deny'; // the card is the proof; nothing ever executes

    // A REAL filed intent in the lane's own intents dir: post NOW through
    // mastodon (bound to this lane above, credentialed nowhere).
    const dir = path.join(house, 'aethon', 'intents');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'announce.json'), JSON.stringify({
      type: 'social/post', channel: 'mastodon', text: 'the guard holds this post',
    }));

    const events = [];
    const receipts = await sweepIntents(connection, { mode: 'auto', lanePolicy: null, emit: (e) => events.push(e) });

    // Plain AUTO would have settled social.post silently (it is approval-tier);
    // the guard held it for the operator — the card FIRED and was denied.
    const card = await untilClient((m) => m.type === 'tool:approval_request');
    expect(card.tool).toBe('intents/social.post');
    expect(card.scope).toContain('mastodon');
    expect(receipts).toHaveLength(1);
    expect(receipts[0].status).toBe('denied');
    const settled = JSON.parse(await fs.readFile(path.join(dir, 'announce.result.json'), 'utf8'));
    expect(settled.status).toBe('denied');
    approveWith = null;
  }, 30000);

  test('no verdict is never a verdict — close settles honestly, untrusted input drops', async () => {
    const connection = freshConnection();
    const waiting = requestPlanVerdict(connection, {
      goal: 'g', steps: [{ id: 'a', task: 'x' }], notes: null, member: 'Aethon',
    });
    expirePendingPresents(connection);
    expect(await waiting).toEqual({ status: 'closed' });
    expect(connection._pendingPresents.size).toBe(0);

    const again = requestPlanVerdict(connection, {
      goal: 'g', steps: [{ id: 'a', task: 'x' }], notes: null, member: 'Aethon',
    });
    const [id] = [...connection._pendingPresents.keys()];
    expect(resolvePlanVerdict(connection, 'ghost-id', 'accept_default')).toBe(false);
    expect(resolvePlanVerdict(connection, id, 'rubber_stamp')).toBe(false);
    expect(connection._pendingPresents.size).toBe(1);
    expect(resolvePlanVerdict(connection, id, 'deny')).toBe(true);
    expect((await again).status).toBe('deny');
    // A denied plan leaves the bearing untouched.
    expect(normalizeChatMode(connection.chatMode)).toBe('default');
  });

  test('normalizePresentArgs boundaries', () => {
    expect(() => normalizePresentArgs({ steps: [{ id: 'a', task: 't' }] })).toThrow(/goal/);
    expect(() => normalizePresentArgs({ goal: 'g', steps: [] })).toThrow(/steps/);
    expect(() => normalizePresentArgs({ goal: 'g', steps: [{ task: 't' }] })).toThrow(/id/);
    expect(() => normalizePresentArgs({ goal: 'g', steps: [{ id: 'a' }] })).toThrow(/"a"/);
  });
});
