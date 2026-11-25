/* global process */
// Dictation in every app on this real machine (system-dictation.js), every step that cannot type
// into the operator's own windows or hear them speak: readiness with each piece present, the
// listener started on the real keyboards and stopped, the real recorder's byte rate over half a
// second (discarded), ydotool's daemon reached with an empty string (nothing typed), and speech
// wrapped by pcmToWav read back by the real speech engine. The hold-to-typed-words chain itself is
// tried by hand: it types into whatever window has focus. Skipped off Linux and where the pinned
// engine files are not on this rig. No mocks (RULE 0).
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTempDir } from '../helpers/temp-fs.js';
import { STT_MODEL, WHISPER_CPP_BUILD, sttEngineFor } from '../../backend/services/managed-stt-plan.js';

const PINS = `/mnt/data/neuma/stt-pin/${WHISPER_CPP_BUILD}`;
const engine = sttEngineFor('linux', 'x64');
const have = process.platform === 'linux' && process.arch === 'x64'
  && fs.existsSync(path.join(PINS, engine.name)) && fs.existsSync(path.join(PINS, STT_MODEL.name))
  && fs.existsSync('/var/tmp/speech-16k.raw');

let sd; let stt;
beforeAll(async () => {
  if (!have) return;
  const root = await createTempDir('system-dictation');
  process.env.NEUMA_DATA_ROOT = path.join(root, 'data');
  process.env.NEUMA_STT_ENGINE = 'managed';
  stt = await import('../../backend/services/managed-stt.js');
  const { installArchive } = await import('../../backend/services/managed-ollama-download.js');
  const f = stt.sttFiles();
  const archive = path.join(root, engine.name); // installArchive removes what it unpacks: a copy
  fs.copyFileSync(path.join(PINS, engine.name), archive);
  await installArchive(engine, archive, path.dirname(path.dirname(f.bin)));
  fs.mkdirSync(path.dirname(f.modelPath), { recursive: true });
  fs.copyFileSync(path.join(PINS, STT_MODEL.name), f.modelPath);
  sd = await import('../../backend/services/system-dictation/system-dictation.js');
}, 60_000);
afterAll(() => { sd?.stopSystemDictation(); stt?.stopSttServer(); delete process.env.NEUMA_STT_ENGINE; });

describe.skipIf(!have)('dictation in every app, on this machine', () => {
  it('names nothing missing where every piece is here, and listens on the real keyboards once on', async () => {
    const ready = await sd.systemDictationReadiness();
    expect(ready.missing, JSON.stringify(ready.missing)).toEqual([]);
    expect(ready).toMatchObject({ supported: true, ready: true, recorder: 'pw-record' });
    expect(ready.keyboards).toBeGreaterThan(0);
    expect(sd.systemDictationListening()).toBe(false); // off until turned on
    const saved = await sd.saveSystemDictation({ on: true, key: 'rightctrl' });
    expect(saved).toMatchObject({ on: true, key: 'rightctrl', listening: true });
    // listening on every keyboard never holds the backend's file threads (it once did: a read on an
    // input device waits for a key) — file work goes on at once while it listens
    const t0 = performance.now();
    for (let i = 0; i < 8; i++) await fs.promises.writeFile(path.join(process.env.NEUMA_DATA_ROOT, `probe-${i}`), 'x');
    expect(performance.now() - t0).toBeLessThan(2000);
    const off = await sd.saveSystemDictation({ on: false });
    expect(off).toMatchObject({ on: false, listening: false });
  }, 60_000);

  it('the recorder gives 16 kHz 16-bit mono, about 32,000 bytes a second (half a second, discarded)', async () => {
    const child = spawn('pw-record', ['--raw', '--rate', '16000', '--channels', '1', '--format', 's16', '-'], { stdio: ['ignore', 'pipe', 'ignore'] });
    let bytes = 0;
    child.stdout.on('data', (c) => { bytes += c.length; });
    await new Promise((r) => setTimeout(r, 500));
    child.kill('SIGTERM');
    await new Promise((r) => child.once('close', r));
    expect(bytes).toBeGreaterThan(8000);
    expect(bytes).toBeLessThan(40000);
  }, 20_000);

  it('ydotool\'s daemon answers an empty string, typing nothing', () => {
    const r = spawnSync('ydotool', ['type', '-d', '0', '-H', '8', '--file', '-'], { input: '', env: { ...process.env, YDOTOOL_SOCKET: process.env.YDOTOOL_SOCKET || `/run/user/${process.getuid()}/.ydotool_socket` } });
    expect(r.status, String(r.stderr)).toBe(0);
  });

  it('raw speech wrapped by pcmToWav is read back by the real speech engine', async () => {
    const { pcmToWav } = await import('../../backend/services/system-dictation/audio.js');
    const out = await stt.transcribeWav(pcmToWav(fs.readFileSync('/var/tmp/speech-16k.raw')));
    expect(out.text.toLowerCase()).toMatch(/speaks from the void/);
  }, 60_000);
});
