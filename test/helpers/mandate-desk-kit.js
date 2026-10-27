/**
 * THE MANDATE AT THE DESK — one real house for the grant-protocol suites
 * (RULE 0, nothing mocked on a claimed path): a real tmp realm and
 * workspaces root, the operator's real signed session (and a stranger's),
 * the CMO seated, two X accounts — x-1 CLEAR on the house social check
 * (company with a site, expected handle, holder, keys that a loopback X
 * answers as that handle) and x-2 NOT (it answers as another handle) — and
 * the real mandate router behind the REAL access guard, with a real paired
 * phone so a request can be the desk's or the phone's. Placeholder keys only.
 */
import http from 'http';
import path from 'path';
import fs from 'fs/promises';
import express from 'express';
import { standTwoHouses } from './house-office-kit.js';
import { fullAuth, writeOwner } from './audit-auth.js';
import { setHouseWorkspace } from '../../backend/services/house-workspace.js';
import { listCompanies, setCompanyBlock } from '../../backend/services/marketing/companies.js';
import { addAccount, setAccountFields, setAppFields, setAccountMeta } from '../../backend/services/social/account-store.js';
import { channelBindings } from '../../backend/services/social/channel-bindings.js';
import { cmoDesignation } from '../../backend/services/marketing/cmo-designation.js';

export const CMO_LANE = 'mandatedeskcmo';
export const ORIGIN = 'desk.tail0d1e.ts.net';
const X_APP = Object.freeze({ apiKey: 'ph-x-app', apiSecret: 'ph-x-app-secret' });
const X_USERS = Object.freeze({
  'ph-x-token-1': { id: '101', username: 'core_voice' },
  'ph-x-token-2': { id: '202', username: 'other_voice' },
});
const DOORS = ['NEUMA_X_API_ROOT', 'NEUMA_SOCIAL_POST_QUEUE_PATH', 'NEUMA_SOCIAL_BINDINGS_PATH', 'NEUMA_SECTOR_CREW_PATH',
  'NEUMA_SOCIAL_CREDENTIALS_PATH', 'NEUMA_REPLY_CANDIDATES_PATH'];

// impure — a loopback X answering /2/users/me as whoever the signed token is.
const standX = async () => {
  const server = http.createServer((req, res) => {
    const signed = /oauth_token="([^"]+)"/.exec(req.headers.authorization || '')?.[1];
    const user = X_USERS[signed ? decodeURIComponent(signed) : ''];
    res.writeHead(user ? 200 : 401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(user ? { data: user } : { detail: 'Unauthorized' }));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return server;
};

/** Stand the house, its accounts, the guard and the router. impure. */
export const buildDeskHouse = async () => {
  const k = { saved: Object.fromEntries(DOORS.map((d) => [d, process.env[d]])) };
  k.x = await standX();
  process.env.NEUMA_X_API_ROOT = `http://127.0.0.1:${k.x.address().port}/2`;
  k.houses = await standTwoHouses({ label: 'mandate-desk', lanesA: [], lanesB: [] });
  for (const [door, name] of [['NEUMA_SOCIAL_POST_QUEUE_PATH', 'social-post-queue.json'], ['NEUMA_SOCIAL_BINDINGS_PATH', 'social-channel-bindings.json'],
    ['NEUMA_SECTOR_CREW_PATH', 'sector-crew.json'], ['NEUMA_SOCIAL_CREDENTIALS_PATH', 'social-channel-credentials.json'],
    ['NEUMA_REPLY_CANDIDATES_PATH', 'reply-candidates.json']]) {
    process.env[door] = path.join(k.houses.settings, name);
  }
  await fs.writeFile(process.env.NEUMA_SOCIAL_POST_QUEUE_PATH, '[]');
  k.operator = await fullAuth();
  k.stranger = await fullAuth();
  const A = k.operator.address;
  await writeOwner(k.houses.rootA, CMO_LANE, A);
  await setHouseWorkspace(A, path.join(k.houses.tmp, 'ground'));
  await setCompanyBlock(A, 'ignis', { site: { url: 'https://example.com/ignis', links: [] } });
  const companies = (await listCompanies(A)).map((c) => c.id);
  await setAppFields(A, 'x', X_APP);
  await setAccountMeta(A, 'x-1', { companyId: 'ignis', expectedHandle: 'core_voice' }, companies);
  await setAccountFields(A, 'x-1', { accessToken: 'ph-x-token-1', accessSecret: 'ph-x-secret-1' });
  const two = await addAccount(A, 'x', { companyId: 'ignis', expectedHandle: 'core_voice' }, companies);
  await setAccountFields(A, two.accountId, { accessToken: 'ph-x-token-2', accessSecret: 'ph-x-secret-2' });
  await channelBindings.bind(A, 'x-1', { neumaId: CMO_LANE });
  await channelBindings.bind(A, two.accountId, { neumaId: CMO_LANE });
  await cmoDesignation.designate(A, CMO_LANE);

  const { createRemoteStore } = await import('../../backend/services/remote/remote-store.js');
  const { createAccessGuard } = await import('../../backend/services/remote/access-guard.js');
  const { mintDevice } = await import('../../backend/services/remote/pairing.js');
  const store = createRemoteStore({ path: path.join(k.houses.tmp, 'remote.json') });
  const phone = mintDevice({ address: A, label: 'operator phone' });
  k.phoneSecret = phone.secret;
  await store.save({ enabled: true, origin: ORIGIN, devices: [phone.device] });
  const app = express();
  app.set('trust proxy', 'loopback');
  app.use(createAccessGuard({ store }).middleware);
  app.use(express.json());
  app.use('/api/v1/mandate', (await import('../../backend/routes/mandate-routes.js')).default);
  k.server = http.createServer(app);
  await new Promise((r) => k.server.listen(0, '127.0.0.1', r));
  k.base = `http://127.0.0.1:${k.server.address().port}`;
  k.port = k.server.address().port;
  return k;
};

/** Tear it down. impure. */
export const teardownDeskHouse = async (k) => {
  await new Promise((r) => k.server.close(r));
  await new Promise((r) => k.x.close(r));
  k.houses.restore();
  for (const [d, v] of Object.entries(k.saved)) {
    if (v === undefined) delete process.env[d];
    else process.env[d] = v;
  }
};

/** A request from this computer's own desk: a loopback Host on the loopback socket. */
export const atDesk = (k, who, req) => req.set('Authorization', `Bearer ${who.token}`).set('Host', `localhost:${k.port}`);
/** A request from the operator's paired phone, through the tailnet. */
export const fromPhone = (k, who, req) => req.set('Authorization', `Bearer ${who.token}`)
  .set('Host', ORIGIN).set('Origin', `https://${ORIGIN}`).set('X-Forwarded-For', '100.100.7.9').set('Cookie', `neuma_remote=${k.phoneSecret}`);
