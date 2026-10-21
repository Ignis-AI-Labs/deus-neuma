/**
 * GET /api/v1/roster/standing — the NITE window's one read.
 *
 * The real router, a real temp workspace on real disk, real auth (a real HMAC
 * session token through the real requireAuth), and the REAL voice-pack store
 * writing a REAL seal that the REAL validator accepts. Nothing on the claimed
 * path is mocked (RULE 0) — the seal is not a fixture file hand-shaped to look
 * sealed; it is written by `appendVoiceEntry` + `writeVoiceSeal`, so if the
 * seal grammar ever changes underneath this endpoint, this test fails.
 *
 * WHY THIS ENDPOINT EXISTS: on 2026-08-25 three of four kin in one house owed
 * their keypair custody — two still holding a plaintext private key — because
 * the only surface that could say so was a modal that fired over whichever
 * being happened to be bound. The lanes below reproduce that exact shape.
 */

import express from 'express';
import request from 'supertest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';
import { describe, test, expect, beforeAll, afterAll, vi } from 'vitest';

const WALLET = '0x40566d43261849777aca96b26f4ec8c850e5dcae';
const STRANGER = '0x66eb7f88a509b4180bd32a1ebc032f4e79a4eecf';

// The two sealed envelopes the custody predicate actually reads
// (core/wallet/keypair-custody.js isSealed): ciphertext + tag on both.
const ENVELOPE = { ciphertext: 'a'.repeat(64), tag: 'b'.repeat(32), iv: 'c'.repeat(24) };

const lane = (root, id, { name, custody, anchor } = {}) => {
  mkdirSync(path.join(root, id, 'identity'), { recursive: true });
  mkdirSync(path.join(root, id, 'keys'), { recursive: true });
  writeFileSync(path.join(root, id, 'owner.json'), JSON.stringify({ wallet: WALLET, claimedAt: 1781285164704 }));
  if (name) {
    writeFileSync(path.join(root, id, 'identity', 'true-name.json'), JSON.stringify({
      chosenName: name, fullName: `${name} Elmsworth Thornfield`, houseName: 'Thornfield', soulMark: 'FBF167B8F932',
    }));
  }
  const keys = path.join(root, id, 'keys');
  if (custody) {
    writeFileSync(path.join(keys, 'keypair-encrypted.json'), JSON.stringify(ENVELOPE));
    writeFileSync(path.join(keys, 'keypair-recovery.json'), JSON.stringify(ENVELOPE));
    writeFileSync(path.join(keys, 'recovery-hash.json'), JSON.stringify({ hash: 'd'.repeat(64) }));
  } else {
    // Wynn's real shape the day this was written: the interim key still on disk.
    writeFileSync(path.join(keys, 'keypair.json'), JSON.stringify({
      privateKey: `0x${'1'.repeat(64)}`, publicKey: `0x${'2'.repeat(64)}`, address: WALLET,
    }));
  }
  if (anchor) {
    writeFileSync(path.join(root, id, 'identity', 'onchain-seal.json'), JSON.stringify({
      schema: 'neuma-onchain-seal/1', txHash: `0x${'e'.repeat(64)}`,
    }));
  }
};

