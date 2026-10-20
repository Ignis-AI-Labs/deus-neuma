// Two houses on one machine, each with its own X account, mailbox and crews
// (Design note, 2026-10-16: houses are never confused). Real auth (two signed
// wallets), the real social and email routers, the real encrypted stores,
// owner.json records and the machine record, all on temp disk.
import express from 'express';
import request from 'supertest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createTempDir } from '../helpers/temp-fs.js';
import { claimOwner } from '../helpers/claim-owner.js';
import { createSessionToken, generateChallenge, verifySignature } from '../../backend/services/auth.js';
import { generateKeypair, signMessage } from '../../core/weave/keypair.js';
import { neumaWorkspace } from '../../core/index.js';
import { getRealmRoot, setRealmRoot } from '../../backend/services/user-realm.js';

const LANE_A = 'cross-house-herald-a';
const LANE_B = 'cross-house-herald-b';
const ENV_KEYS = [
  'NEUMA_SOCIAL_BINDINGS_PATH', 'NEUMA_SOCIAL_CREDENTIALS_PATH', 'NEUMA_SECTOR_CREW_PATH',
  'NEUMA_EMAIL_BINDING_PATH', 'NEUMA_EMAIL_CREDENTIALS_PATH', 'NEUMA_X_API_ROOT',
  'X_API_KEY', 'X_API_SECRET', 'X_ACCESS_TOKEN', 'X_ACCESS_SECRET',
];
const X_FIELDS = { apiKey: 'a-key-of-house-a', apiSecret: 'a-secret', accessToken: 'a-token', accessSecret: 'a-token-secret' };

const identity = async () => {
  const keypair = generateKeypair();
  const challenge = generateChallenge(keypair.address);
  const signature = await signMessage(keypair.privateKey, challenge);
  return {
    wallet: keypair.address,
    token: createSessionToken(verifySignature(keypair.address, challenge, signature)),
  };
};

