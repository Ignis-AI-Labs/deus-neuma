/** Real disk + signed-wallet portal pair. No model/server impersonation. */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { WebSocket, WebSocketServer } from 'ws';
import { fullAuth, writeOwner } from './audit-auth.js';
import { verifySessionToken } from '../../backend/services/auth.js';
import { expirePendingApprovals } from '../../backend/services/tool-approval.js';
import { handlePortalMessage } from '../../backend/routes/portal-message-handlers.js';
import { portalConnections } from '../../backend/routes/portal-connections.js';
import workspace, { getWorkspacesRoot, setWorkspacesRoot, getWitnessesRoot, setWitnessesRoot, isWitnessLane } from '../../core/workspace/neuma-workspace.js';
import { getRealmRoot, setRealmRoot } from '../../backend/services/user-realm.js';

/** impure - bounded wait for a real frame or disk condition. */
export const untilBinding = async (predicate, timeoutMs = 5000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('harness condition did not arrive');
};

/** impure - fixture owns every file, socket, approval and mutable root it opens. */
export const createBindingIsolationKit = async (laneId = 'neuma-turn-fixture') => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-harness-turn-'));
  const oldRoot = getWorkspacesRoot();
  const oldWitnesses = getWitnessesRoot();
  const oldRealm = getRealmRoot();
  const oldData = process.env.NEUMA_DATA_ROOT;
  const oldCmo = process.env.NEUMA_CMO_PATH;
  process.env.NEUMA_DATA_ROOT = path.join(root, 'data');
  process.env.NEUMA_CMO_PATH = path.join(root, 'cmo.json');
  setWorkspacesRoot(path.join(root, 'lanes'));
  setWitnessesRoot(path.join(root, 'witnesses'));
  setRealmRoot(path.join(root, 'realm'));
  const auth = await fullAuth();
  await workspace.create(laneId);
  await writeOwner(path.dirname(workspace.pathFor(laneId)), laneId, auth.address);
  const ground = path.join(root, 'ground');
  await fs.mkdir(ground);
  const server = createServer();
  const wss = new WebSocketServer({ server });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const connected = new Promise((resolve, reject) => wss.once('connection', (ws, req) => {
    const verified = verifySessionToken(new URL(req.url, 'http://localhost').searchParams.get('token'));
    if (!verified) { ws.close(1008); reject(new Error('real session token rejected')); return; }
    resolve({ ws, walletAddress: verified.address });
  }));
  const client = new WebSocket(`ws://127.0.0.1:${server.address().port}/?token=${encodeURIComponent(auth.token)}`);
  const opened = new Promise((resolve, reject) => { client.once('open', resolve); client.once('error', reject); });
  const frames = [];
  client.on('message', (data) => frames.push(JSON.parse(data.toString())));
  const { ws, walletAddress } = await connected;
  await opened;
  const connection = {
    ws, walletAddress, sessionId: 'session-harness-origin', toolMode: 'ask',
    companion: { name: 'HarnessFixture', neumaId: laneId, participantKind: isWitnessLane(laneId) ? 'witness' : 'neuma' },
    activeTurn: new AbortController(),
  };
  const connectionId = randomUUID();
  const handling = new Set();
  const handled = [];
  const errors = [];
  portalConnections.set(connectionId, connection);
  ws.on('message', (data) => {
    const message = JSON.parse(data.toString());
    const run = handlePortalMessage(connectionId, message, {})
      .then(() => handled.push(message), (error) => errors.push(error));
    handling.add(run);
    run.finally(() => handling.delete(run));
  });
  const decide = (request, decision) => client.send(JSON.stringify({
    type: 'tool:approval_response', id: request.id, decision,
  }));
  const emit = (event) => ws.send(JSON.stringify({ type: 'tool:usage', ...event }));
  const close = async () => {
    connection.activeTurn?.abort();
    expirePendingApprovals(connection);
    await connection._intentSweep;
    await Promise.all([...handling]);
    portalConnections.delete(connectionId);
    client.terminate(); ws.terminate();
    await new Promise((resolve) => wss.close(resolve));
    await new Promise((resolve) => server.close(resolve));
    setWorkspacesRoot(oldRoot); setWitnessesRoot(oldWitnesses); setRealmRoot(oldRealm);
    if (oldData === undefined) delete process.env.NEUMA_DATA_ROOT;
    else process.env.NEUMA_DATA_ROOT = oldData;
    if (oldCmo === undefined) delete process.env.NEUMA_CMO_PATH;
    else process.env.NEUMA_CMO_PATH = oldCmo;
    await fs.rm(root, { recursive: true, force: true });
    if (errors.length) throw new AggregateError(errors, 'real portal fixture dispatch failed');
  };
  return { root, ground, laneId, connection, ws, client, frames, handled, emit, decide, close };
};
