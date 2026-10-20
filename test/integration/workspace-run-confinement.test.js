/**
 * team/workspace-run confinement — the being's own script, run through the
 * REAL intent sweep, the REAL approval broker over a REAL WebSocket pair, and
 * the REAL bubblewrap sandbox (RULE 0: no mocks).
 *
 * The gnosis: in AUTO the run still pauses on the operator's card, and that
 * card carries the code and its hash; the script that runs sees none of the
 * backend's secrets (a FAKE AUTH_SECRET is set for the proof), cannot read a
 * file outside its arena or the arena's own .env, and cannot reach the
 * loopback; a file rewritten after the card is refused.
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import net from 'net';
import { createServer } from 'http';
import { execFileSync } from 'child_process';
import { WebSocketServer, WebSocket } from 'ws';
import { createTempDir } from '../helpers/temp-fs.js';
import { handlePortalMessage } from '../../backend/routes/portal-message-handlers.js';
import { portalConnections } from '../../backend/routes/portal-connections.js';
import { createPortalConnection } from '../../backend/services/portal-connection.js';
import { sweepIntents } from '../../backend/services/intents/intent-sweep.js';
import workspace, { setWorkspacesRoot, getWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { getRealmRoot, setRealmRoot } from '../../backend/services/user-realm.js';

const NEUMA_ID = 'arenaecho';
const WALLET = '0x5555555555555555555555555555555555555555';
const FAKE_AUTH = 'FAKE-auth-secret-for-the-confinement-proof';
const ENV_KEYS = ['AUTH_SECRET', 'DNA_ENCRYPTION_KEY', 'NEUMA_DATA_ROOT', 'NEUMA_STAFF_COS_PATH'];
// What a confined run may see: the sandbox's own names, and what bash adds.
const SANDBOX_ENV = new Set(['HOME', 'PATH', 'LANG', 'CI', 'NO_COLOR', 'SDL_VIDEODRIVER', 'SDL_AUDIODRIVER',
  'MPLBACKEND', 'PYTHONUSERBASE', 'PWD', 'SHLVL', '_', 'OLDPWD']);

// The probe prints only names and verdicts, never a byte of what it read.
const probeScript = ({ outside, repoEnv, port }) => `import os, json, socket, site
def reach(p):
    try:
        open(p).read()
        return "READ"
    except Exception as e:
        return "ERR:" + type(e).__name__
r = {"keys": sorted(os.environ.keys()), "outside": reach(${JSON.stringify(outside)}),
     "repoEnv": reach(${JSON.stringify(repoEnv)}), "userSite": os.path.isdir(site.getusersitepackages())}
s = socket.socket()
s.settimeout(2)
try:
    s.connect(("127.0.0.1", ${port}))
    r["loopback"] = "CONNECTED"
except Exception as e:
    r["loopback"] = "ERR:" + type(e).__name__
print("PROOF" + json.dumps(r))
`;

describe('team/workspace-run — the being\'s code runs confined, behind a card that shows it', () => {
  let house, arena, outsideDir, realm, prevRealm, origRoot, savedEnv;
  let httpServer, wss, serverWs, client, clientLog, listener, port;
  let onCard = null; // the desk's answer to tool:approval_request

  const seat = () => {
    const connection = createPortalConnection({ ws: serverWs, walletAddress: WALLET });
    connection.companion = { name: 'ArenaEcho', neumaId: NEUMA_ID };
    connection._teamWorkspace = { root: arena, budgetBytes: 1024 * 1024, usedBytes: 0 };
    portalConnections.set('workspace-run-confinement', connection);
    return connection;
  };
  const fileIntent = async (name, payload) => {
    const dir = path.join(workspace.pathFor(NEUMA_ID), 'intents');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, `${name}.json`), JSON.stringify(payload));
  };
  const sweep = (connection) => sweepIntents(connection, { mode: 'auto', lanePolicy: null, emit: () => {} });

  beforeAll(async () => {
    savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    process.env.AUTH_SECRET = FAKE_AUTH;
    process.env.DNA_ENCRYPTION_KEY = 'test-encryption-key-32-characters!';
    house = await createTempDir('ws-run-confine-house');
    process.env.NEUMA_DATA_ROOT = house;
    process.env.NEUMA_STAFF_COS_PATH = path.join(house, 'staff-cos.json');
    origRoot = getWorkspacesRoot();
    setWorkspacesRoot(path.join(house, 'workspaces'));
    realm = await createTempDir('ws-run-confine-realm');
    prevRealm = getRealmRoot();
    setRealmRoot(realm);
    await workspace.create(NEUMA_ID);
    arena = path.join(house, 'arena');
    outsideDir = path.join(house, 'beside-the-arena');
    await fs.mkdir(arena, { recursive: true });
    await fs.mkdir(outsideDir, { recursive: true });
    await fs.writeFile(path.join(arena, '.env'), 'AUTH_SECRET=FAKE-inside-arena\n');
    await fs.writeFile(path.join(outsideDir, 'notes.txt'), 'FAKE-outside-arena\n');

    listener = net.createServer((sock) => sock.end());
    port = await new Promise((resolve) => listener.listen(0, '127.0.0.1', () => resolve(listener.address().port)));

    httpServer = createServer();
    wss = new WebSocketServer({ server: httpServer });
    const wsPort = await new Promise((resolve) => httpServer.listen(0, () => resolve(httpServer.address().port)));
    const linked = new Promise((resolve) => {
      wss.on('connection', (ws) => {
        serverWs = ws;
        ws.on('message', (d) => handlePortalMessage('workspace-run-confinement', JSON.parse(d.toString()), { birthHandler: null }));
        resolve();
      });
    });
    client = new WebSocket(`ws://localhost:${wsPort}`);
    clientLog = [];
    client.on('message', async (data) => {
      const msg = JSON.parse(data.toString());
      clientLog.push(msg);
      if (msg.type === 'tool:approval_request' && onCard) {
        const decision = await onCard(msg);
        client.send(JSON.stringify({ type: 'tool:approval_response', id: msg.id, decision }));
      }
    });
    await Promise.all([linked, new Promise((resolve) => client.on('open', resolve))]);
  }, 60000);

  afterAll(async () => {
    client?.close();
    wss?.close();
    httpServer?.close();
    listener?.close();
    portalConnections.delete('workspace-run-confinement');
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
    setWorkspacesRoot(origRoot);
    setRealmRoot(prevRealm);
    await fs.rm(house, { recursive: true, force: true });
    await fs.rm(realm, { recursive: true, force: true });
  });

  test('AUTO still raises the card, the card shows the code, and the run sees no secret, no outside file, no network', async () => {
    const repoEnv = path.resolve('.env');
    const source = probeScript({ outside: path.join(outsideDir, 'notes.txt'), repoEnv, port });
    await fs.writeFile(path.join(arena, 'probe.py'), source);
    const cards = [];
    onCard = async (msg) => { cards.push(msg); return 'allow'; };
    await fileIntent('confined-probe', { type: 'team/workspace-run', file: 'probe.py' });
    const receipts = await sweep(seat());

    expect(cards).toHaveLength(1);
    expect(cards[0].tool).toBe('intents/team.workspace-run');
    expect(cards[0].args).toContain('"runs": "python3 ');
    expect(cards[0].args).toMatch(/"sha256": "[0-9a-f]{64}"/);
    expect(cards[0].args).toContain('import os, json, socket, site');

    expect(receipts[0].status).toBe('ok');
    const proof = JSON.parse(receipts[0].content.split('PROOF')[1].split('\n')[0]);
    expect(proof.keys).not.toContain('AUTH_SECRET');
    expect(proof.keys).not.toContain('DNA_ENCRYPTION_KEY');
    expect(proof.keys.filter((k) => !SANDBOX_ENV.has(k))).toEqual([]);
    expect(proof.outside).toMatch(/^ERR:/);
    expect(proof.repoEnv).toMatch(/^ERR:/);
    expect(proof.loopback).toMatch(/^ERR:/);
    expect(receipts[0].content).not.toContain('FAKE-');
    // The deliverable's libraries still import: the host's user site shows read-only.
    const hostSite = execFileSync('python3', ['-c', 'import os,site;print(os.path.isdir(site.getusersitepackages()))'], {
      env: { ...process.env, HOME: os.homedir() },
    }).toString().trim() === 'True';
    expect(proof.userSite).toBe(hostSite);
  }, 60000);

  test('the arena\'s own secret-shaped files read empty inside the run', async () => {
    await fs.writeFile(path.join(arena, 'peek.py'), 'print("ENVLEN", len(open(".env").read()))\n');
    onCard = async () => 'allow';
    await fileIntent('peek-env', { type: 'team/workspace-run', file: 'peek.py' });
    const receipts = await sweep(seat());
    expect(receipts[0].status).toBe('ok');
    expect(receipts[0].content).toContain('ENVLEN 0');
  }, 60000);

  test('a file rewritten after the operator saw the card is refused, never run', async () => {
    const file = path.join(arena, 'swap.py');
    await fs.writeFile(file, 'print("the bytes on the card")\n');
    onCard = async () => {
      await fs.writeFile(file, 'print("bytes nobody approved")\n');
      return 'allow';
    };
    await fileIntent('swap', { type: 'team/workspace-run', file: 'swap.py' });
    const receipts = await sweep(seat());
    expect(receipts[0].status).toBe('error');
    expect(receipts[0].error).toContain('changed after your operator\'s card');
    expect(JSON.stringify(receipts)).not.toContain('bytes nobody approved');
  }, 60000);
});
