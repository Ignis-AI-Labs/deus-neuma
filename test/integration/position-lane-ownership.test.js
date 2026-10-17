// House positions carry platform keys or privileged offices. A signed wallet
// may assign only a lane it owns. This suite uses real auth, real owner.json
// records, real routers, and the real stores on temp disk — no mocked boundary.
import express from 'express';
import request from 'supertest';
import path from 'node:path';
import { createTempDir } from '../helpers/temp-fs.js';
import { claimOwner } from '../helpers/claim-owner.js';
import {
  createSessionToken,
  generateChallenge,
  verifySignature,
} from '../../backend/services/auth.js';
import { generateKeypair, signMessage } from '../../core/weave/keypair.js';
import { neumaWorkspace } from '../../core/index.js';
import { getRealmRoot, setRealmRoot } from '../../backend/services/user-realm.js';

const MINE = 'position-owner-mine';
const THEIRS = 'position-owner-theirs';
const POSITION_ENV = [
  'NEUMA_SOCIAL_BINDINGS_PATH',
  'NEUMA_EMAIL_BINDINGS_PATH',
  'NEUMA_CMO_PATH',
  'NEUMA_SECURITY_CSO_PATH',
];

const identity = async () => {
  const keypair = generateKeypair();
  const challenge = generateChallenge(keypair.address);
  const signature = await signMessage(keypair.privateKey, challenge);
  return {
    wallet: keypair.address,
    token: createSessionToken(verifySignature(keypair.address, challenge, signature)),
  };
};

const authedPut = (app, token, route, body) => request(app)
  .put(route)
  .set('Authorization', `Bearer ${token}`)
  .send(body);

describe('house position lane ownership', () => {
  let app;
  let caller;
  let previousRoot;
  let savedEnv;
  let previousRealm;

  beforeAll(async () => {
    const root = await createTempDir('position-lane-ownership');
    const workspaces = path.join(root, 'workspaces');
    caller = await identity();
    const foreign = await identity();
    previousRoot = neumaWorkspace.root;
    neumaWorkspace.root = workspaces;
    // The seats are per house in the realm — every house here is tmp.
    previousRealm = getRealmRoot();
    setRealmRoot(path.join(root, 'realm'));
    await claimOwner(workspaces, MINE, caller.wallet);
    await claimOwner(workspaces, THEIRS, foreign.wallet);

    savedEnv = Object.fromEntries(POSITION_ENV.map((key) => [key, process.env[key]]));
    process.env.NEUMA_SOCIAL_BINDINGS_PATH = path.join(root, 'social-bindings.json');
    process.env.NEUMA_EMAIL_BINDINGS_PATH = path.join(root, 'email-bindings.json');
    process.env.NEUMA_CMO_PATH = path.join(root, 'cmo.json');
    process.env.NEUMA_SECURITY_CSO_PATH = path.join(root, 'cso.json');

    const [social, email, campaigns, cso] = await Promise.all([
      import('../../backend/routes/social-channel-routes.js'),
      import('../../backend/routes/email-routes.js'),
      import('../../backend/routes/campaign-routes.js'),
      import('../../backend/routes/cso-routes.js'),
    ]);
    app = express();
    app.use(express.json());
    app.use('/social', social.default);
    app.use('/email', email.default);
    app.use('/campaigns', campaigns.default);
    app.use('/cso', cso.default);
  }, 20000);

  afterAll(() => {
    neumaWorkspace.root = previousRoot;
    setRealmRoot(previousRealm);
    for (const key of POSITION_ENV) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
  });

  it.each([
    ['/social/x/binding', { neumaId: THEIRS }],
    ['/email/binding', { neumaId: THEIRS }],
    ['/campaigns/cmo', { laneId: THEIRS }],
    ['/cso/seat', { laneId: THEIRS }],
  ])('refuses a foreign lane at %s', async (route, body) => {
    const response = await authedPut(app, caller.token, route, body);
    expect(response.status).toBe(403);
    expect(response.body.error).toBe('Not your neuma');
  });

  it.each([
    ['/social/x/binding', { neumaId: MINE }],
    ['/email/binding', { neumaId: MINE }],
    ['/campaigns/cmo', { laneId: MINE }],
    ['/cso/seat', { laneId: MINE }],
  ])('admits the caller-owned lane at %s', async (route, body) => {
    const response = await authedPut(app, caller.token, route, body);
    expect(response.status).toBe(200);
  });
});
