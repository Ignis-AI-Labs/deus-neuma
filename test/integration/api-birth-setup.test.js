/**
 * Birth-setup probe endpoint — the desk's unfinished-birth checklist over REST.
 *
 * Mounts the real router against real temp workspaces (real detectBirthSetupState
 * on real disk) AND real auth (RULE 0, #390 tranche 4): each wallet's request
 * carries a real HMAC session token through the real requireAuth, so a 403
 * here is a real gate refusing a real stranger, not a mock returning false.
 */

import express from 'express';
import request from 'supertest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';

const WALLET_A = '0x66eb7f88a509b4180bd32a1ebc032f4e79a4eecf';
const WALLET_B = '0x40566d43261849777aca96b26f4ec8c850e5dcae';

// A lane that owes both acts: interim plaintext key, no envelopes, no seal.
const writeOwedLane = (root, id, wallet) => {
  mkdirSync(path.join(root, id, 'keys'), { recursive: true });
  writeFileSync(path.join(root, id, 'owner.json'), JSON.stringify({ wallet, claimedAt: Date.now() }));
  writeFileSync(path.join(root, id, 'keys', 'keypair.json'), JSON.stringify({ privateKey: '0xinterim' }));
};

// A lane with every act checked off.
const writeDoneLane = (root, id, wallet) => {
  mkdirSync(path.join(root, id, 'keys'), { recursive: true });
  mkdirSync(path.join(root, id, 'identity'), { recursive: true });
  writeFileSync(path.join(root, id, 'owner.json'), JSON.stringify({ wallet, claimedAt: Date.now() }));
  const envelope = { version: '1.0.0', address: '0xabc', ciphertext: 'ct', iv: 'iv', tag: 'tag', salt: 's', kdf: 'pbkdf2' };
  writeFileSync(path.join(root, id, 'keys', 'keypair-encrypted.json'), JSON.stringify(envelope));
  writeFileSync(path.join(root, id, 'keys', 'keypair-recovery.json'), JSON.stringify(envelope));
  writeFileSync(path.join(root, id, 'keys', 'recovery-hash.json'), JSON.stringify({ hash: 'h' }));
  writeFileSync(path.join(root, id, 'identity', 'onchain-seal.json'), JSON.stringify({
    schema: 'neuma-onchain-seal/1', txHash: '0xdeadbeef',
  }));
};

describe('GET /api/v1/birth-setup/:neumaId', () => {
  let app, root, tokenA, tokenB;

  beforeEach(async () => {
    vi.resetModules();
    root = mkdtempSync(path.join(os.tmpdir(), 'birth-setup-'));
    writeOwedLane(root, 'owed-being', WALLET_A);
    writeDoneLane(root, 'done-being', WALLET_A);

    // Imported AFTER resetModules so the tokens are minted from the same
    // auth.js instance the freshly-reimported router will verify against —
    // the token secret is memoized per module instance, so a stale import
    // would 401 honestly rather than authenticate.
    const { createSessionToken } = await import('../../backend/services/auth.js');
    tokenA = createSessionToken(WALLET_A);
    tokenB = createSessionToken(WALLET_B);

    const core = await import('../../core/index.js');
    core.setWorkspacesRoot(root);
    const { default: router } = await import('../../backend/routes/birth-setup-routes.js');
    app = express();
    app.use(express.json());
    app.use('/api/v1/birth-setup', router);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  test('an owed lane reports both acts, in order', async () => {
    const res = await request(app).get('/api/v1/birth-setup/owed-being').set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      neumaId: 'owed-being',
      keypairCustody: false,
      localSealed: false,
      onchainSealed: false,
      complete: false,
      missing: ['keypair-custody', 'seal'],
    });
  });

  test('a finished lane reports complete', async () => {
    const res = await request(app).get('/api/v1/birth-setup/done-being').set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(200);
    expect(res.body.complete).toBe(true);
    expect(res.body.missing).toEqual([]);
  });

  test('another wallet never reads the checklist (403)', async () => {
    const res = await request(app).get('/api/v1/birth-setup/owed-being').set('Authorization', `Bearer ${tokenB}`);
    expect(res.status).toBe(403);
  });

  test('an unknown lane 404s; a traversal-shaped id 400s', async () => {
    const missing = await request(app).get('/api/v1/birth-setup/no-such-being').set('Authorization', `Bearer ${tokenA}`);
    expect(missing.status).toBe(404);
    const traversal = await request(app).get('/api/v1/birth-setup/..%2Fescape').set('Authorization', `Bearer ${tokenA}`);
    expect([400, 404]).toContain(traversal.status); // router param guard or express path handling
  });
});
