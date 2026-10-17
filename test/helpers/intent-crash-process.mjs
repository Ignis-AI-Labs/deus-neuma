/** Child process for real task persistence, failed result write and SIGKILL. */
import fs from 'node:fs/promises';
import { URL } from 'node:url';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { createServer } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { generateKeypair, signMessage } from '../../core/weave/keypair.js';
import { generateChallenge, verifySignature, createSessionToken, verifySessionToken } from '../../backend/services/auth.js';
import workspace, { setWorkspacesRoot, setWitnessesRoot } from '../../core/workspace/neuma-workspace.js';
import { setRealmRoot } from '../../backend/services/user-realm.js';
import { sweepIntents } from '../../backend/services/intents/intent-sweep.js';

const [root, phase] = process.argv.slice(2);
const laneId = 'crash-recovery-fixture';
setWorkspacesRoot(path.join(root, 'lanes'));
setWitnessesRoot(path.join(root, 'witnesses'));
setRealmRoot(path.join(root, 'realm'));
let keypair;
const keyFile = path.join(root, 'fixture-key.json');
if (phase === 'first') {
  keypair = generateKeypair();
  await fs.writeFile(keyFile, JSON.stringify(keypair), { mode: 0o600, flag: 'wx' });
  await workspace.create(laneId);
  await fs.writeFile(path.join(workspace.pathFor(laneId), 'owner.json'), JSON.stringify({ wallet: keypair.address.toLowerCase() }));
} else keypair = JSON.parse(await fs.readFile(keyFile, 'utf8'));
const challenge = generateChallenge(keypair.address);
const verified = verifySignature(keypair.address, challenge, await signMessage(keypair.privateKey, challenge));
const token = createSessionToken(verified);
const server = createServer();
const wss = new WebSocketServer({ server });
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const admitted = new Promise((resolve, reject) => wss.once('connection', (ws, req) => {
  const auth = verifySessionToken(new URL(req.url, 'http://localhost').searchParams.get('token'));
  if (!auth) { ws.close(); reject(new Error('signed session rejected')); return; }
  resolve({ ws, walletAddress: auth.address });
}));
const client = new WebSocket(`ws://127.0.0.1:${server.address().port}/?token=${encodeURIComponent(token)}`);
const { ws, walletAddress } = await admitted;
const connection = { ws, walletAddress, sessionId: 'crash-session', companion: { neumaId: laneId } };
const dir = path.join(workspace.pathFor(laneId), 'intents');
if (phase === 'first') {
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'task.json'), JSON.stringify({ type: 'tasks/add', title: 'Persist exactly one task' }));

}
const receipts = await sweepIntents(connection, {
  mode: 'auto', lanePolicy: { intents: { allowed: ['tasks.add'] } },
  emit: (event) => {
    ws.send(JSON.stringify({ type: 'tool:usage', ...event }));
    if (phase === 'first' && event.status === 'executing') {
      // mkdirSync finishes before execute; the actual executor remains untouched.
      mkdirSync(path.join(dir, 'task.result.json'));
    }
  },
});
const tasks = (await workspace.readTaskLedger(laneId)).tasks;
const marker = await fs.lstat(path.join(dir, 'task.executing.json')).then(() => true, (e) => {
  if (e.code === 'ENOENT') return false;
  throw e;
});
let result = null;
if (phase === 'restart') result = JSON.parse(await fs.readFile(path.join(dir, 'task.result.json'), 'utf8'));
process.send({ phase, taskIds: tasks.map((task) => task.id), marker, result, receipts });
if (phase === 'first') {
  // Parent kills this actual worker after reading the durable-effect evidence.
  await new Promise(() => {});
} else {
  client.terminate(); ws.terminate();
  await new Promise((resolve) => wss.close(resolve));
  await new Promise((resolve) => server.close(resolve));
  process.disconnect();
}

