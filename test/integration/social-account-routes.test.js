/**
 * CONNECT MANY — the apps + accounts routes, the companies route, and the
 * being's social/queue and social/post intents naming an account (campaign
 * plan slice 4). Real routes over a real signed-wallet session, the real
 * sealed store on tmp disk, real lanes with owner.json, the real intents'
 * validate + execute into the real queue store. No double (RULE 0);
 * placeholder keys only.
 *
 * Proven: the app is stored once and every account under it; accounts open
 * under a company and move between companies (an unknown company refused);
 * no response carries a key value; a stray account field on the app and a
 * row of dots are refused in words; each account has its own holder and
 * crew; removing an account releases its holder; a being with two X
 * accounts is refused in words until it names one (or a company with one
 * account there), and the card says who will speak.
 */
import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import path from 'path';
import fs from 'fs/promises';
import express from 'express';
import request from 'supertest';
import { createTempDir } from '../helpers/temp-fs.js';
import { fullAuth, writeOwner } from '../helpers/audit-auth.js';
import { getRealmRoot, setRealmRoot } from '../../backend/services/user-realm.js';
import { getWorkspacesRoot, setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import accountRouter from '../../backend/routes/social-account-routes.js';
import companyRouter from '../../backend/routes/company-routes.js';
import { postQueue } from '../../backend/services/social/post-queue.js';
import { socialQueueIntent } from '../../backend/services/intents/social-queue.js';
import { socialPostIntent } from '../../backend/services/intents/social-post.js';

const X_APP = Object.freeze({ apiKey: 'ph-x-app', apiSecret: 'ph-x-app-secret' });
const valuesOf = (o) => JSON.stringify(o).match(/ph-[a-z0-9-]+/g) || [];

let auth;
let app;
let header;
let saved;

beforeAll(async () => {
  saved = { realm: getRealmRoot(), lanes: getWorkspacesRoot(), queue: process.env.NEUMA_SOCIAL_POST_QUEUE_PATH };
  const tmp = await createTempDir('social-account-routes');
  setRealmRoot(path.join(tmp, 'realm'));
  setWorkspacesRoot(path.join(tmp, 'lanes'));
  process.env.NEUMA_SOCIAL_POST_QUEUE_PATH = path.join(tmp, 'queue.json');
  auth = await fullAuth();
  for (const lane of ['core-cmo', 'sub-cmo', 'drafter']) await writeOwner(path.join(tmp, 'lanes'), lane, auth.address);
  header = { Authorization: `Bearer ${auth.token}` };
  app = express();
  app.use(express.json());
  app.use('/api/v1/social-channels', accountRouter);
  app.use('/api/v1/companies', companyRouter);
});

afterAll(() => {
  setRealmRoot(saved.realm);
  setWorkspacesRoot(saved.lanes);
  if (saved.queue === undefined) delete process.env.NEUMA_SOCIAL_POST_QUEUE_PATH;
  else process.env.NEUMA_SOCIAL_POST_QUEUE_PATH = saved.queue;
});

beforeEach(async () => {
  await fs.writeFile(process.env.NEUMA_SOCIAL_POST_QUEUE_PATH, '[]');
});

const api = (method, url, body) => {
  const r = request(app)[method](`/api/v1/social-channels${url}`).set(header);
  return body ? r.send(body) : r;
};

describe('apps + accounts over the real routes', () => {
  test('one app, two accounts under two companies, holders and crews apart, nothing echoed', async () => {
    expect((await request(app).get('/api/v1/social-channels/accounts')).status).toBe(401);
    const companies = (await request(app).get('/api/v1/companies').set(header)).body.companies.map((c) => c.id);
    expect(companies).toEqual(expect.arrayContaining(['ignis', 'umbrae']));

    expect((await api('put', '/apps/x', { fields: X_APP })).status).toBe(200);
    const stray = await api('put', '/apps/x', { fields: { accessToken: 'ph-x-token' } });
    expect(stray.status).toBe(400);
    expect(stray.body.error).toBe('accessToken belongs to an account, not to the app');
    expect((await api('put', '/apps/telegram', { fields: {} })).status).toBe(404);

    const a = await api('post', '/accounts', { channelId: 'x', companyId: 'ignis', label: 'core', expectedHandle: 'core_voice' });
    const b = await api('post', '/accounts', { channelId: 'x', companyId: 'umbrae', expectedHandle: 'sub_voice' });
    expect([a.status, a.body.accountId, b.body.accountId]).toEqual([201, 'x-1', 'x-2']);
    expect((await api('post', '/accounts', { channelId: 'x', companyId: 'nobody' })).status).toBe(400);
    expect((await api('post', '/accounts', { channelId: 'myspace' })).status).toBe(400);

    const dots = await api('put', '/accounts/x-2/credentials', { fields: { accessToken: '••••••' } });
    expect(dots.status).toBe(400);
    expect(dots.body.error).toMatch(/^Access Token: that is the hidden placeholder/);
    await api('put', '/accounts/x-1/credentials', { fields: { accessToken: 'ph-x-token-1', accessSecret: 'ph-x-secret-1' } });
    const keyed = await api('put', '/accounts/x-2/credentials', { fields: { accessToken: 'ph-x-token-2', accessSecret: 'ph-x-secret-2' } });
    expect(keyed.body.account).toMatchObject({ id: 'x-2', companyId: 'umbrae', configured: true });

    expect((await api('put', '/accounts/x-1/binding', { neumaId: 'core-cmo' })).status).toBe(200);
    expect((await api('put', '/accounts/x-2/binding', { neumaId: 'sub-cmo' })).status).toBe(200);
    expect((await api('put', '/accounts/x-2/crew', { neumaId: 'drafter', remit: 'sub launch' })).body.crew.map((m) => m.neumaId)).toEqual(['drafter']);
    expect((await api('get', '/accounts/x-1/crew')).body.crew).toEqual([]);

    const board = await api('get', '/accounts');
    expect(board.status).toBe(200);
    expect(board.headers['cache-control']).toBe('private, no-store');
    expect(board.body.accounts.map((x) => [x.id, x.companyId, x.binding?.neumaId])).toEqual([['x-1', 'ignis', 'core-cmo'], ['x-2', 'umbrae', 'sub-cmo']]);
    expect(board.body.apps.find((x) => x.id === 'x')).toMatchObject({ configured: true });
    expect(valuesOf(board.body)).toEqual([]);

    // Moving an account is one press; the id stays.
    expect((await api('patch', '/accounts/x-2', { companyId: 'ignis' })).body.account).toMatchObject({ id: 'x-2', companyId: 'ignis' });
    expect((await api('patch', '/accounts/x-2', { companyId: 'nobody' })).status).toBe(400);
    expect((await api('patch', '/accounts/x-2', { secret: 'x' })).status).toBe(400);
    await api('patch', '/accounts/x-2', { companyId: 'umbrae' });
    expect((await api('get', '/accounts/x-9')).status).toBe(404);
    expect((await api('patch', '/accounts/x-9', { label: 'ghost' })).status).toBe(404);
  });

  test('a being with two X accounts names one (or a company with one there); the card says who speaks', async () => {
    const asLane = (neumaId) => ({ connection: { companion: { neumaId }, walletAddress: auth.address } });
    // The drafter crews x-2 only; the holder of x-1 holds only x-1.
    const drafter = await socialQueueIntent.validate({ channel: 'x', text: 'sub launch line' }, asLane('drafter'));
    expect(drafter.ok).toBe(true);
    expect(drafter.value.accountId).toBe('x-2');
    expect(drafter.value.card['posts as']).toBe('X (Twitter) x-2 @sub_voice (Umbrae)');

    // A lane seated on both accounts must say which.
    await api('put', '/accounts/x-1/crew', { neumaId: 'drafter', remit: 'core' });
    const ambiguous = await socialQueueIntent.validate({ channel: 'x', text: 'which one?' }, asLane('drafter'));
    expect(ambiguous).toMatchObject({ ok: false, status: 'denied' });
    expect(ambiguous.reason).toMatch(/you may use 2 X \(Twitter\) accounts \(x-1 @core_voice \(ignis\), x-2 @sub_voice \(umbrae\)\) — name the one with account/);
    const byCompany = await socialQueueIntent.validate({ channel: 'x', text: 'for the core', company: 'ignis' }, asLane('drafter'));
    expect(byCompany.value.accountId).toBe('x-1');
    const byAccount = await socialQueueIntent.validate({ channel: 'x', text: 'for the sub', account: 'x-2' }, asLane('drafter'));
    expect(byAccount.value.accountId).toBe('x-2');
    expect((await socialQueueIntent.validate({ channel: 'x', text: 'nope', account: 'x-7' }, asLane('drafter'))).reason)
      .toMatch(/^x-7 is not a X \(Twitter\) account you may use/);

    // Staged as the account it named — the scheduler sends it with x-2's keys.
    const staged = await socialQueueIntent.execute(byAccount.value, asLane('drafter'));
    expect(staged.ok).toBe(true);
    const [entry] = await postQueue.load();
    expect(entry).toMatchObject({ channelId: 'x', accountId: 'x-2', status: 'draft', authorNeumaId: 'drafter' });

    // An instant post: the holder of x-1 speaks only as x-1, named on the card.
    const post = await socialPostIntent.validate({ channel: 'x', text: 'core speaks' }, asLane('core-cmo'));
    expect(post.value.accountId).toBe('x-1');
    expect(Object.keys(post.value.card)[0]).toBe('posts as');
    expect((await socialPostIntent.validate({ channel: 'x', text: 'not mine', account: 'x-2' }, asLane('core-cmo'))).ok).toBe(false);
    // The contract names the accounts only where a lane has a choice.
    expect((await socialQueueIntent.availableFor({ laneId: 'drafter' })).descriptionForPrompt).toMatch(/ACCOUNTS: .*x-1 @core_voice \(ignis\), x-2 @sub_voice \(umbrae\)/);
    expect((await socialPostIntent.availableFor({ laneId: 'core-cmo' })).descriptionForPrompt).toBeUndefined();
  });

  test('removing an account releases its holder; its id is never issued again', async () => {
    expect((await api('delete', '/accounts/x-2')).body).toEqual({ removed: true });
    const board = await api('get', '/accounts');
    expect(board.body.accounts.map((a) => a.id)).toEqual(['x-1']);
    expect((await api('post', '/accounts', { channelId: 'x', companyId: 'umbrae' })).body.accountId).toBe('x-3');
    expect((await api('get', '/accounts')).body.accounts.find((a) => a.id === 'x-3').binding).toBeNull();
  });
});
