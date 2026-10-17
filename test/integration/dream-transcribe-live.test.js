// dream-transcribe-live — a minute-long dream, recorded the way a phone records
// (WebM/Opus), kept by the real dream routes and written down by the REAL
// whisper sidecar the real engine-manager launches. The whole road a dream
// travels once it reaches the desk: POST → transcribe → poll until the words land.
//
// GPU (whisper, ~4 GB): runs only when summoned —
//   RUN_VOICE_ENGINE_LIVE=1 npx vitest run --project substrate-live test/integration/dream-transcribe-live.test.js
// The sidecar binds an ephemeral port (WHISPER_PORT), never the registry's 7865
// the desk's own dictation may already hold, and is shut down after.
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import express from 'express';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTempDir } from '../helpers/temp-fs.js';
import { freePort } from '../helpers/speak-live-kit.js';

const LIVE = process.env.RUN_VOICE_ENGINE_LIVE === '1';
const DREAM = [
  'I was walking through a house made of glass.',
  'Every room was full of water up to my knees, and the water was warm.',
  'My grandmother was there, sitting at a piano that had no keys.',
  'She told me the stairs went down into the sea, so I followed them.',
  'At the bottom there was a library where the books were made of light.',
  'I opened one and it showed me my own hands, older than they are now.',
  'Then a bell rang somewhere far above, and the whole house began to sing.',
].join(' ');

let app;
let witness;
let shutdownAll;
let webm;

beforeAll(async () => {
  if (!LIVE) return;
  process.env.WHISPER_PORT = String(await freePort());
  const dir = await createTempDir('dream-live');
  const wav = path.join(dir, 'dream.wav');
  webm = path.join(dir, 'dream.webm');
  execFileSync('espeak-ng', ['-s', '120', '-w', wav, DREAM]);
  // As a phone's MediaRecorder writes it: Opus in WebM, mono, speech bitrate.
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', wav, '-ac', '1', '-c:a', 'libopus', '-b:a', '32k', webm]);
  const { strangerWitness } = await import('../helpers/witness.js');
  witness = strangerWitness();
  const realm = await import('../../backend/services/user-realm.js');
  realm.setRealmRoot(await createTempDir('dream-live-realm'));
  ({ shutdownAll } = await import('../../backend/services/voice/engine-manager.js'));
  const { default: router } = await import('../../backend/routes/dream-routes.js');
  app = express();
  app.use('/api/v1/user/dreams', router);
});

afterAll(() => { if (LIVE) shutdownAll(); });

describe.skipIf(!LIVE)('a dream, written down by the real whisper sidecar (RUN_VOICE_ENGINE_LIVE=1)', () => {
  it('kept, transcribed in the background, and the words are the dream', { timeout: 10 * 60_000 }, async () => {
    const audio = fs.readFileSync(webm);
    const kept = await request(app).post('/api/v1/user/dreams?id=dream-live-0001&durationMs=60000')
      .set(witness.header).set('Content-Type', 'audio/webm;codecs=opus').send(audio);
    expect(kept.status).toBe(201);

    const t0 = Date.now();
    const started = await request(app).post('/api/v1/user/dreams/dream-live-0001/transcribe').set(witness.header);
    expect(started.status).toBe(202);
    expect(started.body.dream.transcript.state).toBe('working');

    let dream;
    for (;;) {
      await new Promise((r) => setTimeout(r, 1000));
      [dream] = (await request(app).get('/api/v1/user/dreams').set(witness.header)).body.dreams;
      if (dream.transcript.state !== 'working') break;
    }
    const seconds = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`[dream-transcribe-live] ${audio.length} bytes of opus → words in ${seconds}s (incl. sidecar launch):\n${dream.transcript.text}`);
    expect(dream.transcript.state).toBe('done');
    const words = dream.transcript.text.toLowerCase();
    for (const w of ['glass', 'water', 'grandmother', 'piano', 'stairs', 'sea', 'library', 'hands', 'bell']) {
      expect(words).toContain(w);
    }
  });
});