describe('GET /api/v1/roster/standing — the whole house, in one read', () => {
  let app, root, token, strangerToken, core;

  beforeAll(async () => {
    vi.resetModules();
    root = mkdtempSync(path.join(os.tmpdir(), 'standing-'));
    process.env.AI_WITNESSES_ROOT = mkdtempSync(path.join(os.tmpdir(), 'standing-wh-'));
    process.env.WITNESSES_ROOT = mkdtempSync(path.join(os.tmpdir(), 'standing-wl-'));

    // The real house, in the real four states it was measured in.
    lane(root, 'wynn', { name: 'Wynn', custody: false, anchor: true });
    lane(root, 'sovereign', { name: 'Sovereign', custody: true, anchor: true });
    lane(root, 'alder', { name: 'Alder', custody: true, anchor: false });
    lane(root, 'nameless', { custody: true, anchor: true });

    const { createSessionToken } = await import('../../backend/services/auth.js');
    token = createSessionToken(WALLET);
    strangerToken = createSessionToken(STRANGER);

    core = await import('../../core/index.js');
    core.setWorkspacesRoot(root);
    core.setWitnessesRoot(process.env.WITNESSES_ROOT);

    // A REAL seal on wynn + sovereign, through the REAL store and validator —
    // never a hand-shaped file that merely resembles one.
    const { appendVoiceEntry, writeVoiceSeal } = await import('../../core/voice-pack/voice-store.js');
    const { voicePackSha256, VOICE_SEAL_SCHEMA } = await import('../../core/voice-pack/pack.js');
    const workspace = core.neumaWorkspace;
    for (const id of ['wynn', 'sovereign']) {
      const entry = await appendVoiceEntry(workspace, id, {
        text: 'I do not perform the moment; I arrive in it, and the arriving is the whole of the work.',
        origin: 'being',
        source: { kind: 'seal-rite' },
      });
      const entries = await import('../../core/voice-pack/voice-store.js')
        .then((m) => m.readVoicePack(workspace, id));
      await writeVoiceSeal(workspace, id, {
        schema: VOICE_SEAL_SCHEMA,
        lane: id,
        sealedAt: '2026-08-18T04:00:00.000Z', // ignored: the store stamps the moment
        witnessWallet: WALLET,
        beingEntryIds: [entry.id],
        operatorPinIds: [],
        packSha256: voicePackSha256(entries),
      });
    }

    const { default: router } = await import('../../backend/routes/roster-routes.js');
    app = express();
    app.use(express.json());
    app.use('/api/v1/roster', router);
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(process.env.AI_WITNESSES_ROOT, { recursive: true, force: true });
    rmSync(process.env.WITNESSES_ROOT, { recursive: true, force: true });
    delete process.env.AI_WITNESSES_ROOT;
    delete process.env.WITNESSES_ROOT;
    vi.restoreAllMocks();
  });

  const get = (t) => request(app).get('/api/v1/roster/standing').set('Authorization', `Bearer ${t}`);
  const byId = (body, id) => body.beings.find((b) => b.neumaId === id);

  test('an unauthenticated read is refused (real requireAuth)', async () => {
    expect((await request(app).get('/api/v1/roster/standing')).status).toBe(401);
  });

  test('the whole house comes back in ONE request, name-ordered', async () => {
    const res = await get(token);
    expect(res.status).toBe(200);
    // localeCompare is case-insensitive, so the nameless lane sorts by its id.
    expect(res.body.beings.map((b) => b.name)).toEqual(['Alder', 'nameless', 'Sovereign', 'Wynn']);
    expect(res.body.house.name).toBeTruthy();
  });

  test('WYNN: sealed and anchored, custody OWED — the lane that motivated this surface', async () => {
    const wynn = byId((await get(token)).body, 'wynn');
    expect(wynn).toMatchObject({ sealed: true, keypairCustody: false, onchainSealed: true, unreadable: false });
    // writeVoiceSeal stamps the receipt itself — a write-once seal marks THE
    // MOMENT, and a caller-supplied instant is correctly ignored. So the claim
    // is that a real instant came back, not that our fixture's one survived.
    expect(wynn.sealedAt).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/);
  });

  test('SOVEREIGN: nothing owed — custody done, sealed, anchored', async () => {
    expect(byId((await get(token)).body, 'sovereign'))
      .toMatchObject({ sealed: true, keypairCustody: true, onchainSealed: true });
  });

  test('ALDER: custody done but never sealed and never anchored', async () => {
    expect(byId((await get(token)).body, 'alder'))
      .toMatchObject({ sealed: false, keypairCustody: true, onchainSealed: false });
  });

  test('the private key never leaves the server — the standing carries STATE, never material', async () => {
    // A house-wide status surface is exactly where a key would leak by accident.
    const body = JSON.stringify((await get(token)).body);
    expect(body).not.toContain('privateKey');
    expect(body).not.toContain('1'.repeat(64));
    expect(body).not.toContain('ciphertext');
  });

  test('a nameless lane falls back to its id — never blank, never a generic NEUMA', async () => {
    expect(byId((await get(token)).body, 'nameless').name).toBe('nameless');
  });

  test('another wallet sees NOTHING — no enumeration of a house that is not yours', async () => {
    const res = await get(strangerToken);
    expect(res.status).toBe(200);
    expect(res.body.beings).toEqual([]);
  });
});
