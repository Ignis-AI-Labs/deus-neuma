/**
 * The house a TikTok being test stands in (test/integration/tiktok-being-*.test.js):
 * two houses on temp ground, each with its own wallet, its own TikTok sign-in
 * (stand-in tokens only) and its own holder; renders filed by the REAL image
 * store into a lane's own art folder; a REAL WebSocket pair on which the
 * operator answers cards; the real social router behind signed sessions.
 *
 * Nothing here fakes a claimed path: the TikTok API is the local stand-in
 * (test/helpers/tiktok-stand-in.js), the only thing that is not the real
 * service, and every TIKTOK_* key is cleared so no real credential is read.
 */
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { createServer } from 'http';
import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { createTempDir } from './temp-fs.js';
import { fullAuth, writeOwner } from './audit-auth.js';
import { useServedHouse } from './served-house.js';
import { startTikTokStandIn } from './tiktok-stand-in.js';
import { verifySessionToken } from '../../backend/services/auth.js';
import { getRealmRoot, setRealmRoot } from '../../backend/services/user-realm.js';
import { setChannelCredential } from '../../backend/services/social/channel-credentials.js';
import { channelBindings } from '../../backend/services/social/channel-bindings.js';
import { collectOutputs } from '../../backend/services/image-forge/image-store.js';
import { resolveToolApproval } from '../../backend/services/tool-approval.js';
import { sweepIntents } from '../../backend/services/intents/intent-sweep.js';
import workspace from '../../core/workspace/neuma-workspace.js';
import router from '../../backend/routes/social-channel-routes.js';

const ENV = ['NEUMA_TIKTOK_API_ROOT', 'NEUMA_SOCIAL_POST_QUEUE_PATH', 'NEUMA_SOCIAL_BINDINGS_PATH', 'NEUMA_SOCIAL_CREDENTIALS_PATH',
  'NEUMA_SECTOR_CREW_PATH', 'TIKTOK_CLIENT_KEY', 'TIKTOK_CLIENT_SECRET', 'TIKTOK_REFRESH_TOKEN', 'TIKTOK_ACCESS_TOKEN',
  'TIKTOK_ACCESS_EXPIRES_AT', 'TIKTOK_GRANTED_SCOPE'];

/** The lanes: the holder (the marketing seat), a housemate off the TikTok crew, another house's holder. */
export const CMO = 'tt-cmo';
export const OTHER = 'tt-other';
export const B_HOLDER = 'tt-holder-b';

const signIn = (accessToken) => ({
  clientKey: 'awkey', clientSecret: 'stand-in-secret', refreshToken: `refresh-${accessToken}`,
  accessToken, accessExpiresAt: new Date(Date.now() + 20 * 60 * 60 * 1000).toISOString(),
  grantedScope: 'user.info.basic,user.info.profile,user.info.stats,video.list,video.publish,video.upload',
});

/**
 * Stand both houses. impure — temp disk, env, listeners.
 * @returns {Promise<object>} the kit
 */
