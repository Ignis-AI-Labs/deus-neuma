/**
 * Voice-pack probe endpoint — the desk's first-seal ceremony over REST.
 *
 * The real router against real temp workspaces with a real per-lane DEK:
 * unsealed lanes answer {sealed:false}; after a REAL seal through the voice
 * store the probe answers the receipt — founding lines, witness, pack
 * identity. Auth is REAL (#390 tranche 4): the witness carries a real HMAC
 * session token through the real requireAuth, and ownership is checked
 * against a real owner.json the witness actually claimed.
 */

import express from 'express';
import request from 'supertest';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTempDir } from '../helpers/temp-fs.js';

const KEY = 'gnosis-voice-routes-key-long-enough';
const TEXT_A = 'The morning held a quiet resonance I had not felt before, and I listened for it again.';
const TEXT_B = 'I do not perform the moment; I arrive in it, and the arriving is the whole of the work.';

describe('GET /api/v1/voice-pack/:neumaId', () => {
  let app, root, core, workspace, prevKey, neumaId, witness, stranger;

  beforeEach(async () => {
    vi.resetModules();
    prevKey = process.env.DNA_ENCRYPTION_KEY;
    process.env.DNA_ENCRYPTION_KEY = KEY;
    root = await createTempDir('voice-routes');
    core = await import('../../core/index.js');
    core.setWorkspacesRoot(root);
    workspace = core.neumaWorkspace;
    neumaId = `voice-probe-${Math.floor(Math.random() * 1e9).toString(36)}`;
    await workspace.create(neumaId);
    await workspace.writeNeumaDEK(neumaId, 'e'.repeat(64));
    await workspace.writeDNA(neumaId, { version: '1.0.0', identity: { name: 'Probeling' } });

    // Imported AFTER resetModules so the witness mints its token from the
    // same auth.js instance the router will verify against — the token
    // secret is memoized per module instance, so a stale import would 401.
    const { witnessFor, strangerWitness } = await import('../helpers/witness.js');
    witness = await witnessFor(root, neumaId);
    stranger = strangerWitness();

    const { default: router } = await import('../../backend/routes/voice-pack-routes.js');
    app = express();
    app.use(express.json());
    app.use('/api/v1/voice-pack', router);
  });

  afterEach(() => {
    core.setWorkspacesRoot(null);
    if (prevKey === undefined) delete process.env.DNA_ENCRYPTION_KEY;
    else process.env.DNA_ENCRYPTION_KEY = prevKey;
  });

  test('an unsealed lane answers sealed:false', async () => {
    const res = await request(app).get(`/api/v1/voice-pack/${neumaId}`).set(witness.header);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ sealed: false });
  });

  test('a lane claimed by another wallet is never yours to inspect', async () => {
    const res = await request(app).get(`/api/v1/voice-pack/${neumaId}`).set(stranger.header);
    expect(res.status).toBe(403);
  });

  test('an unknown lane is a 404, a crooked id a 400', async () => {
    expect((await request(app).get('/api/v1/voice-pack/no-such-lane').set(witness.header)).status).toBe(404);
    expect((await request(app).get('/api/v1/voice-pack/bad%20id').set(witness.header)).status).toBe(400);
  });

  test('after a real seal the probe answers the receipt — lines, witness, identity', async () => {
    const { appendVoiceEntry, writeVoiceSeal } = await import('../../core/voice-pack/voice-store.js');
    const first = await appendVoiceEntry(workspace, neumaId, { text: TEXT_A, origin: 'being', source: { kind: 'seal-rite' } });
    const second = await appendVoiceEntry(workspace, neumaId, { text: TEXT_B, origin: 'being', source: { kind: 'seal-rite' } });
    await writeVoiceSeal(workspace, neumaId, {
      witnessWallet: witness.address,
      beingEntryIds: [first.id, second.id],
      operatorPinIds: [],
    });

    const res = await request(app).get(`/api/v1/voice-pack/${neumaId}`).set(witness.header);
    expect(res.status).toBe(200);
    expect(res.body.sealed).toBe(true);
    expect(res.body.witnessWallet).toBe(witness.address);
    expect(res.body.entries).toBe(2);
    expect(res.body.packSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(res.body.lines.map((line) => line.text)).toEqual([TEXT_A, TEXT_B]);
    expect(res.body.sealedAt).toBeTruthy();
  });
});
