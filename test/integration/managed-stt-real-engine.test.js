/* global process */
// Dictation on an installed app with the REAL engine (managed-stt.js): whisper.cpp b5454's own
// server unpacked from its pinned archive by the platform's installArchive, the pinned base model,
// started at boot with no request, then a real recording of speech read back. It stays up after the
// read: nothing unloads it (ears-style, 2026-11-12). Runs where the pinned files are on this rig
// (/mnt/data/neuma/stt-pin/<build>); skipped elsewhere. No stand-in, no mock (RULE 0).
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTempDir } from '../helpers/temp-fs.js';
import { STT_MODEL, WHISPER_CPP_BUILD, sttEngineFor } from '../../backend/services/managed-stt-plan.js';

const PINS = `/mnt/data/neuma/stt-pin/${WHISPER_CPP_BUILD}`;
const engine = sttEngineFor('linux', 'x64');
const have = process.platform === 'linux' && process.arch === 'x64'
  && fs.existsSync(path.join(PINS, engine.name)) && fs.existsSync(path.join(PINS, STT_MODEL.name));
const SPEECH = path.resolve('test/fixtures/speech-16k.wav'); // "The Neuma speaks from the void. This voice is a preset, not a clone."

let stt;
beforeAll(async () => {
  if (!have) return;
  process.env.NEUMA_DATA_ROOT = path.join(await createTempDir('managed-stt-real'), 'data');
  stt = await import('../../backend/services/managed-stt.js');
});
afterAll(() => stt?.stopSttServer());

describe.skipIf(!have)('the processor speech engine, for real', () => {
  it('starts nothing at boot until it is set up', () => {
    expect(stt.startSttAtBoot({ managed: true })).toBeNull();
  });

  it('set up, it loads at boot, reads a held key back quickly, and stays loaded', async () => {
    const { installArchive } = await import('../../backend/services/managed-ollama-download.js');
    const f = stt.sttFiles();
    const engineDir = path.dirname(path.dirname(f.bin));
    fs.mkdirSync(path.dirname(engineDir), { recursive: true });
    // installArchive removes the archive it unpacks: it works on a copy, never the rig's pin
    const archive = path.join(path.dirname(engineDir), engine.name);
    fs.copyFileSync(path.join(PINS, engine.name), archive);
    await installArchive(engine, archive, engineDir);
    fs.mkdirSync(path.dirname(f.modelPath), { recursive: true });
    fs.copyFileSync(path.join(PINS, STT_MODEL.name), f.modelPath);
    expect((await stt.sttReadiness()).ready).toBe(true);

    const port = await stt.startSttAtBoot({ managed: true });
    expect(port).toBeGreaterThan(0);
    expect((await fetch(`http://127.0.0.1:${port}/`)).status).toBeLessThan(500);

    const t0 = performance.now();
    const out = await stt.transcribeWav(fs.readFileSync(SPEECH), { prompt: 'neuma' });
    const ms = performance.now() - t0;
    expect(out.text.toLowerCase()).toMatch(/speaks from the void/);
    expect(out.text.toLowerCase()).toMatch(/preset/);
    expect(ms).toBeLessThan(5000);

    // a second hold goes to the same loaded server: same port, no new start
    expect(await stt.ensureSttServer()).toBe(port);
    expect((await fetch(`http://127.0.0.1:${port}/`)).status).toBeLessThan(500);
  }, 120_000);
});
