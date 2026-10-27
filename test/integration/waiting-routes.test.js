/**
 * WAITING ON YOU, through its route (GET /api/v1/waiting) — Design note, 2026-10-24,
 * #585: […]
 *
 * RULE 0 throughout: real wallets with real session tokens, the real router,
 * and every source written and decided through its OWN real store on a real
 * temp root — a house ask filed and closed in the wake ledger, a charter
 * written and approved, queue drafts staged and rejected, a sovereignty
 * proposal submitted and declined — plus a REAL portal WebSocket pair on
 * which the real approval broker and the real ask broker raise their cards
 * and the operator's answer settles them. Nothing on the claimed path is
 * mocked.
 *
 * Under proof: every source is counted, each item says what/who/where/since,
 * the longest wait stands first, deciding one drops the count, a parked card
 * (its portal closed with it on screen) still waits, and one house never
 * sees another's.
 */
import express from 'express';
import request from 'supertest';
import path from 'path';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTempDir } from '../helpers/temp-fs.js';

const ENV = ['WORKSPACES_ROOT', 'NEUMA_REALM_ROOT', 'NEUMA_DATA_ROOT', 'NEUMA_SOCIAL_POST_QUEUE_PATH', 'WITNESSES_ROOT'];
const tick = (ms = 15) => new Promise((r) => setTimeout(r, ms));

// impure — a real portal: a WebSocket server and the desk's client on it.
const openPortal = async () => {
  const http = createServer();
  const wss = new WebSocketServer({ server: http });
  const port = await new Promise((resolve) => http.listen(0, () => resolve(http.address().port)));
  const server = new Promise((resolve) => wss.once('connection', resolve));
  const client = new WebSocket(`ws://localhost:${port}`);
  const frames = [];
  client.on('message', (d) => frames.push(JSON.parse(String(d))));
  await new Promise((resolve) => client.once('open', resolve));
  return { ws: await server, client, frames, close: () => new Promise((r) => { client.close(); wss.close(); http.close(r); }) };
};

const until = async (pred, ms = 5000) => {
  const t0 = Date.now();
  while (!pred()) {
    if (Date.now() - t0 > ms) throw new Error('never arrived');
    await tick(20);
  }
};

