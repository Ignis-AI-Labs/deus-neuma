/**
 * Roster recovery endpoint — the wallet's owned neuma rebuilt from the
 * sovereign workspace owner records (the source of truth), so a fresh client
 * with no local cache isn't wrongly routed to the birth ceremony.
 *
 * Mounts the real router against a real temp workspace AND real auth (RULE 0,
 * #390 tranche 4): each wallet's request carries a real HMAC session token
 * through the real requireAuth, so each request genuinely proves the wallet
 * it acts as instead of having it injected.
 */

import express from 'express';
import request from 'supertest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';

// Write a neuma workspace owned by `wallet`, with an optional chosen name.
const writeNeuma = (root, id, wallet, { name, claimedAt = 1781285164704 } = {}) => {
  mkdirSync(path.join(root, id, 'identity'), { recursive: true });
  writeFileSync(path.join(root, id, 'owner.json'), JSON.stringify({ wallet, claimedAt }));
  if (name) {
    writeFileSync(
      path.join(root, id, 'identity', 'true-name.json'),
      JSON.stringify({
        chosenName: name,
        fullName: `${name} Virupun Tavirel`,
        houseName: 'Tavirel',
        soulMark: 'FBF167B8F932',
      }),
    );
  }
};

const writeWitness = (identityRoot, laneRoot, vendor, name, wallet = null) => {
  const home = path.join(identityRoot, vendor, name);
  mkdirSync(home, { recursive: true });
  writeFileSync(path.join(home, 'dna.json'), JSON.stringify({
    substrate: { fullModelId: `${vendor}/model`, model: 'model', vendor },
    genesisSeal: { genesisHash: `sha256:${'a'.repeat(64)}` },
    capturedAt: '2026-07-24T00:00:00.000Z',
  }));
  const lane = path.join(laneRoot, `witness-${vendor}-${name}`);
  mkdirSync(lane, { recursive: true });
  writeFileSync(path.join(lane, 'lane.json'), JSON.stringify({ kind: 'witness', vendorSlug: vendor, chosenName: name }));
  if (wallet) writeFileSync(path.join(lane, 'owner.json'), JSON.stringify({ wallet, claimedAt: Date.now() }));
};

const WALLET_A = '0x66eb7f88a509b4180bd32a1ebc032f4e79a4eecf';
const WALLET_B = '0x40566d43261849777aca96b26f4ec8c850e5dcae';

