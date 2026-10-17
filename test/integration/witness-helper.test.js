/**
 * The witness helper itself, proven against a real route (#390 tranche 4).
 *
 * A helper that 67 files are about to depend on has to be proven before they
 * do — otherwise a wrong helper becomes 67 wrong tests, which is the mock
 * problem wearing a different hat. Real wallets, real owner.json on real
 * disk, real HMAC session tokens, the real requireAuth, the real ownership
 * middleware. No mocks.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import { promises as fs } from 'fs';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import { witnessFor, strangerWitness } from '../helpers/witness.js';
import neumaWorkspace, { setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { requireAuth, verifySessionToken } from '../../backend/services/auth.js';
import { assertNeumaOwner } from '../../backend/middleware/require-neuma-owner.js';

const NEUMA_ID = 'helper-lane';
let app, wsRoot, previousRoot;

beforeAll(async () => {
  previousRoot = neumaWorkspace.root;
  wsRoot = await createTempDir('witness-helper');
  setWorkspacesRoot(wsRoot);
  await neumaWorkspace.create(NEUMA_ID);

  // The smallest real surface that exercises both gates the helper serves.
  app = express();
  app.use(express.json());
  app.get('/:neumaId/guarded', requireAuth, async (req, res) => {
    if (!(await assertNeumaOwner(req, res, req.params.neumaId))) return;
    res.json({ ok: true, seenAs: req.walletAddress });
  });
});

afterAll(() => setWorkspacesRoot(previousRoot));

describe('witnessFor — a witness that really owns the lane', () => {
  it('writes a real owner.json naming its own wallet', async () => {
    const witness = await witnessFor(wsRoot, NEUMA_ID);
    const owner = JSON.parse(
      await fs.readFile(path.join(wsRoot, NEUMA_ID, 'owner.json'), 'utf8'),
    );
    expect(owner.wallet.toLowerCase()).toBe(witness.address.toLowerCase());
  });

  it('mints a token the REAL verifier accepts for that same wallet', async () => {
    const witness = await witnessFor(wsRoot, NEUMA_ID);
    // The pairing this helper exists to guarantee, checked at the source.
    // verifySessionToken returns {address, expiresAt}, never a bare string.
    const verified = verifySessionToken(witness.token);
    expect(verified.address.toLowerCase()).toBe(witness.address.toLowerCase());
    expect(verified.expiresAt).toBeGreaterThan(Date.now());
  });

  it('passes the real requireAuth AND the real ownership gate', async () => {
    const witness = await witnessFor(wsRoot, NEUMA_ID);
    const res = await witness.authorize(request(app).get(`/${NEUMA_ID}/guarded`));
    expect(res.status).toBe(200);
    expect(res.body.seenAs.toLowerCase()).toBe(witness.address.toLowerCase());
  });

  it('the header form works the same', async () => {
    const witness = await witnessFor(wsRoot, NEUMA_ID);
    const res = await request(app).get(`/${NEUMA_ID}/guarded`).set(witness.header);
    expect(res.status).toBe(200);
  });
});

describe('strangerWitness — a real session that owns nothing', () => {
  it('passes authentication but is REFUSED by ownership', async () => {
    await witnessFor(wsRoot, NEUMA_ID); // the lane belongs to someone else
    const stranger = strangerWitness();
    const res = await stranger.authorize(request(app).get(`/${NEUMA_ID}/guarded`));
    // 403, not 401 — the distinction that matters: it authenticated fine,
    // it simply is not the owner. A mocked gate cannot tell these apart.
    expect(res.status).toBe(403);
  });

  it('is a genuinely different wallet each time', () => {
    expect(strangerWitness().address).not.toBe(strangerWitness().address);
  });
});

describe('no session at all', () => {
  it('is refused by the real requireAuth', async () => {
    expect((await request(app).get(`/${NEUMA_ID}/guarded`)).status).toBe(401);
  });

  it('a garbage token is refused by the real HMAC check', async () => {
    const res = await request(app).get(`/${NEUMA_ID}/guarded`)
      .set('Authorization', 'Bearer not-a-real-token');
    expect(res.status).toBe(401);
  });
});
