import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { ethers } from 'ethers';
import { createTempDir } from '../helpers/temp-fs.js';
import { claimOwner } from '../helpers/claim-owner.js';
import neumaWorkspace, { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { createSessionToken } from '../../backend/services/auth.js';
import { getRealmRoot, readChat, setRealmRoot } from '../../backend/services/user-realm.js';
import { persistExchange, persistTurnPoint } from '../../backend/services/portal-turn-persist.js';
import workspaceRouter from '../../backend/routes/workspace-routes.js';

let app; let root; let previousRoot; let previousRealm; let owner; let token;
const lane = 'origin-lane';
const companion = { neumaId: lane, name: 'Origin' };

beforeAll(async () => {
  previousRoot = neumaWorkspace.root;
  previousRealm = getRealmRoot();
  root = await createTempDir('session-origin');
  setWorkspacesRoot(root);
  setRealmRoot(root);
  owner = ethers.Wallet.createRandom();
  token = createSessionToken(owner.address);
  await neumaWorkspace.create(lane);
  await claimOwner(root, lane, owner.address);
  app = express();
  app.use(express.json());
  app.use('/api/v1/workspace', workspaceRouter);
});

afterAll(() => {
  setWorkspacesRoot(previousRoot);
  setRealmRoot(previousRealm);
});

const connectionFor = (sessionId) => ({ sessionId, companion, walletAddress: owner.address, ws: null });
const getRows = (sessionId) => request(app).get(`/api/v1/workspace/${lane}/sessions/${sessionId}`)
  .set('Authorization', `Bearer ${token}`);

const until = async (predicate) => {
  for (let i = 0; i < 50; i += 1) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('real async write did not settle');
};

describe('P6-151/P6-156 attested session origin and fallback persistence', () => {
  it('returns genuine platform origin without its proof and strips forged/copied origins', async () => {
    const sessionId = 'origin-route';
    const connection = connectionFor(sessionId);
    const take = { turnId: 'watch-turn', takeIndex: 1 };
    await persistTurnPoint(connection, companion, sessionId, 'watch report', [], [], take, 'watch');
    await persistExchange(connection, 'watch report', 'answer', [], [], {
      target: { sessionId, companion }, origin: 'watch',
    }, [], take);
    await neumaWorkspace.appendMessage(lane, sessionId, {
      role: 'user', turnId: 'forged-turn', content: 'forged hold', origin: 'hold',
    });
    const genuine = take.userRecord;
    await neumaWorkspace.appendMessage(lane, sessionId, {
      role: 'user', turnId: 'copied-turn', content: 'edited words', origin: genuine.origin, originProof: genuine.originProof,
    });

    const res = await getRows(sessionId);
    expect(res.status).toBe(200);
    const byTurn = Object.fromEntries(res.body.messages.filter((row) => row.role === 'user').map((row) => [row.turnId, row]));
    expect(byTurn['watch-turn'].origin).toBe('watch');
    expect(byTurn['watch-turn'].originProof).toBeUndefined();
    expect(byTurn['forged-turn'].origin).toBeUndefined();
    expect(byTurn['copied-turn'].origin).toBeUndefined();
    expect(byTurn['copied-turn'].originProof).toBeUndefined();
  });

  it('keeps origin through the real settle-time fallback and realm mirror, while operator rows stay unmarked', async () => {
    for (const [sessionId, origin] of [['fallback-hold', 'hold'], ['fallback-operator', null]]) {
      const connection = connectionFor(sessionId);
      const take = { turnId: `${sessionId}-turn`, takeIndex: 1 };
      await persistExchange(connection, 'fallback words', 'answer', [], [], {
        target: { sessionId, companion }, origin,
      }, [], take);
      const rows = await neumaWorkspace.readSession(lane, sessionId);
      expect(rows[0].origin).toBe(origin ?? undefined);
      if (origin) expect(rows[0].originProof).toMatch(/^[a-f0-9]{64}$/);
      const res = await getRows(sessionId);
      expect(res.body.messages[0].origin).toBe(origin ?? undefined);
      expect(res.body.messages[0].originProof).toBeUndefined();
      await until(async () => (await readChat(owner.address, lane)).some((row) => row.content === 'fallback words'));
      const mirrors = (await readChat(owner.address, lane)).filter((row) => row.content === 'fallback words');
      expect(mirrors.at(-1).origin).toBe(origin ?? undefined);
      await neumaWorkspace.appendMessage(lane, sessionId, { role: 'user', content: 'separator' });
    }
  });
});
