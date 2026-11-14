/* global process */
// Dictation on the graphics card, for real (managed-stt.js): the platform's own CUDA 13 build of
// whisper.cpp b5454 (scripts/speech/build-whisper-cuda.sh) and the turbo model, chosen by the real
// device rule from this machine's real card, its CUDA libraries borrowed from Ollama; a held key read
// back from the card; and a card build that cannot start leaves the processor answering.
// GPU-engine test: runs only when summoned (RUN_GPU_ENGINE_TESTS=1, serial substrate-live lane), and
// only where the pinned files are on this rig (/mnt/data/neuma/stt-pin/<build>). No mocks (RULE 0).
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTempDir } from '../helpers/temp-fs.js';
import { gpuSkipNote, shouldRunGpuEngineTests } from '../helpers/gpu-optin.js';
import { STT_GPU_MODEL, STT_MODEL, WHISPER_CPP_BUILD, sttEngineFor, sttGpuEngineFor } from '../../backend/services/managed-stt-plan.js';

const PINS = `/mnt/data/neuma/stt-pin/${WHISPER_CPP_BUILD}`;
const cpuEngine = sttEngineFor('linux', 'x64');
const gpuEngine = sttGpuEngineFor('linux', 'x64');
const pinned = process.platform === 'linux' && process.arch === 'x64'
  && [cpuEngine.name, gpuEngine.name, STT_MODEL.name, STT_GPU_MODEL.name].every((f) => fs.existsSync(path.join(PINS, f)));
const run = shouldRunGpuEngineTests() && pinned;
if (!shouldRunGpuEngineTests()) console.warn(gpuSkipNote('dictation on the graphics card'));
const SPEECH = path.resolve('test/fixtures/speech-16k.wav');

let stt;
let root;
beforeAll(async () => {
  if (!run) return;
  root = await createTempDir('managed-stt-gpu');
  process.env.NEUMA_DATA_ROOT = path.join(root, 'data');
  stt = await import('../../backend/services/managed-stt.js');
  const { installArchive } = await import('../../backend/services/managed-ollama-download.js');
  // installArchive removes the archive it unpacks: it works on copies, never the rig's pins
  for (const [engine, files] of [[cpuEngine, stt.sttFiles()], [gpuEngine, stt.sttGpuFiles()]]) {
    const archive = path.join(root, engine.name);
    fs.copyFileSync(path.join(PINS, engine.name), archive);
    await installArchive(engine, archive, files.dir);
    fs.mkdirSync(path.dirname(files.modelPath), { recursive: true });
    fs.copyFileSync(path.join(PINS, files.model.name), files.modelPath);
  }
}, 120_000);
afterAll(() => stt?.stopSttServer());

describe.skipIf(!run)('dictation on the graphics card', () => {
  it('this card has room beside the house: the turbo model reads a held key back from it', async () => {
    const device = await stt.currentSttDevice();
    expect(device.device, device.reason).toBe('gpu');
    expect((await stt.sttReadiness())).toMatchObject({ ready: true, device: 'gpu' });
    await stt.ensureSttServer();
    expect(stt.sttServerDevice()).toBe('gpu');
    const t0 = performance.now();
    const out = await stt.transcribeWav(fs.readFileSync(SPEECH), { prompt: 'neuma' });
    const ms = performance.now() - t0;
    expect(out.text.toLowerCase()).toMatch(/speaks from the void/);
    expect(ms).toBeLessThan(1500);
  }, 120_000);

  it('a card build that cannot start leaves the processor answering', async () => {
    stt.stopSttServer();
    const bin = stt.sttGpuFiles().bin;
    fs.rmSync(bin); // replaced, not rewritten: the stopped server may still be leaving it
    fs.writeFileSync(bin, '#!/bin/sh\nexit 1\n', { mode: 0o755 }); // a broken card build
    await stt.ensureSttServer();
    expect(stt.sttServerDevice()).toBe('processor');
    const out = await stt.transcribeWav(fs.readFileSync(SPEECH), { prompt: 'neuma' });
    expect(out.text.toLowerCase()).toMatch(/void/);
  }, 120_000);
});
