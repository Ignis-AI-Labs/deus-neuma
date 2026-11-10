/**
 * Dictation on an installed app (managed-stt-plan.js): whisper.cpp on the processor, its share of
 * the processor, its model, its pinned files. Pure functions over real values; the pins are checked
 * against the archives downloaded on this rig where present. No mocks.
 */
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { STT_MODELS, WHISPER_CPP_BUILD, sttEngineFor, sttModelFor, sttPlan, sttServerArgs, sttThreads } from '../../backend/services/managed-stt-plan.js';
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
  it('the turbo model where a third of the processor is enough for it, the small one below', () => {
    expect(sttModelFor(24)).toBe(STT_MODELS.turbo);
    expect(sttModelFor(12)).toBe(STT_MODELS.turbo);
    expect(sttModelFor(8)).toBe(STT_MODELS.small);
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
    for (const m of Object.values(STT_MODELS)) expect(m.url).toMatch(/^https:\/\/huggingface\.co\/ggerganov\/whisper\.cpp\/resolve\/[0-9a-f]{40}\/ggml-/);
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
  it('serves on loopback only, on its share, every language, never the graphics card', () => {
    const a = sttServerArgs({ modelPath: '/m/x.bin', threads: 8, port: 4321 });
    expect(a.join(' ')).toBe('-m /m/x.bin -t 8 --host 127.0.0.1 --port 4321 -l auto -ng');
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