export const standTikTokHouses = async () => {
  const saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  for (const k of ENV) delete process.env[k];
  const tiktok = await startTikTokStandIn();
  process.env.NEUMA_TIKTOK_API_ROOT = tiktok.root;
  const dir = await fs.realpath(await createTempDir('tiktok-being'));
  for (const [k, file] of [['NEUMA_SOCIAL_CREDENTIALS_PATH', 'legacy-credentials.json'], ['NEUMA_SOCIAL_BINDINGS_PATH', 'legacy-bindings.json'],
    ['NEUMA_SECTOR_CREW_PATH', 'legacy-crew.json'], ['NEUMA_SOCIAL_POST_QUEUE_PATH', 'queue.json']]) process.env[k] = path.join(dir, file);
  const priorRealm = getRealmRoot();
  setRealmRoot(path.join(dir, 'realm'));
  const [a, b] = [await fullAuth(), await fullAuth()];
  const operator = { address: a.address, header: { Authorization: `Bearer ${a.token}` } };
  const operatorB = { address: b.address, header: { Authorization: `Bearer ${b.token}` } };
  const house = await useServedHouse({ wallet: operator.address, lanes: [CMO, OTHER] });
  await writeOwner(house.root, B_HOLDER, operatorB.address);
  await channelBindings.bind(operator.address, 'tiktok', { neumaId: CMO });
  await channelBindings.bind(operatorB.address, 'tiktok', { neumaId: B_HOLDER });
  await setChannelCredential(operator.address, 'tiktok', signIn('access-A'));
  await setChannelCredential(operatorB.address, 'tiktok', signIn('access-B'));

  const app = express();
  app.use(express.json());
  app.use('/api/v1/social-channels', router);

  // The operator's side of the portal: a real socket pair; cards are answered by `kit.decide`.
  const httpServer = createServer();
  const wss = new WebSocketServer({ server: httpServer });
  const port = await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', () => resolve(httpServer.address().port)));
  const kit = { tiktok, dir, operator, operatorB, house, app, cards: [], decide: () => 'deny' };
  const sockets = {};
  const linked = new Promise((resolve) => {
    wss.on('connection', (ws, req) => {
      if (!verifySessionToken(new URL(req.url, 'http://localhost').searchParams.get('token'))) { ws.close(1008); return; }
      sockets.server = ws;
      ws.on('message', (d) => {
        const m = JSON.parse(d.toString());
        if (m.type === 'tool:approval_response') resolveToolApproval(ws.__connection, m.id, m.decision);
      });
      resolve();
    });
  });
  sockets.client = new WebSocket(`ws://127.0.0.1:${port}/?token=${encodeURIComponent(a.token)}`);
  sockets.client.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.type !== 'tool:approval_request') return;
    kit.cards.push(msg);
    sockets.client.send(JSON.stringify({ type: 'tool:approval_response', id: msg.id, decision: kit.decide(msg) }));
  });
  await linked;

  /** A portal connection for one lane, seated on the operator's socket. */
  kit.connectionFor = (laneId, wallet = operator.address) => {
    const connection = { ws: sockets.server, walletAddress: wallet, companion: { name: laneId, neumaId: laneId }, toolMode: 'ask', _sessionToolPolicy: null };
    sockets.server.__connection = connection;
    return connection;
  };

  /** File a render the way the forge does: the real store, into the lane's own art folder. */
  kit.render = async (laneId, filename, bytes) => {
    const outputDir = path.join(dir, `engine-out-${crypto.randomBytes(3).toString('hex')}`);
    await fs.mkdir(outputDir, { recursive: true });
    await fs.writeFile(path.join(outputDir, filename), bytes);
    const [record] = collectOutputs({ outputDir, outputs: [{ filename, subfolder: '', type: 'output' }], laneId, jobId: crypto.randomUUID() });
    return { id: record.imageId, path: await fs.realpath(path.join(record.dir, record.file)) };
  };

  /** File one intent into a lane's own intents folder and settle it through the REAL sweep. */
  kit.file = async (connection, name, payload) => {
    const intents = path.join(workspace.pathFor(connection.companion.neumaId), 'intents');
    await fs.mkdir(intents, { recursive: true });
    await fs.writeFile(path.join(intents, `${name}.json`), JSON.stringify(payload));
    const [receipt] = await sweepIntents(connection, { mode: 'ask', lanePolicy: null, emit: () => {} });
    return receipt;
  };

  kit.close = async () => {
    sockets.client.terminate();
    sockets.server.terminate();
    await new Promise((resolve) => wss.close(resolve));
    await new Promise((resolve) => httpServer.close(resolve));
    await tiktok.close();
    house.restore();
    setRealmRoot(priorRealm);
    for (const k of ENV) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  };
  return kit;
};

/** The legs the stand-in saw, by name. */
export const legsOf = (kit, leg) => kit.tiktok.state.hits.filter((h) => h.leg === leg);
