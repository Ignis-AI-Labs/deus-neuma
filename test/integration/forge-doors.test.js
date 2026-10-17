/**
 * The forge doors' real IO, without the GPU: real speech (espeak-ng, rendered
 * at test time), the real ffmpeg decoding it from the containers people
 * actually upload, the best-window pick on that speech, and the library door
 * downloading a real audio file over a real loopback HTTP server into a temp
 * voice data root with its sha256 checked. No mock anywhere (RULE 0).
 *
 * Whisper's words are proven through the forge route (api-voice-forge-seal);
 * the designer on the GPU in voice-designer-live.test.js.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'child_process';
import { createHash } from 'crypto';
import fs from 'fs/promises';
import http from 'http';
import path from 'path';
import { promisify } from 'util';
import { createTempDir } from '../helpers/temp-fs.js';
import {
  FORGE_SAMPLE_RATE, bestSpeechWindow, decodeAudio, findFromLibrary, frameLevels, measureClip, speechFrames,
} from '../../backend/services/voice/forge-doors.js';
import { fetchLibraryClip, libraryEntry, listLibrary } from '../../backend/services/voice/voice-library.js';

const run = promisify(execFile);
const SPOKEN = 'The lamp stays lit for the ones still walking home. I keep it burning through the long night, '
  + 'and when the morning comes I let it rest.';

let dir;
let speechWav;
const asFormat = async (ext, args = []) => {
  const out = path.join(dir, `speech.${ext}`);
  await run('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-i', speechWav, ...args, out]);
  return fs.readFile(out);
};

beforeAll(async () => {
  dir = await createTempDir('forge-doors');
  speechWav = path.join(dir, 'speech.wav');
  // Silence before and after, like a real recording that starts and ends late.
  const raw = path.join(dir, 'raw.wav');
  await run('espeak-ng', ['-s', '150', '-w', raw, SPOKEN]);
  // Every lavfi source is bounded by its own input -t, and the output by -t 60:
  // an unbounded anullsrc writes forever (os.tmpdir() is RAM on this rig).
  const silence = ['-f', 'lavfi', '-t', '3', '-i', 'anullsrc=r=22050:cl=mono'];
  await run('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...silence, '-i', raw, ...silence,
    '-filter_complex', '[0][1][2]concat=n=3:v=0:a=1', '-t', '60', '-ar', '44100', '-ac', '2', speechWav], { timeout: 30_000 });
}, 60_000);

describe('decodeAudio — any container to 24 kHz mono', () => {
  it.each([['wav', []], ['mp3', []], ['ogg', ['-c:a', 'libopus']], ['flac', []], ['m4a', ['-c:a', 'aac']]])(
    'reads %s and keeps the length', async (ext, args) => {
      const bytes = ext === 'wav' ? await fs.readFile(speechWav) : await asFormat(ext, args);
      const samples = await decodeAudio(bytes);
      const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', speechWav]);
      expect(Math.abs(samples.length / FORGE_SAMPLE_RATE - Number(stdout))).toBeLessThan(0.15);
    },
    30_000,
  );

  it('refuses bytes that are not audio, with ffmpeg\'s own reason, as a 400', async () => {
    await expect(decodeAudio(Buffer.from('this is not audio at all'))).rejects.toMatchObject({ status: 400 });
  });
});

describe('the best window on real speech', () => {
  it('trims the leading and trailing silence and measures a clean voice', async () => {
    const samples = await decodeAudio(await fs.readFile(speechWav));
    const total = samples.length / FORGE_SAMPLE_RATE;
    const w = bestSpeechWindow(speechFrames(frameLevels(samples, FORGE_SAMPLE_RATE)).speech);
    expect(w.start).toBeGreaterThan(2.6);
    expect(w.start).toBeLessThan(3.2);
    expect(total - w.end).toBeGreaterThan(2.6);
    const m = measureClip(samples.subarray(Math.floor(w.start * FORGE_SAMPLE_RATE), Math.ceil(w.end * FORGE_SAMPLE_RATE)), FORGE_SAMPLE_RATE);
    expect(m.clippedRatio).toBe(0);
    expect(m.pitchHz).toBeGreaterThan(60);
    expect(m.pitchHz).toBeLessThan(250);
  });
});

describe('the library', () => {
  it('the real manifest: unique ids, pinned files, licences, attributions, words, honest pitch bands', () => {
    const ids = new Set();
    for (const v of listLibrary()) {
      const e = libraryEntry(v.id);
      expect(ids.has(e.id)).toBe(false);
      ids.add(e.id);
      expect(e.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(['CC0-1.0', 'CC-BY-4.0']).toContain(e.licence);
      expect(e.attribution.length).toBeGreaterThan(10);
      expect(e.source).toMatch(/^https:\/\/(huggingface\.co|raw\.githubusercontent\.com)\/.+\/[0-9a-f]{40}\//);
      expect(e.words.trim().length).toBeGreaterThan(10);
      expect(e.pitch).toBe(e.pitchHz >= 165 ? 'higher' : 'lower');
      expect(e.seconds).toBeGreaterThanOrEqual(3);
      expect(v.source).toBeUndefined();
      // The gallery's two filters read these; an accent is the source's or '' (unlisted).
      expect(['feminine', 'masculine']).toContain(v.register);
      expect(typeof v.accent).toBe('string');
    }
    expect(ids.size).toBeGreaterThanOrEqual(20);
    expect(listLibrary({ pitch: 'higher' }).every((v) => v.pitch === 'higher')).toBe(true);
    expect(listLibrary({ pitch: 'lower' }).length + listLibrary({ pitch: 'higher' }).length).toBe(ids.size);
  });

  describe('download on demand, sha256-checked (a real loopback source)', () => {
    let server;
    let base;
    let flac;
    let served = 0;
    let voiceRoot;

    beforeAll(async () => {
      flac = await asFormat('flac');
      voiceRoot = await createTempDir('forge-voice-root');
      server = http.createServer((req, res) => {
        served++;
        if (req.url === '/voice.flac') return res.end(flac);
        if (req.url === '/tampered.flac') return res.end(Buffer.concat([flac, Buffer.from('x')]));
        res.statusCode = 404;
        res.end();
      });
      await new Promise((r) => server.listen(0, '127.0.0.1', r));
      base = `http://127.0.0.1:${server.address().port}`;
    });
    afterAll(() => new Promise((r) => server.close(r)));

    const entryFor = (file) => ({
      id: 'test-lamp', source: `${base}/${file}`, format: 'flac',
      sha256: createHash('sha256').update(flac).digest('hex'), words: SPOKEN,
    });

    it('downloads once, then serves the cached, re-checked file', async () => {
      const first = await fetchLibraryClip(entryFor('voice.flac'), { root: voiceRoot });
      expect(first.equals(flac)).toBe(true);
      const before = served;
      const again = await fetchLibraryClip(entryFor('voice.flac'), { root: voiceRoot });
      expect(again.equals(flac)).toBe(true);
      expect(served).toBe(before);
      const cached = path.join(voiceRoot, 'library', `${entryFor('voice.flac').sha256}.flac`);
      expect((await fs.readFile(cached)).equals(flac)).toBe(true);
    });

    it('a file changed on disk is refused and fetched again from the source', async () => {
      const cached = path.join(voiceRoot, 'library', `${entryFor('voice.flac').sha256}.flac`);
      await fs.writeFile(cached, Buffer.from('swapped under us'));
      const before = served;
      const bytes = await fetchLibraryClip(entryFor('voice.flac'), { root: voiceRoot });
      expect(bytes.equals(flac)).toBe(true);
      expect(served).toBe(before + 1);
    });

    it('a source answering other bytes is refused and nothing is kept', async () => {
      const root = await createTempDir('forge-voice-root-tamper');
      await expect(fetchLibraryClip(entryFor('tampered.flac'), { root })).rejects.toThrow(/did not match its pinned sha256/);
      const kept = await fs.readdir(path.join(root, 'library')).catch(() => []);
      expect(kept).toEqual([]);
      await expect(fetchLibraryClip(entryFor('missing.flac'), { root })).rejects.toThrow(/answered 404/);
    });

    it('the library door: one take, the pinned words, a real person whose licence is the consent', async () => {
      const [take] = await findFromLibrary(entryFor('voice.flac'), { root: voiceRoot });
      expect(take.door).toBe('library');
      expect(take.origin).toEqual({ door: 'library', libraryId: 'test-lamp' });
      expect(take.words).toBe(SPOKEN);
      expect(take.realPerson).toBe(true);
      expect(take.attested).toBe(true);
      expect(take.sampleRate).toBe(24000);
      expect(take.measured.pitchHz).toBeGreaterThan(60);
      expect(take.measured.wordsPerSecond).toBeGreaterThan(1);
      expect(take.wav.toString('latin1', 0, 4)).toBe('RIFF');
    });
  });
});
