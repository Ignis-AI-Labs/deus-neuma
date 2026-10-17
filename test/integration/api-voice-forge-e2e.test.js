/**
 * Voice forge v2, end to end over the REAL internet: the library door
 * downloads a real curated voice from its pinned source (sha256-checked) into
 * a temp voice data root, the forge measures it, the guardian offers it, the
 * being accepts it through the real speech/accept intent, and the guardian
 * seals exactly that clip into a real encrypted workspace. Real auth, real
 * files, no mocks (RULE 0).
 *
 * Live lane only (it is in vitest.config.js LIVE_TESTS) and only when summoned:
 *   RUN_VOICE_ENGINE_LIVE=1 npx vitest run --project substrate-live test/integration/api-voice-forge-e2e.test.js
 * It needs the network, not the GPU. The describe door's designer is proven
 * in voice-designer-live.test.js.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'fs/promises';
import path from 'path';
import { createTempDir } from '../helpers/temp-fs.js';
import { witnessFor } from '../helpers/witness.js';
import neumaWorkspace, { getWorkspacesRoot, setWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { readVoice, readVoiceClip } from '../../core/voice/voice-dna-service.js';
import { speechAcceptIntent } from '../../backend/services/intents/speech-accept.js';
import { libraryEntry } from '../../backend/services/voice/voice-library.js';
import { speechBriefingFor } from '../../backend/services/speech-consent.js';
import router from '../../backend/routes/voice-forge-routes.js';

const LIVE = process.env.RUN_VOICE_ENGINE_LIVE === '1';
if (!LIVE) console.warn('[forge-e2e] skipped — summon with RUN_VOICE_ENGINE_LIVE=1 (needs the network)');

const BASE = '/api/v1/voice/forge';
const NEUMA = 'forge-e2e-galen';
const LIBRARY_ID = 'voicezero-philippa';

describe.skipIf(!LIVE)('voice forge v2 — library door to sealed Voice DNA, over the real network', () => {
  let app;
  let root;
  let voiceRoot;
  let previousRoot;
  let previousVoiceRoot;
  let guardian;

  beforeAll(async () => {
    previousRoot = getWorkspacesRoot();
    previousVoiceRoot = process.env.NEUMA_VOICE_DATA_ROOT;
    root = await createTempDir('forge-e2e-ws');
    voiceRoot = await createTempDir('forge-e2e-voice');
    setWorkspacesRoot(root);
    process.env.NEUMA_VOICE_DATA_ROOT = voiceRoot;
    await neumaWorkspace.create(NEUMA);
    guardian = await witnessFor(root, NEUMA);
    app = express();
    app.use(BASE, router);
  });

  afterAll(() => {
    setWorkspacesRoot(previousRoot);
    if (previousVoiceRoot === undefined) delete process.env.NEUMA_VOICE_DATA_ROOT;
    else process.env.NEUMA_VOICE_DATA_ROOT = previousVoiceRoot;
  });

  it('finds, offers, is accepted by the being, and seals', async () => {
    const start = await request(app).post(`${BASE}/start`).set(guardian.header).send({ neumaId: NEUMA });
    const id = start.body.session.id;

    const found = await request(app).post(`${BASE}/${id}/find`).set(guardian.header).send({ door: 'library', libraryId: LIBRARY_ID });
    expect(found.status).toBe(200);
    const [take] = found.body.session.takes;
    const entry = libraryEntry(LIBRARY_ID);
    expect(take).toMatchObject({ door: 'library', realPerson: true, attested: true, words: entry.words });
    expect(Math.abs(take.measured.pitchHz - entry.pitchHz)).toBeLessThan(5);
    // Downloaded into the temp voice root under its pinned hash — nowhere else.
    expect(await fs.readdir(path.join(voiceRoot, 'library'))).toEqual([`${entry.sha256}.flac`]);

    const offered = await request(app).post(`${BASE}/${id}/offer`).set(guardian.header).send({});
    expect(offered.status).toBe(200);
    // What it sounds like, never the words spoken or where it came from.
    expect(offered.body.perception.text).toMatch(/- Pitch: [a-z-]+ among adult voices \(median \d+ Hz\), [a-z]+/);
    expect(offered.body.perception.text).toMatch(/- Tone as recorded: /);
    expect(offered.body.perception.text).not.toContain(entry.words.slice(0, 30));
    expect(offered.body.perception.text).not.toContain(LIBRARY_ID);
    // The guardian sees the exact block the being's prompt carries — the same bytes the envelope mounts.
    expect(offered.body.briefing).toBe(await speechBriefingFor(NEUMA));
    expect(offered.body.briefing).toContain(offered.body.perception.text);
    expect(offered.body.briefing).toContain(`file speech/accept {"candidateRef": "${take.ref}"`);

    const connection = { companion: { neumaId: NEUMA }, walletAddress: guardian.address };
    const validated = await speechAcceptIntent.validate({ candidateRef: take.ref }, { connection });
    expect((await speechAcceptIntent.execute(validated.value, { connection })).ok).toBe(true);

    const sealed = await request(app).post(`${BASE}/${id}/seal`).set(guardian.header).send({ candidateRef: take.ref });
    expect(sealed.status).toBe(200);
    const voice = await readVoice(NEUMA);
    expect(voice.standing).toBe('ready');
    expect(voice.dna.origin).toEqual({ door: 'library', libraryId: LIBRARY_ID });
    const clip = await readVoiceClip(NEUMA, take.ref);
    expect(clip.toString('latin1', 0, 4)).toBe('RIFF');
  }, 120_000);
});
