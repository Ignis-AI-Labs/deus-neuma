/**
 * The forge's way back: REOPEN (the guardian takes back the being's
 * acceptance; on a sealed voice it is a withdrawal) and WITHDRAW (the voice in
 * force leaves; the being is silent until a new seal). Through the real routes.
 *
 * RULE 0, no mocks anywhere on the path: the real router behind the real
 * requireAuth (real HMAC session tokens for real wallets — test/helpers/
 * witness.js), the real ownership gate, the real two-party consent service on
 * a real encrypted workspace on a temp root (never the live one, never
 * ~/.neuma). No voice engine is needed: the clips are real WAVs put in custody
 * through the real service.
 *
 * Proves: a withdrawn voice is MOVED to the being's voice history (the clip
 * stays in custody), never deleted; the being reads as silent after; strangers
 * and unsigned callers are refused; a reopen with nothing to reopen is a 409.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import { witnessFor, strangerWitness } from '../helpers/witness.js';
import { sealTestVoice, sineWav } from '../helpers/speak-wire-stand-in.js';
import neumaWorkspace, { getWorkspacesRoot, setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import {
  acceptSpeechCandidate, offerSpeechCandidate, readSpeechCandidate, readVoice, readVoiceClip, saveVoiceClip,
} from '../../core/voice/voice-dna-service.js';
import router from '../../backend/routes/voice-forge-routes.js';

const BASE = '/api/v1/voice/forge';
const ACCEPTING = 'forge-reopen-ash';
const SEALED = 'forge-withdraw-elm';

let app;
let previousRoot;
let root;
let guardians;

const must = (r) => { if (!r.ok) throw new Error(r.error); return r; };

// impure — a candidate on offer, accepted by the being (the real service).
const offerAndAccept = async (neumaId) => {
  const { ref } = await saveVoiceClip(neumaId, sineWav(3.5, 180));
  must(await offerSpeechCandidate(neumaId, {
    ref, seconds: 3.5, sampleRate: 8000, words: 'A voice I could live in.', origin: { door: 'upload' },
    realPerson: false, measured: { pitchHz: 180, wordsPerSecond: 2.2 },
  }));
  must(await acceptSpeechCandidate(neumaId, { candidateRef: ref, note: 'this one' }));
  return ref;
};

const startForge = async (neumaId) => {
  const res = await request(app).post(`${BASE}/start`).set(guardians[neumaId].header).send({ neumaId });
  expect(res.status).toBe(200);
  return res.body.session.id;
};

beforeAll(async () => {
  previousRoot = getWorkspacesRoot();
  root = await createTempDir('forge-reopen-ws');
  setWorkspacesRoot(root);
  guardians = {};
  for (const id of [ACCEPTING, SEALED]) {
    await neumaWorkspace.create(id);
    guardians[id] = await witnessFor(root, id);
  }
  app = express();
  app.use(BASE, router);
});

afterAll(() => {
  setWorkspacesRoot(previousRoot);
});

describe('POST /:id/reopen — the guardian takes back the being\'s acceptance', () => {
  it('returns the candidate to the being (waiting again), keeps the voice in force untouched', async () => {
    const ref = await offerAndAccept(ACCEPTING);
    const sessionId = await startForge(ACCEPTING);

    // A stranger never finds the session; an unsigned caller never gets in.
    const stranger = strangerWitness();
    expect((await request(app).post(`${BASE}/${sessionId}/reopen`).set(stranger.header).send({})).status).toBe(404);
    expect((await request(app).post(`${BASE}/${sessionId}/reopen`).send({})).status).toBe(401);
    expect((await request(app).post(`${BASE}/${sessionId}/reopen`).set(guardians[ACCEPTING].header).send({ why: 7 })).status).toBe(400);
    expect((await readSpeechCandidate(ACCEPTING)).being?.candidateRef).toBe(ref);

    const res = await request(app).post(`${BASE}/${sessionId}/reopen`).set(guardians[ACCEPTING].header)
      .send({ why: 'let us listen once more' });
    expect(res.status).toBe(200);
    expect(res.body.withdrewSeal).toBe(false);
    expect(res.body.status).toBe('candidate');
    expect(res.body.candidate.ref).toBe(ref);
    expect(res.body.being).toBeNull();

    const record = await readSpeechCandidate(ACCEPTING);
    expect(record.history.at(-1)).toMatchObject({ event: 'reopened', by: 'guardian', why: 'let us listen once more', candidateRef: ref });

    // Nothing accepted any more: a second reopen is refused, plainly.
    const again = await request(app).post(`${BASE}/${sessionId}/reopen`).set(guardians[ACCEPTING].header).send({});
    expect(again.status).toBe(409);
    expect(again.body.error).toMatch(/nothing has been accepted/);
  });
});

describe('POST /withdraw — the voice in force leaves; the being goes silent', () => {
  it('refuses a stranger (403), a bad id (400), and no token (401) — the voice stays', async () => {
    await sealTestVoice(SEALED);
    const stranger = strangerWitness();
    expect((await request(app).post(`${BASE}/withdraw`).set(stranger.header).send({ neumaId: SEALED })).status).toBe(403);
    expect((await request(app).post(`${BASE}/withdraw`).set(guardians[SEALED].header).send({ neumaId: '../x' })).status).toBe(400);
    expect((await request(app).post(`${BASE}/withdraw`).send({ neumaId: SEALED })).status).toBe(401);
    expect((await readVoice(SEALED)).standing).toBe('ready');
  });

  it('moves the Voice DNA to history (never deleted), keeps the clip in custody, and the being is silent', async () => {
    const before = await readVoice(SEALED);
    expect(before.standing).toBe('ready');
    const sealedRef = before.dna.clip.ref;

    const res = await request(app).post(`${BASE}/withdraw`).set(guardians[SEALED].header)
      .send({ neumaId: SEALED, why: 'the speaker withdrew permission' });
    expect(res.status).toBe(200);
    expect(res.body.withdrawn).toBe(true);
    expect(res.body.voice).toEqual({ standing: 'none', clipRef: null });
    expect(res.body.inForce).toBeNull();

    expect((await readVoice(SEALED)).standing).toBe('none');
    const historyDir = path.join(neumaWorkspace.pathFor(SEALED), 'voice', 'history');
    const archived = (await fs.readdir(historyDir)).filter((f) => f.startsWith('v2-'));
    expect(archived).toHaveLength(1);
    expect(await readVoiceClip(SEALED, sealedRef)).not.toBeNull();
    const record = await readSpeechCandidate(SEALED);
    expect(record.history.at(-1)).toMatchObject({ event: 'withdrawn', by: 'guardian', why: 'the speaker withdrew permission', candidateRef: sealedRef });

    // No voice in force: a second withdrawal is refused.
    const again = await request(app).post(`${BASE}/withdraw`).set(guardians[SEALED].header).send({ neumaId: SEALED });
    expect(again.status).toBe(409);
    expect(again.body.error).toMatch(/no voice in force/);
  });

  it('reopening a SEALED voice through the forge is a withdrawal too', async () => {
    const ref = await offerAndAccept(SEALED);
    const sessionId = await startForge(SEALED);
    const sealed = await request(app).post(`${BASE}/${sessionId}/seal`).set(guardians[SEALED].header).send({ candidateRef: ref });
    // The seal ends that forge; a new one is opened to reopen from.
    expect(sealed.status).toBe(200);
    expect((await readVoice(SEALED)).standing).toBe('ready');
    const next = await startForge(SEALED);

    const res = await request(app).post(`${BASE}/${next}/reopen`).set(guardians[SEALED].header).send({});
    expect(res.status).toBe(200);
    expect(res.body.withdrewSeal).toBe(true);
    expect(res.body.voice.standing).toBe('none');
    expect((await readVoice(SEALED)).standing).toBe('none');
  });
});