describe('WAITING ON YOU — one account of every decision owed, through its route', () => {
  let app, operator, other, stranger, saved, portals;
  let approvals, asks, ledger, charter, queue, proposals;

  beforeEach(async () => {
    vi.resetModules();
    saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
    const root = await createTempDir('waiting-routes');
    process.env.WORKSPACES_ROOT = path.join(root, 'workspaces');
    process.env.WITNESSES_ROOT = path.join(root, 'witnesses');
    process.env.NEUMA_REALM_ROOT = path.join(root, 'realm');
    process.env.NEUMA_DATA_ROOT = path.join(root, 'data');
    process.env.NEUMA_SOCIAL_POST_QUEUE_PATH = path.join(root, 'social-post-queue.json');
    const { setRealmRoot } = await import('../../backend/services/user-realm.js');
    setRealmRoot(process.env.NEUMA_REALM_ROOT);
    const { setWorkspacesRoot } = await import('../../core/workspace/neuma-workspace.js');
    setWorkspacesRoot(process.env.WORKSPACES_ROOT);
    const { witnessFor, strangerWitness } = await import('../helpers/witness.js');
    operator = await witnessFor(process.env.WORKSPACES_ROOT, 'wait-seat');
    other = await witnessFor(process.env.WORKSPACES_ROOT, 'other-seat');
    stranger = strangerWitness();
    approvals = await import('../../backend/services/tool-approval.js');
    asks = await import('../../backend/services/operator-ask.js');
    ledger = await import('../../backend/services/house-clock/wake-ledger.js');
    charter = await import('../../backend/services/house-clock/charter-store.js');
    ({ postQueue: queue } = await import('../../backend/services/social/post-queue.js'));
    proposals = await import('../../backend/services/sovereignty/proposal-store.js');
    const { default: router } = await import('../../backend/routes/waiting-routes.js');
    app = express();
    app.use('/api/v1/waiting', router);
    portals = [];
  });

  afterEach(async () => {
    for (const p of portals) await p.close();
    for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  });

  const account = async (who) => {
    const res = await request(app).get('/api/v1/waiting').set('Authorization', `Bearer ${who.token}`);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toContain('no-store');
    return res.body;
  };
  // A sitting of `who`'s on a real portal, bound to its being as the desk binds one.
  const sitting = async (who, laneId, sessionId) => {
    const portal = await openPortal();
    portals.push(portal);
    return { portal, connection: { ws: portal.ws, walletAddress: who.address, sessionId, companion: { neumaId: laneId, name: 'Kestrel', id: 'Kestrel' }, _writeOps: 0 } };
  };

  test('no token, no account', async () => {
    expect((await request(app).get('/api/v1/waiting')).status).toBe(401);
  });

  test('every source is counted, oldest first, each saying what, who, where and since — and deciding one drops it', async () => {
    // Five sources, filed in a known order a few ms apart: the oldest wait is the first filed.
    const ask = await ledger.fileAsk(operator.address, { seat: 'wait-seat', kind: 'decision', question: 'Which banner goes up?', why: 'the launch' });
    await tick();
    const written = await charter.writeCharter(operator.address, { goal: 'Run the launch week.', seats: [{ laneId: 'wait-seat', dailyCap: 2 }] },
      { by: operator.address, ownedLanes: ['wait-seat'] });
    await tick();
    const draft = await queue.add({ channelId: 'x', text: 'The house speaks.', queuedBy: 'wait-seat', authorNeumaId: 'wait-seat' });
    await tick();
    const proposal = await proposals.submitProposal('wait-seat', {
      class: 'prompt', title: 'Plain speech', body: 'I drift into flourish.', patch: { text: 'I prefer plain speech.' },
    });
    await tick();
    const { portal, connection } = await sitting(operator, 'wait-seat', 'sess-1');
    const allowed = approvals.requestToolApproval(connection, { tool: 'web/web_search', args: { query: 'launch week' } });
    await until(() => portal.frames.some((f) => f.type === 'tool:approval_request'));
    await tick();
    const answered = asks.requestOperatorAnswer(connection, { questions: [{ question: 'Ship today?', options: [{ label: 'Yes' }, { label: 'No' }] }] });
    await until(() => portal.frames.some((f) => f.type === 'operator:ask'));
    const card = portal.frames.find((f) => f.type === 'tool:approval_request');
    const question = portal.frames.find((f) => f.type === 'operator:ask');

    let now = await account(operator);
    expect(now.gaps).toEqual([]);
    expect(now.count).toBe(6);
    expect(now.items.map((i) => i.kind)).toEqual(['house-ask', 'charter', 'post', 'proposal', 'approval', 'ask']);
    expect(now.oldestAt).toBe(now.items[0].at);
    const at = now.items.map((i) => Date.parse(i.at));
    expect(at).toEqual([...at].sort((a, b) => a - b));
    const by = Object.fromEntries(now.items.map((i) => [i.kind, i]));
    expect(by['house-ask']).toMatchObject({ title: 'Which banner goes up?', who: { laneId: 'wait-seat' }, where: { app: 'houseclock', tab: 'asks', askId: ask.id } });
    expect(by.charter).toMatchObject({ who: null, where: { app: 'houseclock', tab: 'charter' }, title: expect.stringContaining(`version ${written.version}`) });
    // A being's words carry the AI disclosure line (social/disclosure-line.js).
    expect(by.post).toMatchObject({ text: 'The house speaks.\n\nMade with AI.', oneTap: true, where: { app: 'x', channelId: 'x', entryId: draft.id, section: 'posts' } });
    expect(by.proposal).toMatchObject({ title: 'Plain speech', where: { app: 'sovereignty', neumaId: 'wait-seat', proposalId: proposal.id } });
    expect(by.approval).toMatchObject({ title: 'web/web_search', who: { laneId: 'wait-seat', name: 'Kestrel' },
      where: { app: 'chat', cardId: card.id, sessionId: 'sess-1', neumaId: 'wait-seat', beingKind: 'local' } });
    expect(by.ask).toMatchObject({ title: 'Ship today?', where: { app: 'chat', cardId: question.id, sessionId: 'sess-1' } });

    // Each decided through its own real path; the count is the true count after every one.
    expect(approvals.resolveToolApproval(connection, card.id, 'deny')).toBe(true);
    expect(await allowed).toBe('deny');
    expect((await account(operator)).count).toBe(5);
    expect(asks.resolveOperatorAsk(connection, question.id, 'Yes')).toBe(true);
    await answered;
    await ledger.closeAsk(operator.address, { id: ask.id, by: operator.address });
    await charter.approveCharter(operator.address, { version: written.version, by: operator.address });
    expect((await account(operator)).items.map((i) => i.kind)).toEqual(['post', 'proposal']);
    await queue.reject(draft.id, { decidedBy: operator.address });
    await proposals.decideProposal('wait-seat', proposal.id, { verdict: 'decline', notes: '', wallet: operator.address });
    now = await account(operator);
    expect(now).toEqual({ count: 0, oldestAt: null, items: [], gaps: [], mandate: null });
  });

  test('a card whose portal closed with it on screen still waits — and the answer from a later portal settles it', async () => {
    const { portal, connection } = await sitting(operator, 'wait-seat', 'sess-park');
    const decided = approvals.requestToolApproval(connection, { tool: 'web/web_fetch', args: { url: 'https://example.com' } });
    await until(() => portal.frames.some((f) => f.type === 'tool:approval_request'));
    const card = portal.frames.find((f) => f.type === 'tool:approval_request');
    portal.client.close();
    await until(() => portal.ws.readyState === portal.ws.CLOSED);
    approvals.expirePendingApprovals(connection);
    expect((await account(operator)).items.map((i) => [i.kind, i.where.cardId])).toEqual([['approval', card.id]]);

    const later = await sitting(operator, 'wait-seat', 'sess-park');
    expect(approvals.resolveToolApproval(later.connection, card.id, 'deny')).toBe(true);
    expect(await decided).toBe('deny');
    expect((await account(operator)).count).toBe(0);
  });

  test('houses are never confused: each sees only its own, a stranger sees nothing', async () => {
    await ledger.fileAsk(operator.address, { seat: 'wait-seat', kind: 'decision', question: 'Mine?', why: 'x' });
    await ledger.fileAsk(other.address, { seat: 'other-seat', kind: 'decision', question: 'Theirs?', why: 'y' });
    await queue.add({ channelId: 'x', text: 'Operator house post.', queuedBy: 'wait-seat', authorNeumaId: 'wait-seat' });
    await queue.add({ channelId: 'x', text: 'Other house post.', queuedBy: 'other-seat', authorNeumaId: 'other-seat' });
    // a draft the operator staged by hand (no being) is the operator's house's too
    await queue.add({ channelId: 'x', text: 'Staged by hand.', queuedBy: operator.address.toLowerCase() });
    const { portal, connection } = await sitting(other, 'other-seat', 'sess-other');
    const pending = approvals.requestToolApproval(connection, { tool: 'web/web_search', args: { query: 'q' } });
    await until(() => portal.frames.some((f) => f.type === 'tool:approval_request'));

    const mine = await account(operator);
    expect(mine.items.map((i) => i.title).sort()).toEqual(['Mine?', 'Operator house post.\n\nMade with AI.', 'Staged by hand.']);
    const theirs = await account(other);
    expect(theirs.items.map((i) => i.title).sort()).toEqual(['Other house post.\n\nMade with AI.', 'Theirs?', 'web/web_search']);
    expect((await account(stranger)).count).toBe(0);

    approvals.resolveToolApproval(connection, portal.frames.find((f) => f.type === 'tool:approval_request').id, 'deny');
    await pending;
  });

  test('a placeholder and a decided entry wait on no one', async () => {
    await queue.add({ channelId: 'x', text: 'Not copy yet.', placeholder: true, queuedBy: 'wait-seat', authorNeumaId: 'wait-seat' });
    const real = await queue.add({ channelId: 'x', text: 'Real copy.', queuedBy: 'wait-seat', authorNeumaId: 'wait-seat' });
    expect((await account(operator)).items.map((i) => i.title)).toEqual(['Real copy.\n\nMade with AI.']);
    await queue.approve(real.id, { decidedBy: operator.address });
    expect((await account(operator)).count).toBe(0);
  });
});