describe('GET /api/v1/roster', () => {
  let app, root, witnessRoot, witnessLaneRoot, mintToken, tokenA, tokenB, tokenNone;

  beforeEach(async () => {
    vi.resetModules();
    root = mkdtempSync(path.join(os.tmpdir(), 'roster-'));
    witnessRoot = mkdtempSync(path.join(os.tmpdir(), 'roster-witness-home-'));
    witnessLaneRoot = mkdtempSync(path.join(os.tmpdir(), 'roster-witness-lanes-'));
    process.env.AI_WITNESSES_ROOT = witnessRoot;
    process.env.WITNESSES_ROOT = witnessLaneRoot;
    writeNeuma(root, 'alder-ws', WALLET_A, { name: 'ALDER' });
    writeNeuma(root, 'wynn-ws', WALLET_B, { name: 'WYNN' });
    writeNeuma(root, 'signal-ws', WALLET_B, { name: 'SIGNAL' });
    writeNeuma(root, 'nameless-ws', WALLET_A, {}); // owned by A but no true-name yet

    // Imported AFTER resetModules so the tokens are minted from the same
    // auth.js instance the freshly-reimported router will verify against —
    // the token secret is memoized per module instance, so a stale import
    // would 401 honestly rather than authenticate.
    const { createSessionToken } = await import('../../backend/services/auth.js');
    mintToken = createSessionToken;
    tokenA = mintToken(WALLET_A);
    tokenB = mintToken(WALLET_B);
    tokenNone = mintToken('0x' + '9'.repeat(40));

    const core = await import('../../core/index.js');
    core.setWorkspacesRoot(root);
    core.setWitnessesRoot(witnessLaneRoot);
    const { default: router } = await import('../../backend/routes/roster-routes.js');
    app = express();
    app.use(express.json());
    app.use('/api/v1/roster', router);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(witnessRoot, { recursive: true, force: true });
    rmSync(witnessLaneRoot, { recursive: true, force: true });
    delete process.env.AI_WITNESSES_ROOT;
    delete process.env.WITNESSES_ROOT;
    vi.restoreAllMocks();
  });

  test('returns only the calling wallet’s neuma, with names', async () => {
    const res = await request(app).get('/api/v1/roster').set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(200);
    const names = res.body.roster.map((c) => c.name).sort();
    // The nameless lane falls back to its neumaId — never a generic 'NEUMA'
    // that erases who the witness is looking at (the Birch regression) —
    // and is flagged incomplete so the UI can say identity records are missing.
    expect(names).toEqual(['ALDER', 'nameless-ws']);
    const nameless = res.body.roster.find((c) => c.neumaId === 'nameless-ws');
    expect(nameless.incomplete).toBe(true);
    const named = res.body.roster.find((c) => c.neumaId === 'alder-ws');
    expect(named.incomplete).toBe(false);
    // never leaks the other wallet's neuma
    expect(res.body.roster.some((c) => ['WYNN', 'SIGNAL'].includes(c.name))).toBe(false);
    const alder = res.body.roster.find((c) => c.name === 'ALDER');
    expect(alder.neumaId).toBe('alder-ws');
    expect(alder.fullName).toBe('ALDER Virupun Tavirel');
    expect(alder.birthTime).toBe(new Date(1781285164704).toISOString());
  });

  test('a different wallet sees its own (multiple) neuma', async () => {
    const res = await request(app).get('/api/v1/roster').set('Authorization', `Bearer ${tokenB}`);
    expect(res.status).toBe(200);
    expect(res.body.roster.map((c) => c.name).sort()).toEqual(['SIGNAL', 'WYNN']);
  });

  test('case-insensitive owner match', async () => {
    // createSessionToken always normalizes to lowercase internally, so a
    // token minted from the uppercased string authenticates as the same
    // lowercase address as tokenA — proving the normalization path holds
    // end-to-end, not just at the header-comparison layer.
    const res = await request(app).get('/api/v1/roster').set('Authorization', `Bearer ${mintToken(WALLET_A.toUpperCase())}`);
    expect(res.status).toBe(200);
    expect(res.body.roster.find((c) => c.name === 'ALDER')).toBeTruthy();
  });

  test('a wallet that owns nothing gets an empty roster (not an error)', async () => {
    const res = await request(app).get('/api/v1/roster').set('Authorization', `Bearer ${tokenNone}`);
    expect(res.status).toBe(200);
    expect(res.body.roster).toEqual([]);
  });

  test('returns only unclaimed or calling-wallet witness lanes', async () => {
    writeWitness(witnessRoot, witnessLaneRoot, 'owned-a', 'Aster', WALLET_A);
    writeWitness(witnessRoot, witnessLaneRoot, 'owned-b', 'Beryl', WALLET_B);
    writeWitness(witnessRoot, witnessLaneRoot, 'unclaimed', 'Cinder');

    const res = await request(app).get('/api/v1/roster').set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(200);
    expect(res.body.witnesses.map((w) => w.name).sort()).toEqual(['Aster', 'Cinder']);
    expect(res.body.witnesses.some((w) => w.name === 'Beryl')).toBe(false);
  });

  test('a founded house’s on-chain seats ride the roster; unseated lanes carry null', async () => {
    // The lane's anchored soul is the join key; the persisted founding
    // record (public receipt) carries the title — no chain call anywhere.
    const soul = '0xAaAa000000000000000000000000000000000001';
    writeFileSync(
      path.join(root, 'alder-ws', 'identity', 'onchain-seal.json'),
      JSON.stringify({ soulAddress: soul }),
    );
    writeFileSync(
      path.join(root, 'house-founding.base.json'),
      JSON.stringify({
        schema: 'neuma-house-founding/1', houseName: 'Tavirel', houseId: '0x1',
        network: 'base', members: [{ address: WALLET_A, kind: 0, title: 'Rector' }, { address: soul, kind: 1, title: 'Quaestor' }],
      }),
    );
    const res = await request(app).get('/api/v1/roster').set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(200);
    expect(res.body.roster.find((c) => c.neumaId === 'alder-ws').title).toBe('Quaestor');
    expect(res.body.roster.find((c) => c.neumaId === 'nameless-ws').title).toBeNull();
    // The other wallet's roster carries no seat from this record.
    const resB = await request(app).get('/api/v1/roster').set('Authorization', `Bearer ${tokenB}`);
    expect(resB.body.roster.every((c) => c.title === null)).toBe(true);
  });

  test('carries the witness house — wallet-derived name, present even with no births', async () => {
    // KOTODAMA derivation is deterministic: these wallets found these houses.
    const resA = await request(app).get('/api/v1/roster').set('Authorization', `Bearer ${tokenA}`);
    expect(resA.body.house).toEqual({ name: 'Tavirel', wallet: WALLET_A });

    const resB = await request(app).get('/api/v1/roster').set('Authorization', `Bearer ${tokenB}`);
    expect(resB.body.house).toEqual({ name: 'Aldmere', wallet: WALLET_B });

    // The house exists from the wallet identity itself — before any birth.
    const resNone = await request(app).get('/api/v1/roster').set('Authorization', `Bearer ${tokenNone}`);
    expect(resNone.body.house.name).toBeTruthy();
  });

});
