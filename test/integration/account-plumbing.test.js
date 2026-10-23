/**
 * ACCOUNT PLUMBING — holders, crews, queue entries, keys, token refresh,
 * CONNECT, readers and flight checks, each per ACCOUNT (campaign plan slice
 * 3). Real tmp disk, the real sealed store, the real queue store, the real
 * bindings and crews, and real HTTP: a loopback X-shaped server and the
 * TikTok stand-in (test/helpers/tiktok-stand-in.js) answer the calls the
 * platform makes. No double anywhere (RULE 0); placeholder keys only.
 *
 * Proven: a holder or crew record from before accounts is the record of
 * `<channel>-1`; holders and crews of two X accounts are kept apart; a draft
 * on each of two X accounts resolves its own keys and is proven by its own
 * read-only identity probe; flight checks are cached per account; a TikTok
 * refresh writes back to the account refreshed and no other; two CONNECTs
 * wait at once and each seals into its own account, with the platform's own
 * user id; one person connected as a second account is refused.
 */
import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import http from 'http';
import fs from 'fs/promises';
import path from 'path';
import express from 'express';
import request from 'supertest';
import { standTwoHouses, HOUSE_A, HOUSE_B } from '../helpers/house-office-kit.js';
import { writeOwner, fullAuth } from '../helpers/audit-auth.js';
import { startTikTokStandIn } from '../helpers/tiktok-stand-in.js';
import { housePositionFile } from '../../backend/services/social/house-positions.js';
import { channelBindings, canNeumaPost } from '../../backend/services/social/channel-bindings.js';
import { sectorCrew, canStageForSector, canSendStaged } from '../../backend/services/sector-crew.js';
import { postQueue } from '../../backend/services/social/post-queue.js';
import { setChannelCredential } from '../../backend/services/social/channel-credentials.js';
import {
  addAccount, setAccountFields, resolveAccountCredential, loadAccountStore,
} from '../../backend/services/social/account-store.js';
import { entryAccountId } from '../../backend/services/social/account-shape.js';
import { readXMe, readXAccount } from '../../backend/services/social/x-reader.js';
import { runAccountFlightTests } from '../../backend/services/social/flight-test.js';
import { tiktokAccessFor } from '../../backend/services/social/tiktok-token.js';
import { startTikTokConnect, pollTikTokConnect, cancelTikTokConnect } from '../../backend/services/social/tiktok-connect.js';
import connectRouter from '../../backend/routes/social-connect-routes.js';

const ENV = ['NEUMA_X_API_ROOT', 'NEUMA_TIKTOK_API_ROOT', 'NEUMA_SOCIAL_POST_QUEUE_PATH'];
const X_APP = Object.freeze({ apiKey: 'ph-x-app', apiSecret: 'ph-x-app-secret' });
const X_USERS = Object.freeze({ 'ph-x-token-1': { id: '101', username: 'core_voice' }, 'ph-x-token-2': { id: '202', username: 'sub_voice' } });
const TT_APP = Object.freeze({ clientKey: 'awstandinkey', clientSecret: 'stand-in-secret' });

let xServer;
let xHits;
let tiktok;
let saved;

beforeAll(async () => {
  saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  xHits = [];
  // X's /2/users/me, answering as whoever the signed request's token is.
  xServer = http.createServer((req, res) => {
    const signed = /oauth_token="([^"]+)"/.exec(req.headers.authorization || '')?.[1];
    const token = signed ? decodeURIComponent(signed) : null;
    xHits.push({ path: new URL(req.url, 'http://x').pathname, token });
    const user = X_USERS[token];
    res.writeHead(user ? 200 : 401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(user ? { data: user } : { detail: 'Unauthorized' }));
  });
  await new Promise((r) => xServer.listen(0, '127.0.0.1', r));
  process.env.NEUMA_X_API_ROOT = `http://127.0.0.1:${xServer.address().port}/2`;
  tiktok = await startTikTokStandIn();
  process.env.NEUMA_TIKTOK_API_ROOT = tiktok.root;
});

afterAll(async () => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  await new Promise((r) => xServer.close(r));
  await tiktok.close();
});