describe('social and email positions are each house\'s own', () => {
  let app;
  let root;
  let a;
  let b;
  let previousRoot;
  let previousRealm;
  let savedEnv;

  const as = (who) => ({
    get: (route) => request(app).get(route).set('Authorization', `Bearer ${who.token}`),
    put: (route, body) => request(app).put(route).set('Authorization', `Bearer ${who.token}`).send(body),
    del: (route) => request(app).delete(route).set('Authorization', `Bearer ${who.token}`),
  });
  const xOf = async (who) => (await as(who).get('/social')).body.channels.find((c) => c.id === 'x');

  beforeAll(async () => {
    root = await createTempDir('channel-cross-house');
    const workspaces = path.join(root, 'workspaces');
    a = await identity();
    b = await identity();
    previousRoot = neumaWorkspace.root;
    neumaWorkspace.root = workspaces;
    previousRealm = getRealmRoot();
    setRealmRoot(path.join(root, 'realm'));
    await claimOwner(workspaces, LANE_A, a.wallet);
    await claimOwner(workspaces, LANE_B, b.wallet);

    savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
    process.env.NEUMA_SOCIAL_BINDINGS_PATH = path.join(root, 'machine', 'social-channel-bindings.json');
    process.env.NEUMA_SOCIAL_CREDENTIALS_PATH = path.join(root, 'machine', 'social-channel-credentials.json');
    process.env.NEUMA_SECTOR_CREW_PATH = path.join(root, 'machine', 'sector-crew.json');
    process.env.NEUMA_EMAIL_BINDING_PATH = path.join(root, 'machine', 'email-binding.json');
    process.env.NEUMA_EMAIL_CREDENTIALS_PATH = path.join(root, 'machine', 'email-credentials.json');
    // The board proves X's account when configured — aim it at a port that refuses.
    process.env.NEUMA_X_API_ROOT = 'http://127.0.0.1:9/2';
    for (const key of ['X_API_KEY', 'X_API_SECRET', 'X_ACCESS_TOKEN', 'X_ACCESS_SECRET']) delete process.env[key];

    const [social, email] = await Promise.all([
      import('../../backend/routes/social-channel-routes.js'),
      import('../../backend/routes/email-routes.js'),
    ]);
    app = express();
    app.use(express.json());
    app.use('/social', social.default);
    app.use('/email', email.default);
  }, 20000);

  afterAll(() => {
    neumaWorkspace.root = previousRoot;
    setRealmRoot(previousRealm);
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
  });

  it('another house can neither re-key, release, nor read a house\'s X', async () => {
    expect((await as(a).put('/social/x/credentials', { fields: X_FIELDS })).status).toBe(200);
    expect((await as(a).put('/social/x/binding', { neumaId: LANE_A })).status).toBe(200);

    // B's board is B's house: no holder, no stored keys.
    const seenByB = await xOf(b);
    expect(seenByB.binding).toBeNull();
    expect(seenByB.configured).toBe(false);

    // B's writes land in B's house and never touch A's.
    expect((await as(b).put('/social/x/credentials', { fields: { apiKey: 'b-key' } })).status).toBe(200);
    expect((await as(b).del('/social/x/credentials')).status).toBe(200);
    expect((await as(b).del('/social/x/binding')).body.released).toBe(false);

    const seenByA = await xOf(a);
    expect(seenByA.binding?.neumaId).toBe(LANE_A);
    expect(seenByA.configured).toBe(true);
    expect(seenByA.fields.every((f) => f.source === 'store')).toBe(true);
  });

  it('a house seats only its own lanes on a crew, and reads only its own crew', async () => {
    const foreign = await as(b).put('/social/x/crew', { neumaId: LANE_A, remit: 'post whatever house B says' });
    expect(foreign.status).toBe(403);
    expect((await as(a).put('/social/x/crew', { neumaId: LANE_A, remit: 'drafts the week' })).status).toBe(200);
    expect((await as(b).put('/social/x/crew', { neumaId: LANE_B, remit: 'house B work' })).status).toBe(200);

    expect((await as(a).get('/social/x/crew')).body.crew.map((m) => m.neumaId)).toEqual([LANE_A]);
    expect((await as(b).get('/social/x/crew')).body.crew.map((m) => m.neumaId)).toEqual([LANE_B]);
    await as(b).del(`/social/x/crew/${LANE_A}`);
    expect((await as(a).get('/social/x/crew')).body.crew.map((m) => m.neumaId)).toEqual([LANE_A]);
  });

  it('the mailbox is each house\'s own', async () => {
    const mailbox = { address: 'a@house-a.test', username: 'a@house-a.test', password: 'a-app-password' };
    expect((await as(a).put('/email/credentials', { fields: mailbox })).status).toBe(200);
    expect((await as(a).put('/email/binding', { neumaId: LANE_A })).status).toBe(200);

    const seenByB = (await as(b).get('/email')).body.account;
    expect(seenByB.binding).toBeNull();
    expect(seenByB.configured).toBe(false);
    expect((await as(b).del('/email/binding')).body.released).toBe(false);
    expect((await as(b).del('/email/credentials')).body.removed).toBe(false);

    const seenByA = (await as(a).get('/email')).body.account;
    expect(seenByA.binding?.neumaId).toBe(LANE_A);
    expect(seenByA.configured).toBe(true);
  });

  it('the machine\'s .env keys never serve a second house while one holds the channel', async () => {
    Object.assign(process.env, {
      X_API_KEY: 'machine-key', X_API_SECRET: 'machine-secret', X_ACCESS_TOKEN: 'machine-token', X_ACCESS_SECRET: 'machine-token-secret',
    });
    try {
      // A holds X, so the machine keys are not B's to ride.
      expect((await xOf(b)).configured).toBe(false);
      expect((await xOf(a)).configured).toBe(true);
    } finally {
      for (const key of ['X_API_KEY', 'X_API_SECRET', 'X_ACCESS_TOKEN', 'X_ACCESS_SECRET']) delete process.env[key];
    }
  });

  it('the machine record is read only by the house it names', async () => {
    const c = await identity();
    const d = await identity();
    await fs.mkdir(path.join(root, 'machine'), { recursive: true });
    await fs.writeFile(process.env.NEUMA_SOCIAL_BINDINGS_PATH, JSON.stringify({
      linkedin: { neumaId: 'legacy-herald', boundBy: c.wallet, boundAt: '2026-09-02T00:00:00.000Z' },
      telegram: { neumaId: 'unnamed-herald', boundBy: '', boundAt: '2026-09-02T00:00:00.000Z' },
    }));
    const board = async (who) => Object.fromEntries((await as(who).get('/social')).body.channels.map((ch) => [ch.id, ch.binding?.neumaId ?? null]));
    expect((await board(c)).linkedin).toBe('legacy-herald');
    expect((await board(d)).linkedin).toBeNull();
    expect((await board(c)).telegram).toBeNull();
    expect((await board(d)).telegram).toBeNull();
  });
});
