import { beforeAll, afterAll, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import WebSocket, { WebSocketServer } from 'ws';
import { sealTestWitness } from '../helpers/sealed-test-witness.js';

let root, server, wss, terminalWss, store, empty, mint, token, address, connections, approval, witnessLane;
const clients = [];
const HOST = 'revocation.test.ts.net';
const waitFor = async (predicate) => {
  for (let n = 0; n < 200; n++) {
    const result = predicate();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Portal condition did not arrive');
};
const connect = async (pair) => {
  const headers = pair ? { host: HOST, 'x-forwarded-for': '100.90.0.2', cookie: `neuma_remote=${pair.secret}` } : {};
  const ws = new WebSocket(`ws://127.0.0.1:${server.address().port}/ws?token=${encodeURIComponent(token)}`, { headers });
  const messages = [];
  ws.on('message', (raw) => messages.push(JSON.parse(raw)));
  clients.push(ws);
  const established = await waitFor(() => messages.find((m) => m.type === 'portal:established'));
  return { ws, messages, connection: connections.connectionFor(established.connectionId) };
};
const mode = async (client) => {
  const id = randomBytes(8).toString('hex');
  const before = client.messages.length;
  client.ws.send(JSON.stringify({ type: 'tool:mode', mode: 'observe', messageId: id }));
  return waitFor(() => client.messages.slice(before).find((m) => m.type === 'tool:mode'));
};
const enable = (devices) => store.save({ ...empty, enabled: true, origin: HOST, devices });

beforeAll(async () => {
  root = await fs.mkdtemp('/tmp/neuma-revocation-');
  Object.assign(process.env, { NEUMA_DATA_ROOT: path.join(root, 'data'), NEUMA_REALM_ROOT: path.join(root, 'realm'), WORKSPACES_ROOT: path.join(root, 'workspaces'), WITNESSES_ROOT: path.join(root, 'witness-ground'), PLATFORM_DB_PATH: path.join(root, 'platform.db'), AUTH_SECRET: randomBytes(32).toString('hex') });
  // A real witness sealed on this test's disk, and a fresh operator wallet — no one's own env.
  const sealed = await sealTestWitness(root);
  witnessLane = sealed.laneId;
  const remote = await import('../../backend/services/remote/remote-store.js');
  store = remote.remoteStore; empty = remote.EMPTY_REMOTE_STATE;
  const pairing = await import('../../backend/services/remote/pairing.js');
  mint = (now) => pairing.mintDevice({ address, label: 'Trace isolated proof', ...(now ? { now } : {}) });
  const auth = await import('../../backend/services/auth.js');
  const wallet = sealed.operator;
  address = wallet.address;
  const challenge = auth.generateChallenge(address);
  token = auth.createSessionToken(auth.verifySignature(address, challenge, await wallet.signMessage(challenge)));
  const { attachUpgradeRouter } = await import('../../backend/services/ws-upgrade-router.js');
  const portal = await import('../../backend/routes/portal-routes.js');
  connections = (await import('../../backend/routes/portal-connections.js')).__test;
  approval = await import('../../backend/services/tool-approval.js');
  server = http.createServer();
  wss = new WebSocketServer({ noServer: true });
  terminalWss = new WebSocketServer({ noServer: true });
  attachUpgradeRouter(server, { wss, terminalWss });
  portal.setupPortalRoutes(wss, {});
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
}, 30000);

afterAll(async () => {
  for (const ws of clients) ws.terminate();
  if (wss) {
    for (const ws of wss.clients) ws.terminate();
    await new Promise((resolve) => wss.close(resolve));
    await new Promise((resolve) => terminalWss.close(resolve));
    await new Promise((resolve) => server.close(resolve));
  }
  if (root) await fs.rm(root, { recursive: true, force: true });
});

it('device removal closes only that device and settles its pending approval', async () => {
  const first = mint(), second = mint();
  await enable([first.device, second.device]);
  const a = await connect(first), b = await connect(second), local = await connect();
  expect((await mode(a)).mode).toBe('observe');
  const pending = approval.requestToolApproval(a.connection, { tool: 'filesystem/read_file', args: { path: '/isolated-proof' } });
  await waitFor(() => a.messages.find((m) => m.type === 'tool:approval_request'));
  await enable([second.device]);
  await waitFor(() => a.ws.readyState === WebSocket.CLOSED);
  expect(a.connection.ws.remoteRevoked).toBe(true);
  expect(await pending).toBe('deny');
  expect(approval.parkedApprovalCount()).toBe(0);
  expect((await mode(b)).mode).toBe('observe');
  expect((await mode(local)).mode).toBe('observe');
});

it.each(['rotate', 'disable'])('%s revokes existing phone sockets while the local desk works', async (operation) => {
  const pair = mint();
  await enable([pair.device]);
  const remote = await connect(pair), local = await connect();
  await store.save(operation === 'disable' ? empty : { ...store.get(), devices: [], rotatedAt: new Date().toISOString() });
  await waitFor(() => remote.ws.readyState === WebSocket.CLOSED);
  expect(remote.connection.ws.remoteRevoked).toBe(true);
  expect((await mode(local)).mode).toBe('observe');
});

it('expires an already open device without another request', async () => {
  const { DEVICE_TTL_MS } = await import('../../backend/services/remote/pairing.js');
  const pair = mint(Date.now() - DEVICE_TTL_MS + 700);
  await enable([pair.device]);
  const remote = await connect(pair);
  await waitFor(() => remote.ws.readyState === WebSocket.CLOSED);
  expect(remote.connection.ws.remoteRevoked).toBe(true);
});


it('a disconnected approval remains answerable through a later signed portal', async () => {
  const phone = await connect();
  // Broker input: a sitting identifier. No lane binding or model execution is claimed.
  phone.connection.sessionId = 'isolated-approval-sitting';
  const pending = approval.requestToolApproval(phone.connection, { tool: 'filesystem/read_file', args: {} });
  const frame = await waitFor(() => phone.messages.find((m) => m.type === 'tool:approval_request'));
  phone.ws.close();
  await waitFor(() => approval.parkedApprovalCount() === 1);
  expect(approval.parkedApprovalsFor(address.toLowerCase(), 'another-sitting')).toEqual([]);
  const returned = await connect();
  returned.ws.send(JSON.stringify({ type: 'tool:approval_response', id: frame.id, decision: 'deny' }));
  expect(await pending).toBe('deny');
  expect(approval.parkedApprovalCount()).toBe(0);
});

it('a card parked on a closed portal is shown again when the same sitting is resumed, and answered there', async () => {
  const { writeOwner } = await import('../helpers/audit-auth.js');
  await writeOwner(process.env.WORKSPACES_ROOT, 'parkedlane', address);
  const first = await connect();
  first.connection.sessionId = 'resumed-parked-sitting';
  const pending = approval.requestToolApproval(first.connection, { tool: 'fs/list', args: { path: '.' } });
  const frame = await waitFor(() => first.messages.find((m) => m.type === 'tool:approval_request'));
  first.ws.close();
  await waitFor(() => approval.parkedApprovalsFor(address.toLowerCase(), 'resumed-parked-sitting').length === 1);
  const back = await connect();
  back.ws.send(JSON.stringify({ type: 'portal:resume', neumaId: 'parkedlane', companionName: 'Parked', sessionId: 'resumed-parked-sitting' }));
  const shown = await waitFor(() => back.messages.find((m) => m.type === 'tool:approval_request' && m.id === frame.id));
  expect(shown.tool).toBe(frame.tool);
  back.ws.send(JSON.stringify({ type: 'tool:approval_response', id: frame.id, decision: 'deny' }));
  expect(await pending).toBe('deny');
});

// The flight check's finding 2 (2026-10-17): an INTENT's card died with its portal (the sweep was
// cancelled on close), so it was never offered again and the intent waited for a new card.
it('an intent card parked on a closed portal is offered again on resume, and its answer settles the intent', async () => {
  const { writeOwner } = await import('../helpers/audit-auth.js');
  const { sweepIntents } = await import('../../backend/services/intents/intent-sweep.js');
  await writeOwner(process.env.WORKSPACES_ROOT, 'intentlane', address);
  const intents = path.join(process.env.WORKSPACES_ROOT, 'intentlane', 'intents');
  await fs.mkdir(intents, { recursive: true });
  await fs.writeFile(path.join(intents, 'park-1.json'), JSON.stringify({ type: 'tasks/add', title: 'The parked task' }));
  const first = await connect();
  first.connection.companion = { neumaId: 'intentlane', name: 'Intent' };
  first.connection.sessionId = 'parked-intent-sitting';
  const swept = sweepIntents(first.connection, { mode: 'ask', lanePolicy: null, emit: () => {} });
  const frame = await waitFor(() => first.messages.find((m) => m.type === 'tool:approval_request'));
  expect(frame.tool).toBe('intents/tasks.add');
  first.ws.close();
  await waitFor(() => approval.parkedApprovalsFor(address.toLowerCase(), 'parked-intent-sitting').length === 1);
  const back = await connect();
  back.ws.send(JSON.stringify({ type: 'portal:resume', neumaId: 'intentlane', companionName: 'Intent', sessionId: 'parked-intent-sitting' }));
  await waitFor(() => back.messages.find((m) => m.type === 'tool:approval_request' && m.id === frame.id));
  back.ws.send(JSON.stringify({ type: 'tool:approval_response', id: frame.id, decision: 'deny' }));
  expect(await swept).toEqual([expect.objectContaining({ tool: 'intents/tasks.add', status: 'denied' })]);
  expect(JSON.parse(await fs.readFile(path.join(intents, 'park-1.result.json'), 'utf8')).status).toBe('denied');
});

it('an intent swept after its portal closed raises no card and stays pending — a closed portal is never a verdict', async () => {
  const { sweepIntents } = await import('../../backend/services/intents/intent-sweep.js');
  const intents = path.join(process.env.WORKSPACES_ROOT, 'intentlane', 'intents');
  await fs.writeFile(path.join(intents, 'late-1.json'), JSON.stringify({ type: 'tasks/add', title: 'Filed as the portal closed' }));
  const client = await connect();
  client.connection.companion = { neumaId: 'intentlane', name: 'Intent' };
  client.connection.sessionId = 'closed-intent-sitting';
  client.ws.close();
  await waitFor(() => client.connection.ws.readyState === WebSocket.CLOSED);
  expect(await sweepIntents(client.connection, { mode: 'ask', lanePolicy: null, emit: () => {} })).toEqual([]);
  await expect(fs.access(path.join(intents, 'late-1.result.json'))).rejects.toThrow();
});

it('asks on a closed portal settle and navigation on an open portal denies', async () => {
  const client = await connect();
  client.ws.close();
  await waitFor(() => client.connection.ws.readyState === WebSocket.CLOSED);
  expect(await approval.requestToolApproval(client.connection, { tool: 'filesystem/read_file', args: {} })).toBe('deny');
  const open = await connect();
  const pending = approval.requestToolApproval(open.connection, { tool: 'filesystem/read_file', args: {} });
  await waitFor(() => open.messages.find((m) => m.type === 'tool:approval_request'));
  approval.expirePendingApprovals(open.connection);
  expect(await pending).toBe('deny');
});

it('an actual abort signal settles a parked ask', async () => {
  const client = await connect();
  client.connection.sessionId = 'isolated-abort-sitting';
  const abort = new AbortController();
  const pending = approval.requestToolApproval(client.connection, { tool: 'filesystem/read_file', args: {}, signal: abort.signal });
  await waitFor(() => client.messages.find((m) => m.type === 'tool:approval_request'));
  client.ws.close();
  await waitFor(() => approval.parkedApprovalCount() === 1);
  abort.abort();
  expect(await pending).toBe('interrupted');
  expect(approval.parkedApprovalCount()).toBe(0);
});


// THE MODEL LINE (live test 2026-10-16): a parked card held its turn's slot, and a house wake
// waited 15 minutes behind it. The real line, the real turn wrapper, the real broker and portal.
const lined = async () => {
  const { substrateLine } = await import('../../backend/services/substrate-lease.js');
  const { lineTurn } = await import('../../backend/services/turn-line.js');
  const fill = (n) => Promise.all(Array.from({ length: n }, (_, i) => substrateLine.acquire({ kind: 'turn', label: `busy-${i}` })));
  const settled = async (p) => { let done = false; p.then(() => { done = true; }, () => { done = true; }); await new Promise((r) => setTimeout(r, 30)); return done; };
  return { substrateLine, lineTurn, fill, settled };
};

it('a parked card gives its turn\'s place in the line to a wake; its answer waits for a place, then the turn goes on', async () => {
  const { substrateLine, lineTurn, fill, settled } = await lined();
  const phone = await connect();
  phone.connection.sessionId = 'isolated-line-sitting';
  const turn = lineTurn(phone.connection, () => approval.requestToolApproval(phone.connection, { tool: 'filesystem/read_file', args: {} }));
  const frame = await waitFor(() => phone.messages.find((m) => m.type === 'tool:approval_request'));
  const busy = await fill(substrateLine.snapshot().capacity - 1);
  const wake = substrateLine.acquire({ kind: 'wake', label: 'Signal (wake)' });
  expect(await settled(wake)).toBe(false); // the line is full: the wake waits behind the card
  phone.ws.close();
  await waitFor(() => approval.parkedApprovalCount() === 1);
  const wakeLease = await wake; // the parked card stepped out: the wake has its place
  expect(substrateLine.snapshot().running.map((r) => r.label)).toContain('Signal (wake)');
  const returned = await connect();
  returned.ws.send(JSON.stringify({ type: 'tool:approval_response', id: frame.id, decision: 'deny' }));
  await waitFor(() => returned.messages.find((m) => m.type === 'tool:approval_resolved' && m.id === frame.id));
  expect(await settled(turn)).toBe(false); // answered, but the line is full: it waits its turn
  expect(substrateLine.snapshot().waiting.map((w) => w.label)).toEqual(['a chat']);
  busy[0].release();
  expect(await turn).toBe('deny');
  wakeLease.release();
  busy.slice(1).forEach((b) => b.release());
  expect(substrateLine.snapshot()).toMatchObject({ running: [], waiting: [] });
});

it('a card on a live screen keeps its turn\'s place: the wake waits until the turn is done', async () => {
  const { substrateLine, lineTurn, fill, settled } = await lined();
  const desk = await connect();
  desk.connection.sessionId = 'isolated-live-line-sitting';
  const turn = lineTurn(desk.connection, () => approval.requestToolApproval(desk.connection, { tool: 'filesystem/read_file', args: {} }));
  const frame = await waitFor(() => desk.messages.find((m) => m.type === 'tool:approval_request'));
  const busy = await fill(substrateLine.snapshot().capacity - 1);
  const wake = substrateLine.acquire({ kind: 'wake', label: 'Signal (wake)' });
  expect(await settled(wake)).toBe(false);
  desk.ws.send(JSON.stringify({ type: 'tool:approval_response', id: frame.id, decision: 'deny' }));
  expect(await turn).toBe('deny');
  (await wake).release();
  busy.forEach((b) => b.release());
  expect(substrateLine.snapshot()).toMatchObject({ running: [], waiting: [] });
});

it('a revoked socket cannot announce a late completion to its local sibling', async () => {
  const { verifiedWitnessForLane } = await import('../../backend/routes/portal-witness-binding.js');
  const { ensureWitnessLane } = await import('../../backend/services/witness-lane.js');
  const lane = witnessLane;
  const identity = await verifiedWitnessForLane(lane);
  expect(identity).toBeTruthy();
  await ensureWitnessLane(identity.sealed, address, { summoning: true });
  const pair = mint();
  await enable([pair.device]);
  const phone = await connect(pair), local = await connect();
  const sessionId = 'revoked-sibling-proof';
  for (const client of [phone, local]) {
    client.ws.send(JSON.stringify({ type: 'portal:resume', neumaId: lane, sessionId }));
    await waitFor(() => client.messages.find((m) => m.type === 'portal:resumed' && m.sessionId === sessionId));
  }
  await store.save(empty);
  await waitFor(() => phone.ws.readyState === WebSocket.CLOSED);
  const before = local.messages.length;
  // A real server socket's attempted late protocol output, not model inference.
  phone.connection.ws.send(JSON.stringify({ type: 'consciousness:complete', sessionId }));
  await mode(local); // round trip after the attempted send drains earlier frames.
  expect(local.messages.slice(before).filter((m) => m.type === 'portal:sibling')).toEqual([]);
});