describe('account plumbing (real tmp disk, real HTTP)', () => {
  let houses;
  beforeEach(async () => {
    houses = await standTwoHouses({ label: 'account-plumbing', lanesA: ['core-cmo', 'sub-cmo', 'drafter'], lanesB: ['other-cmo'] });
    process.env.NEUMA_SOCIAL_POST_QUEUE_PATH = path.join(houses.settings, 'social-post-queue.json');
    xHits.length = 0;
    tiktok.reset();
  });
  afterEach(() => houses.restore());

  test('a holder or crew record from before accounts is <channel>-1; two X accounts keep their own holders and crews', async () => {
    // The pre-accounts records, exactly as they were written: keyed by channel.
    await fs.mkdir(path.dirname(housePositionFile(HOUSE_A, 'social-channel-bindings.json')), { recursive: true });
    await fs.writeFile(housePositionFile(HOUSE_A, 'social-channel-bindings.json'), JSON.stringify({ x: { neumaId: 'core-cmo', boundBy: HOUSE_A, boundAt: 't' } }));
    await fs.writeFile(housePositionFile(HOUSE_A, 'sector-crew.json'), JSON.stringify({ x: { members: [{ neumaId: 'drafter', kind: 'neuma', remit: 'threads' }] } }));

    expect(await channelBindings.bindingFor(HOUSE_A, 'x-1')).toMatchObject({ neumaId: 'core-cmo' });
    expect(await channelBindings.bindingFor(HOUSE_A, 'x')).toMatchObject({ neumaId: 'core-cmo' });
    expect((await sectorCrew.crewFor(HOUSE_A, 'x-1')).map((m) => m.neumaId)).toEqual(['drafter']);

    await channelBindings.bind(HOUSE_A, 'x-2', { neumaId: 'sub-cmo' });
    // The first change writes the old record under its account id.
    expect(JSON.parse(await fs.readFile(housePositionFile(HOUSE_A, 'social-channel-bindings.json'), 'utf8'))).toEqual({
      'x-1': expect.objectContaining({ neumaId: 'core-cmo' }),
      'x-2': expect.objectContaining({ neumaId: 'sub-cmo' }),
    });
    const bindings = await channelBindings.load(HOUSE_A);
    const crew = await sectorCrew.load(HOUSE_A);
    expect(canNeumaPost(bindings, 'x-1', 'core-cmo')).toBe(true);
    expect(canNeumaPost(bindings, 'x-2', 'core-cmo')).toBe(false);
    expect(canNeumaPost(bindings, 'x-2', 'sub-cmo')).toBe(true);
    // The crew of x-1 stages for x-1 only; its holder's crew is its own.
    expect(canStageForSector(crew, bindings, 'x-1', 'drafter')).toBe(true);
    expect(canStageForSector(crew, bindings, 'x-2', 'drafter')).toBe(false);
    expect(canSendStaged(crew, bindings, 'x-2', 'sub-cmo')).toBe(true);
    await sectorCrew.add(HOUSE_A, 'x-2', { neumaId: 'drafter', remit: 'sub launch' });
    expect(canStageForSector(await sectorCrew.load(HOUSE_A), bindings, 'x-2', 'drafter')).toBe(true);
    // Unbinding x-2 leaves x-1's holder standing.
    await channelBindings.unbind(HOUSE_A, 'x-2');
    expect(canNeumaPost(await channelBindings.load(HOUSE_A), 'x-1', 'core-cmo')).toBe(true);
    // Another house holds nothing of this.
    expect(await channelBindings.bindingFor(HOUSE_B, 'x-1')).toBeNull();
    expect(await channelBindings.holdersBesides(HOUSE_B, 'x')).toEqual([HOUSE_A]);
  });

  test('a draft on each of two X accounts resolves its own keys, proven by its own identity probe', async () => {
    await setChannelCredential(HOUSE_A, 'x', { ...X_APP, accessToken: 'ph-x-token-1', accessSecret: 'ph-x-secret-1' });
    const second = await addAccount(HOUSE_A, 'x', {});
    expect(second.accountId).toBe('x-2');
    await setAccountFields(HOUSE_A, 'x-2', { accessToken: 'ph-x-token-2', accessSecret: 'ph-x-secret-2' });

    const one = await postQueue.add({ channelId: 'x', text: 'core line', authorNeumaId: 'core-cmo', queuedBy: 'core-cmo' });
    const two = await postQueue.add({ channelId: 'x', accountId: 'x-2', text: 'sub line', authorNeumaId: 'sub-cmo', queuedBy: 'sub-cmo' });
    expect(one.accountId).toBe('x-1'); // a draft that names none speaks as the first
    expect(two.accountId).toBe('x-2');
    await expect(postQueue.add({ channelId: 'x', accountId: 'tiktok-1', text: 'wrong door', queuedBy: 'core-cmo' }))
      .rejects.toThrow('account tiktok-1 is not a x account');
    // An entry from before accounts carries no accountId: it reads as x-1.
    expect(entryAccountId({ channelId: 'x' })).toBe('x-1');

    const identities = [];
    for (const entry of [one, two]) {
      const keys = await resolveAccountCredential(HOUSE_A, entryAccountId(entry));
      expect(keys.apiKey).toBe(X_APP.apiKey); // one app, shared
      const me = await readXMe({ wallet: HOUSE_A, accountId: entryAccountId(entry) });
      expect(me.ok).toBe(true);
      identities.push(me.data.username);
    }
    expect(identities).toEqual(['core_voice', 'sub_voice']);
    expect(xHits.map((h) => h.token)).toEqual(['ph-x-token-1', 'ph-x-token-2']);

    // The account a post went out as is cached per account, never shared.
    expect(await readXAccount({ wallet: HOUSE_A, accountId: 'x-2' })).toEqual({ id: '202', username: 'sub_voice' });
    expect(await readXAccount({ wallet: HOUSE_A, accountId: 'x-1' })).toEqual({ id: '101', username: 'core_voice' });

    // Flight checks per account, cached per account.
    const flights = await runAccountFlightTests({ wallet: HOUSE_A, accountIds: ['x-1', 'x-2'], fresh: true });
    expect(flights['x-1'].account).toEqual({ id: '101', name: 'core_voice' });
    expect(flights['x-2'].account).toEqual({ id: '202', name: 'sub_voice' });
    const before = xHits.length;
    await runAccountFlightTests({ wallet: HOUSE_A, accountIds: ['x-1', 'x-2'] });
    expect(xHits.length).toBe(before);
    // Another house's probe of the same ids has no keys.
    expect((await runAccountFlightTests({ wallet: HOUSE_B, accountIds: ['x-2'], fresh: true }))['x-2'].ok).toBeNull();
  });

  test('a TikTok refresh writes back to the account refreshed, and no other', async () => {
    const PAST = new Date(Date.now() - 60_000).toISOString();
    await setChannelCredential(HOUSE_A, 'tiktok', { ...TT_APP, refreshToken: 'ph-tt-refresh-1', accessToken: 'ph-tt-access-1', accessExpiresAt: PAST });
    await addAccount(HOUSE_A, 'tiktok', {});
    await setAccountFields(HOUSE_A, 'tiktok-2', { refreshToken: 'ph-tt-refresh-2', accessToken: 'ph-tt-access-2', accessExpiresAt: PAST });

    const access = await tiktokAccessFor(HOUSE_A, { accountId: 'tiktok-2' });
    expect(access).toMatchObject({ ok: true, accessToken: 'access-r1' });
    const [refresh] = tiktok.state.hits.filter((h) => h.leg === 'token');
    expect(refresh.form).toMatchObject({ grant_type: 'refresh_token', refresh_token: 'ph-tt-refresh-2', client_key: TT_APP.clientKey });
    const store = await loadAccountStore(HOUSE_A);
    expect(store.accounts['tiktok-2'].fields).toMatchObject({ accessToken: 'access-r1', refreshToken: 'refresh-r1' });
    expect(store.accounts['tiktok-1'].fields).toMatchObject({ accessToken: 'ph-tt-access-1', refreshToken: 'ph-tt-refresh-1' });
    expect(store.apps.tiktok).toEqual(TT_APP);
  });

  test('two CONNECTs wait at once; each seals into its own account with the platform\'s own user id', async () => {
    await setChannelCredential(HOUSE_A, 'tiktok', TT_APP);
    await addAccount(HOUSE_A, 'tiktok', {});
    const first = await startTikTokConnect(HOUSE_A, 'tiktok-1');
    const second = await startTikTokConnect(HOUSE_A, 'tiktok-2');
    expect(first.ok && second.ok).toBe(true);
    expect(pollTikTokConnect(HOUSE_A, 'tiktok-1')).toEqual({ status: 'pending' });
    expect(pollTikTokConnect(HOUSE_A, 'tiktok-2')).toEqual({ status: 'pending' });

    const returns = (authUrl, code) => {
      const url = new URL(authUrl);
      return fetch(`${url.searchParams.get('redirect_uri')}?${new URLSearchParams({ code, state: url.searchParams.get('state'), scopes: 'user.info.basic,video.publish,video.upload' })}`);
    };
    const settled = async (accountId) => {
      for (let i = 0; i < 100; i += 1) {
        const r = pollTikTokConnect(HOUSE_A, accountId);
        if (r.status !== 'pending') return r;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      throw new Error('never settled');
    };
    // The second person signs in first; the first account's consent still waits.
    expect((await returns(second.authUrl, 'second:code')).status).toBe(200);
    expect(await settled('tiktok-2')).toEqual({ status: 'complete', channel: { id: 'open-2', title: 'Second Light' } });
    expect(pollTikTokConnect(HOUSE_A, 'tiktok-1')).toEqual({ status: 'pending' });
    expect((await returns(first.authUrl, 'first-code')).status).toBe(200);
    expect(await settled('tiktok-1')).toEqual({ status: 'complete', channel: { id: 'open-1', title: 'Deus Neuma' } });

    const store = await loadAccountStore(HOUSE_A);
    expect(store.accounts['tiktok-1']).toMatchObject({ platformUserId: 'open-1', label: 'Deus Neuma', fields: { accessToken: 'access-1' } });
    expect(store.accounts['tiktok-2']).toMatchObject({ platformUserId: 'open-2', label: 'Second Light', fields: { accessToken: 'access-2' } });

    // The same person again, as a third account: refused, nothing sealed.
    await addAccount(HOUSE_A, 'tiktok', {});
    const third = await startTikTokConnect(HOUSE_A, 'tiktok-3');
    await returns(third.authUrl, 'again');
    expect((await settled('tiktok-3')).error).toMatch(/already connected here as tiktok-1/);
    expect((await loadAccountStore(HOUSE_A)).accounts['tiktok-3'].fields).toEqual({});

    // Cancelling one account's consent leaves another's waiting.
    const a = await startTikTokConnect(HOUSE_A, 'tiktok-1');
    const b = await startTikTokConnect(HOUSE_A, 'tiktok-2');
    expect(a.ok && b.ok).toBe(true);
    expect(cancelTikTokConnect(HOUSE_A, 'tiktok-1')).toBe(true);
    expect(pollTikTokConnect(HOUSE_A, 'tiktok-2')).toEqual({ status: 'pending' });
    cancelTikTokConnect(HOUSE_A, 'tiktok-2');
  });

  test('the CONNECT route names its account, and refuses one the house does not have', async () => {
    const auth = await fullAuth();
    await setChannelCredential(auth.address, 'tiktok', TT_APP);
    const app = express();
    app.use(express.json());
    app.use('/api/v1/social-channels', connectRouter);
    const header = { Authorization: `Bearer ${auth.token}` };
    const missing = await request(app).post('/api/v1/social-channels/tiktok/connect?account=tiktok-9').set(header);
    expect(missing.status).toBe(400);
    expect(missing.body.error).toMatch(/no account tiktok-9 in this house — ADD ACCOUNT first/);
    expect((await request(app).post('/api/v1/social-channels/tiktok/connect?account=x-1').set(header)).status).toBe(400);
    await addAccount(auth.address, 'tiktok', {});
    const opened = await request(app).post('/api/v1/social-channels/tiktok/connect?account=tiktok-2').set(header);
    expect(opened.status).toBe(200);
    expect((await request(app).get('/api/v1/social-channels/tiktok/connect?account=tiktok-2').set(header)).body).toEqual({ status: 'pending' });
    expect((await request(app).get('/api/v1/social-channels/tiktok/connect').set(header)).body).toEqual({ status: 'idle' });
    expect((await request(app).delete('/api/v1/social-channels/tiktok/connect?account=tiktok-2').set(header)).body).toEqual({ cancelled: true });
  });
});
