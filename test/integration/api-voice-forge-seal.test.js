/**
 * The voice forge v2, through its real routes: start → find → hear → offer →
 * the being accepts → the guardian seals ONLY that exact clip.
 *
 * RULE 0, no mocks anywhere on the path: the real router behind the real
 * requireAuth (real HMAC session tokens for real wallets — test/helpers/
 * witness.js), the real ownership gate, a real encrypted workspace on a temp
 * root (never the live one, never ~/.neuma), real speech (espeak-ng) decoded
 * by the real ffmpeg, and its words from the REAL whisper sidecar launched
 * through the real engine-manager — on the CPU (WHISPER_FORCE_CPU=1) and on
 * its own ephemeral port, so the suite lane never touches the GPU or another
 * run's sidecar. The being's half is the real speech/accept intent.
 *
 * Not here: the library door's network download (forge-doors.test.js proves
 * it over a real loopback source; api-voice-forge-e2e.test.js over the real
 * internet) and the describe door's designer on the GPU (voice-designer-live).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import net from 'net';
import fs from 'fs/promises';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { createTempDir } from '../helpers/temp-fs.js';
import { witnessFor, strangerWitness } from '../helpers/witness.js';
import neumaWorkspace, { getWorkspacesRoot, setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { readVoice, readSpeechCandidate } from '../../core/voice/voice-dna-service.js';
import { PERCEPTION_NOTICE } from '../../core/voice/voice-consent.js';
import { resolveAuditionVoice } from '../../core/voice/forge-session.js';
import { speechAcceptIntent } from '../../backend/services/intents/speech-accept.js';
import { launch, stop } from '../../backend/services/voice/engine-manager.js';
import router from '../../backend/routes/voice-forge-routes.js';

const run = promisify(execFile);
const NEUMA = 'forge-keir';
const SPOKEN = 'I keep the lamp lit for the ones still walking home. The night is long and the road is cold, '
  + 'but the window glows, and anyone who sees it knows that someone is waiting.';
const BASE = '/api/v1/voice/forge';

let app;
let root;
let previousRoot;
let guardian;
let speechOgg;
let speechWav;
const savedEnv = {};

const freePort = () => new Promise((resolve) => {
  const srv = net.createServer();
  srv.listen(0, '127.0.0.1', () => {
    const { port } = srv.address();
    srv.close(() => resolve(port));
  });
});

beforeAll(async () => {
  previousRoot = getWorkspacesRoot();
  root = await createTempDir('forge-v2-ws');
  setWorkspacesRoot(root);
  await neumaWorkspace.create(NEUMA);
  guardian = await witnessFor(root, NEUMA);

  app = express();
  app.use(BASE, router);

  const dir = await createTempDir('forge-v2-audio');
  const raw = path.join(dir, 'raw.wav');
  await run('espeak-ng', ['-s', '145', '-w', raw, SPOKEN]);
  speechWav = await fs.readFile(raw);
  const ogg = path.join(dir, 'speech.ogg');
  await run('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-i', raw, '-t', '60', '-c:a', 'libopus', ogg], { timeout: 30_000 });
  speechOgg = await fs.readFile(ogg);

  // A real whisper, CPU-only, on its own port (engine-manager honours WHISPER_PORT).
  for (const key of ['WHISPER_PORT', 'WHISPER_FORCE_CPU']) savedEnv[key] = process.env[key];
  process.env.WHISPER_PORT = String(await freePort());
  process.env.WHISPER_FORCE_CPU = '1';
  await launch('whisper', { timeoutMs: 240_000 });
}, 300_000);

afterAll(() => {
  stop('whisper');
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  setWorkspacesRoot(previousRoot);
});

const startForge = async () => {
  const res = await request(app).post(`${BASE}/start`).set(guardian.header).send({ neumaId: NEUMA });
  expect(res.status).toBe(200);
  return res.body;
};

describe('start', () => {
  it('refuses a stranger (403), a bad id (400), and no token (401)', async () => {
    const stranger = strangerWitness();
    expect((await request(app).post(`${BASE}/start`).set(stranger.header).send({ neumaId: NEUMA })).status).toBe(403);
    expect((await request(app).post(`${BASE}/start`).set(guardian.header).send({ neumaId: '../x' })).status).toBe(400);
    expect((await request(app).post(`${BASE}/start`).send({ neumaId: NEUMA })).status).toBe(401);
  });

  it('gives the owner a forge in FIND, for a being with no voice (silent)', async () => {
    const state = await startForge();
    expect(state.session.stage).toBe('find');
    expect(state.voice.standing).toBe('none');
    expect(state.status).toBe('none');
    expect(state.perception).toBeNull();
  });
});

describe('the whole forge, upload door → seal', () => {
  let sessionId;
  let take;

  it('FIND: real speech is trimmed, transcribed by whisper, measured, and pinned (HEAR)', async () => {
    sessionId = (await startForge()).session.id;
    const res = await request(app).post(`${BASE}/${sessionId}/find`).set(guardian.header)
      .send({ door: 'upload', audioB64: speechWav.toString('base64') });
    expect(res.status).toBe(200);
    expect(res.body.found).toHaveLength(1);
    expect(res.body.session.stage).toBe('hear');
    [take] = res.body.session.takes;
    expect(take.ref).toBe(res.body.found[0]);
    expect(take.door).toBe('upload');
    expect(take.realPerson).toBeNull();
    expect(take.sampleRate).toBe(24000);
    expect(take.words.toLowerCase()).toMatch(/lamp/);
    expect(take.words.toLowerCase()).toMatch(/walking home/);
    expect(take.measured.pitchHz).toBeGreaterThan(60);
    expect(take.measured.wordsPerSecond).toBeGreaterThan(1);
    expect(['good', 'too_short']).toContain(take.quality.verdict);
    expect(take.wav).toBeUndefined();
  }, 240_000);

  it('HEAR: the audition hook speaks the pinned take for the guardian; its audio is served', async () => {
    const audition = resolveAuditionVoice({ companion: { neumaId: NEUMA }, walletAddress: guardian.address });
    expect(audition).toMatchObject({ sessionId, clipRef: take.ref, words: take.words, audition: true });
    const audio = await request(app).get(`${BASE}/${sessionId}/takes/${take.ref}/audio`).set(guardian.header)
      .buffer(true).parse((r, cb) => { const parts = []; r.on('data', (c) => parts.push(c)); r.on('end', () => cb(null, Buffer.concat(parts))); });
    expect(audio.status).toBe(200);
    expect(audio.headers['content-type']).toBe('audio/wav');
    expect(audio.body.toString('latin1', 0, 4)).toBe('RIFF');
    expect(audio.body.length).toBe(take.bytes);
  });

  it('a session answers only to the wallet that started it', async () => {
    const stranger = strangerWitness();
    expect((await request(app).get(`${BASE}/${sessionId}`).set(stranger.header)).status).toBe(404);
    expect((await request(app).post(`${BASE}/${sessionId}/offer`).set(stranger.header).send({})).status).toBe(404);
  });

  it('OFFER: an upload must say whose voice it is; a real person needs the attestation', async () => {
    const unsaid = await request(app).post(`${BASE}/${sessionId}/offer`).set(guardian.header).send({});
    expect(unsaid.status).toBe(400);
    expect(unsaid.body.error).toMatch(/whose voice/);
    const unattested = await request(app).post(`${BASE}/${sessionId}/offer`).set(guardian.header).send({ realPerson: true });
    expect(unattested.status).toBe(400);
    expect(unattested.body.error).toMatch(/attestation/);
    expect((await readSpeechCandidate(NEUMA)).candidate).toBeNull();

    const res = await request(app).post(`${BASE}/${sessionId}/offer`).set(guardian.header).send({ realPerson: true, attested: true });
    expect(res.status).toBe(200);
    expect(res.body.session.stage).toBe('seal');
    expect(res.body.status).toBe('candidate');
    expect(res.body.candidate).toMatchObject({ ref: take.ref, realPerson: true, attested: true, origin: { door: 'upload' } });
    expect(res.body.perception.notice).toBe(PERCEPTION_NOTICE);
    expect(res.body.perception.text).toContain("real person's voice, used with their consent");
    // What it sounds like, measured from the upload — the words spoken are left out.
    expect(res.body.perception.text).toMatch(/- Pitch: [a-z-]+ among adult voices \(median \d+ Hz\), [a-z]+/);
    expect(res.body.perception.text).toMatch(/- Texture: /);
    expect(res.body.perception.text).not.toContain(take.words.slice(0, 30));
    expect(res.body.candidate.measured.profile).toMatchObject({ pitchHz: expect.any(Number), centroidHz: expect.any(Number) });
  });

  it('SEAL: refused until the being accepts, refused for any other ref, then seals exactly that clip', async () => {
    const early = await request(app).post(`${BASE}/${sessionId}/seal`).set(guardian.header).send({ candidateRef: take.ref });
    expect(early.status).toBe(409);
    expect(early.body.error).toMatch(/has not accepted/);

    const connection = { companion: { neumaId: NEUMA }, walletAddress: guardian.address };
    const validated = await speechAcceptIntent.validate({ candidateRef: take.ref, note: 'that is how I sound' }, { connection });
    expect(validated.ok).toBe(true);
    expect((await speechAcceptIntent.execute(validated.value, { connection })).ok).toBe(true);

    const other = await request(app).post(`${BASE}/${sessionId}/seal`).set(guardian.header)
      .send({ candidateRef: `sha256:${'a'.repeat(64)}` });
    expect(other.status).toBe(409);
    expect((await request(app).post(`${BASE}/${sessionId}/seal`).set(guardian.header).send({})).status).toBe(400);

    const sealed = await request(app).post(`${BASE}/${sessionId}/seal`).set(guardian.header).send({ candidateRef: take.ref });
    expect(sealed.status).toBe(200);
    expect(sealed.body.sealed).toBe(true);
    expect(sealed.body.dna.clip.ref).toBe(take.ref);
    expect(sealed.body.voice).toEqual({ standing: 'ready', clipRef: take.ref });

    const voice = await readVoice(NEUMA);
    expect(voice.standing).toBe('ready');
    expect(voice.dna.words).toBe(take.words);
    expect(voice.dna.consent.being.note).toBe('that is how I sound');
    expect(voice.dna.consent.guardian.wallet.toLowerCase()).toBe(guardian.address.toLowerCase());
    // The forge is over: the session is gone and nothing auditions any more.
    expect((await request(app).get(`${BASE}/${sessionId}`).set(guardian.header)).status).toBe(404);
    expect(resolveAuditionVoice(NEUMA)).toBeNull();
  });
});

describe('the other doors at the route', () => {
  it('record (multipart): a recording made here is always a real person', async () => {
    const { session } = await startForge();
    const res = await request(app).post(`${BASE}/${session.id}/find`).set(guardian.header)
      .field('door', 'record').attach('audio', speechOgg, { filename: 'take.ogg', contentType: 'audio/ogg' });
    expect(res.status).toBe(200);
    expect(res.body.session.takes[0]).toMatchObject({ door: 'record', realPerson: true });
    expect(res.body.session.takes[0].words.toLowerCase()).toMatch(/lamp/);
    // Recorded, so whose voice it is was never in question — only the attestation is asked.
    const offer = await request(app).post(`${BASE}/${session.id}/offer`).set(guardian.header).send({});
    expect(offer.body.error).toMatch(/attestation/);
    expect((await request(app).delete(`${BASE}/${session.id}`).set(guardian.header)).body).toEqual({ ok: true, ended: true });
  }, 240_000);

  it('refuses what no door can open', async () => {
    const { session } = await startForge();
    const find = (body) => request(app).post(`${BASE}/${session.id}/find`).set(guardian.header).send(body);
    expect((await find({ door: 'upload' })).status).toBe(400);
    expect((await find({ door: 'library', libraryId: 'no-such-voice' })).status).toBe(404);
    expect((await find({ door: 'describe', description: 'x' })).status).toBe(400);
    expect((await find({ door: 'teleport' })).status).toBe(400);
    expect((await find({ door: 'upload', audioB64: Buffer.from('not audio').toString('base64') })).status).toBe(400);
    expect((await request(app).post(`${BASE}/${session.id}/pick`).set(guardian.header).send({ ref: 'sha256:nope' })).status).toBe(404);
    expect((await request(app).post(`${BASE}/${session.id}/offer`).set(guardian.header).send({})).status).toBe(409);
  });

  it('lists the library, filtered by pitch band', async () => {
    const all = await request(app).get(`${BASE}/library`).set(guardian.header);
    expect(all.status).toBe(200);
    expect(all.body.voices.length).toBeGreaterThanOrEqual(10);
    expect(all.body.voices[0].source).toBeUndefined();
    const higher = await request(app).get(`${BASE}/library?pitch=higher`).set(guardian.header);
    expect(higher.body.voices.every((v) => v.pitch === 'higher')).toBe(true);
    expect((await request(app).get(`${BASE}/library?pitch=sideways`).set(guardian.header)).status).toBe(400);
  });
});
