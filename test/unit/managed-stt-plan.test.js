/**
 * Dictation on an installed app (managed-stt-plan.js): whisper.cpp on the processor, its share of
 * the processor, its model, its pinned files. Pure functions over real values; the pins are checked
 * against the archives downloaded on this rig where present. No mocks.
 */
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { STT_GPU_MODEL, STT_MODEL, WHISPER_CPP_BUILD, sttEngineFor, sttGpuEngineFor, sttPlan, sttServerArgs, sttThreads } from '../../backend/services/managed-stt-plan.js';
import { encodeWav16, mixDown } from '../../frontend/utils/wav16k.js';

describe('the processor share', () => {
  it('takes a third of the cores, between 4 and 8, and never every core of a small machine', () => {
    expect(sttThreads(24)).toBe(8);
    expect(sttThreads(32)).toBe(8);
    expect(sttThreads(12)).toBe(4);
    expect(sttThreads(8)).toBe(4);
    expect(sttThreads(4)).toBe(3);
    expect(sttThreads(2)).toBe(1);
  });
  it('one model on every processor: base, quick on a held key however many cores (turbo took 8 to 15 s)', () => {
    for (const cores of [4, 8, 16, 24]) expect(sttPlan({ platform: 'linux', arch: 'x64', cores, installed: false, modelPresent: false, freeBytes: 50e9 }).model).toBe(STT_MODEL);
    expect(STT_MODEL).toMatchObject({ name: 'ggml-base-q5_1.bin', size: 59_707_625 });
  });
});

describe('the pinned files', () => {
  it('a build for Linux and Windows on x64, none elsewhere', () => {
    expect(sttEngineFor('linux', 'x64').bin).toBe('whisper-bin-ubuntu-x64/whisper-server');
    expect(sttEngineFor('win32', 'x64').bin).toBe('Release/whisper-server.exe');
    expect(sttEngineFor('darwin', 'arm64')).toBeNull();
    for (const e of [sttEngineFor('linux', 'x64'), sttEngineFor('win32', 'x64')]) {
      expect(e.url).toBe(`https://github.com/ggml-org/whisper.cpp/releases/download/${WHISPER_CPP_BUILD}/${e.name}`);
      expect(e.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(STT_MODEL.url).toMatch(/^https:\/\/huggingface\.co\/ggerganov\/whisper\.cpp\/resolve\/[0-9a-f]{40}\/ggml-base-q5_1\.bin$/);
    expect(STT_MODEL.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
  const dir = `/mnt/data/neuma/stt-pin/${WHISPER_CPP_BUILD}`;
  it.skipIf(!fs.existsSync(dir))('the archives downloaded on this rig hash to the pins', () => {
    for (const e of [sttEngineFor('linux', 'x64'), sttEngineFor('win32', 'x64')]) {
      const file = `${dir}/${e.name}`;
      if (!fs.existsSync(file)) continue;
      expect(fs.statSync(file).size).toBe(e.size);
      expect(createHash('sha256').update(fs.readFileSync(file)).digest('hex')).toBe(e.sha256);
    }
  });
});

describe('the plan and the launch', () => {
  it('downloads only what is missing, and reports ready when both are there', () => {
    const base = { platform: 'linux', arch: 'x64', cores: 24, freeBytes: 50e9 };
    expect(sttPlan({ ...base, installed: false, modelPresent: false }).steps.map((s) => s.id)).toEqual(['download', 'pull']);
    expect(sttPlan({ ...base, installed: true, modelPresent: false }).steps.map((s) => s.id)).toEqual(['pull']);
    const ready = sttPlan({ ...base, installed: true, modelPresent: true });
    expect(ready).toMatchObject({ ready: true, downloadBytes: 0, threads: 8, engine: 'whisper.cpp' });
    expect(sttPlan({ ...base, platform: 'darwin', arch: 'arm64', installed: false, modelPresent: false }).supported).toBe(false);
    expect(sttPlan({ ...base, installed: false, modelPresent: false, freeBytes: 1e6 }).enoughDisk).toBe(false);
  });
  it('serves on loopback only, on its share, every language, the graphics card only when asked', () => {
    const a = sttServerArgs({ modelPath: '/m/x.bin', threads: 8, port: 4321 });
    expect(a.join(' ')).toBe('-m /m/x.bin -t 8 --host 127.0.0.1 --port 4321 -l auto -ng');
    expect(sttServerArgs({ modelPath: '/m/t.bin', threads: 4, port: 4321, gpu: true }).join(' ')).toBe('-m /m/t.bin -t 4 --host 127.0.0.1 --port 4321 -l auto');
  });
  it('on the card: turbo and the card build, with the processor files kept as the fallback', () => {
    const base = { platform: 'linux', arch: 'x64', cores: 16, freeBytes: 50e9, device: 'gpu' };
    const fresh = sttPlan({ ...base, installed: false, modelPresent: false });
    expect(fresh).toMatchObject({ device: 'gpu', model: STT_GPU_MODEL, ready: false });
    expect(fresh.steps.map((s) => s.id)).toEqual(['download', 'pull', 'download-gpu', 'pull-gpu']);
    // dictating on the processor already: ready, the card's pair still to come
    expect(sttPlan({ ...base, installed: true, modelPresent: true, gpuInstalled: true, gpuModelPresent: false })).toMatchObject({ ready: true, cardReady: false });
    expect(sttPlan({ ...base, installed: true, modelPresent: true, gpuInstalled: true, gpuModelPresent: true })).toMatchObject({ ready: true, cardReady: true, downloadBytes: 0 });
    // no card build for Windows: the processor, whatever the device rule said
    expect(sttPlan({ ...base, platform: 'win32', installed: true, modelPresent: true })).toMatchObject({ device: 'processor', model: STT_MODEL, ready: true });
  });
  it('the card build is ours, hosted beside the app, pinned', () => {
    const g = sttGpuEngineFor('linux', 'x64');
    expect(g.url).toBe(`https://github.com/Ignis-AI-Labs/deus-neuma/releases/download/speech-whisper.cpp-${WHISPER_CPP_BUILD}-cuda13/whisper-cuda13-linux-x64.tar.gz`);
    expect(g.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(g.size).toBeGreaterThan(1e6);
    expect(sttGpuEngineFor('win32', 'x64')).toBeNull();
  });
});

describe('16 kHz WAV for the processor engine', () => {
  it('writes a standard 16-bit mono header and clamps the samples', () => {
    const wav = new DataView(encodeWav16(new Float32Array([0, 1, -1, 2])));
    const tag = (at) => String.fromCharCode(...[0, 1, 2, 3].map((i) => wav.getUint8(at + i)));
    expect([tag(0), tag(8), tag(12), tag(36)]).toEqual(['RIFF', 'WAVE', 'fmt ', 'data']);
    expect(wav.getUint16(22, true)).toBe(1);
    expect(wav.getUint32(24, true)).toBe(16000);
    expect(wav.getUint16(34, true)).toBe(16);
    expect(wav.getUint32(40, true)).toBe(8);
    expect([wav.getInt16(46, true), wav.getInt16(48, true), wav.getInt16(50, true)]).toEqual([32767, -32768, 32767]);
  });
  it('mixes channels into one', () => {
    expect([...mixDown([new Float32Array([1, 0]), new Float32Array([0, 1])])]).toEqual([0.5, 0.5]);
  });
});
