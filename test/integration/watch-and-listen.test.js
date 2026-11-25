/* global process */
/**
 * A neuma watches and listens (Design note, 2026-11-14: […]).
 *
 * The REAL media tools (handleMediaTool → watch/watch.js) on a REAL lane over a REAL signed socket
 * (harness-turn-kit), with REAL recordings made here by the machine's own ffmpeg: a twelve-minute
 * video with captions beside it, watched in parts, its frames returned to the eye through the real
 * sight path (sightForResults); and, where the pinned whisper.cpp is on this rig, a recording with no
 * captions heard by the installed app's own speech engine. The guarded proxy the downloader goes
 * through is started for real and asked for this computer's own addresses. No network, no model:
 * fetching from a site is yt-dlp's, proven by a live run.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createHarnessTurnKit } from '../helpers/harness-turn-kit.js';
import { handleMediaTool } from '../../backend/services/media-being-tools.js';
import { sendToolEvent } from '../../backend/services/portal-tools/tool-events.js';
import { sightForResults } from '../../backend/services/image-forge/image-sight.js';
import { startWatchEgress } from '../../backend/services/watch/watch-egress.js';
import { STT_MODEL, WHISPER_CPP_BUILD, sttEngineFor } from '../../backend/services/managed-stt-plan.js';
import workspace from '../../core/workspace/neuma-workspace.js';

const SPEECH = path.resolve('test/fixtures/speech-16k.wav'); // "The Neuma speaks from the void. This voice is a preset, not a clone."
const PINS = `/mnt/data/neuma/stt-pin/${WHISPER_CPP_BUILD}`;
const engine = sttEngineFor('linux', 'x64');
const canHear = process.platform === 'linux' && process.arch === 'x64'
  && fs.existsSync(path.join(PINS, engine.name)) && fs.existsSync(path.join(PINS, STT_MODEL.name));

let kit;
let laneDir;
const call = (toolName, args) => handleMediaTool(kit.ws, kit.connection, null, 'auto',
  { tool: `media/${toolName}`, toolName, server: 'media' }, args, { sendToolEvent });

const CAPTIONS = `WEBVTT

00:00:01.000 --> 00:00:04.000
Rates rose for the third time this year.

00:00:05.000 --> 00:00:08.000
The committee voted seven to two.

00:10:30.000 --> 00:10:33.000
In closing, inflation is still above target.
`;

beforeAll(async () => {
  kit = await createHarnessTurnKit('watch-proof');
  laneDir = workspace.pathFor(kit.laneId);
  // twelve minutes of a moving test picture at one frame a second, silent sound, captions beside it
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=1', '-f', 'lavfi', '-i', 'anullsrc=r=16000:cl=mono',
    '-t', '720', '-c:v', 'mpeg4', '-q:v', '10', '-c:a', 'aac', path.join(laneDir, 'briefing.mkv')]);
  await fsp.writeFile(path.join(laneDir, 'briefing.vtt'), CAPTIONS);
}, 120_000);

afterAll(async () => {
  const { stopSttServer } = await import('../../backend/services/managed-stt.js');
  stopSttServer();
  await kit?.close();
});

describe('watching a video in parts', () => {
  test('the first part: the captions, timed; an overview of the whole video and frames of this part, in front of the eye; the transcript kept', async () => {
    const result = await call('media_watch', { source: 'briefing.mkv' });
    expect(result.status).toBe('ok');
    expect(result.content).toContain('WATCHING: briefing.mkv');
    expect(result.content).toContain('HEARD 0:00–10:00 (the recording\'s own captions):');
    expect(result.content).toContain('[0:01] Rates rose for the third time this year. The committee voted seven to two.');
    expect(result.content).not.toContain('In closing');
    expect(result.content).toMatch(/SEEN: sheet 1 \(the whole video\): 12 frames at 0:00, 1:00, .*; sheet 2: 9 frames at 0:00, 0:33,/);
    expect(result.content).toContain('NEXT: 2:00 remain — call again with from "10:00" for the next part.');
    expect(result.content).toMatch(/KEPT: the transcript heard so far is at watched\/\d{4}-\d{2}-\d{2}-briefing-mkv\.md/);

    // the sheets ride the real sight path back to the eye, with what they are
    expect(result.sight).toMatchObject({ laneId: kit.laneId, store: 'ephemeral', purpose: 'watch-frames' });
    expect(result.sight.imageIds).toHaveLength(3);
    const sight = sightForResults([result], { canSee: true });
    expect(sight.images).toHaveLength(3);
    expect(sight.images.every((uri) => uri.startsWith('data:image/jpeg;base64,/9j/'))).toBe(true);
    expect(sight.note).toContain('3 sheets of frames from the video you are watching are attached above');
    // a sheet is three frames across
    const sheet = Buffer.from(sight.images[1].split(',')[1], 'base64');
    const sheetPath = path.join(kit.root, 'sheet.jpg');
    await fsp.writeFile(sheetPath, sheet);
    const [w] = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=width', '-of', 'csv=p=0', sheetPath]).toString().trim().split(',').map(Number);
    expect(w).toBeGreaterThanOrEqual(3 * 426);

    // the transcript in the neuma's workspace holds every caption, the whole recording
    const kept = await fsp.readFile(path.join(laneDir, result.content.match(/(watched\/\S+\.md)/)[1]), 'utf8');
    expect(kept).toContain('## Transcript (the recording\'s own captions)');
    expect(kept).toContain('[10:30] In closing, inflation is still above target.');
    // the chip names it
    const chip = kit.frames.filter((f) => f.type === 'tool:usage' && f.tool === 'media/media_watch').at(-1);
    expect(chip.summary).toMatch(/^watched briefing\.mkv · 0:00–10:00 of 12:00 · captions · 30 frames$/);
  }, 120_000);

  test('the next part: from where the last ended, to the end, without the overview', async () => {
    const result = await call('media_watch', { source: 'briefing.mkv', from: '10:00' });
    expect(result.content).toContain('HEARD 10:00–12:00');
    expect(result.content).toContain('[10:30] In closing, inflation is still above target.');
    expect(result.content).toContain('END: that is the end of the recording.');
    expect(result.content).not.toContain('the whole video');
    expect(result.sight.imageIds).toHaveLength(2);
  }, 120_000);

  test('a source that is not there, or not a recording, answers why, never a silent nothing', async () => {
    const missing = await call('media_watch', { source: 'nowhere.mp4' });
    expect(missing).toMatchObject({ status: 'error', error: expect.stringContaining('there is no such file') });
    await fsp.writeFile(path.join(laneDir, 'notes.txt'), 'just words');
    const words = await call('media_listen', { source: 'notes.txt' });
    expect(words.status).toBe('error');
    expect(words.error).toMatch(/could not be read as video or audio|holds no video or sound|has no sound/);
    const local = await call('media_watch', { source: 'file:///etc/passwd' });
    expect(local.error).toContain('only an http or https link, or a file on this computer, can be watched');
  }, 60_000);
});

describe.skipIf(!canHear)('listening to a recording with no captions', () => {
  test('the installed app\'s own speech engine hears it, with the second each line begins', async () => {
    process.env.NEUMA_STT_ENGINE = 'managed';
    const stt = await import('../../backend/services/managed-stt.js');
    const { installArchive } = await import('../../backend/services/managed-ollama-download.js');
    const f = stt.sttFiles();
    const engineDir = path.dirname(path.dirname(f.bin));
    fs.mkdirSync(path.dirname(engineDir), { recursive: true });
    const archive = path.join(path.dirname(engineDir), engine.name);
    fs.copyFileSync(path.join(PINS, engine.name), archive); // installArchive removes what it unpacks: a copy
    await installArchive(engine, archive, engineDir);
    fs.mkdirSync(path.dirname(f.modelPath), { recursive: true });
    fs.copyFileSync(path.join(PINS, STT_MODEL.name), f.modelPath);
    // a voice note: three seconds of quiet, then the sentence
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'anullsrc=r=16000:cl=mono', '-i', SPEECH,
      '-filter_complex', '[0]atrim=0:3[q];[q][1]concat=n=2:v=0:a=1', '-c:a', 'libopus', path.join(laneDir, 'voice-note.ogg')]);
    try {
      const result = await call('media_listen', { source: 'voice-note.ogg' });
      expect(result.status).toBe('ok');
      expect(result.content).toContain('LISTENING TO: voice-note.ogg');
      expect(result.content).toContain('(heard on this computer)');
      expect(result.content).toMatch(/\[0:0\d\] .*speaks from the void/i);
      expect(result.content).toContain('END: that is the end of the recording.');
      expect(result.sight).toBeUndefined();
    } finally {
      delete process.env.NEUMA_STT_ENGINE;
    }
  }, 180_000);
});

describe('the door the downloader goes through', () => {
  test('refuses this computer and its network, tunnel or plain, and names what it refused', async () => {
    const local = net.createServer((s) => s.end('secret')).listen(0, '127.0.0.1');
    await new Promise((r) => local.once('listening', r));
    const egress = await startWatchEgress();
    const { port } = new URL(egress.url);
    const ask = (raw) => new Promise((resolve) => {
      const s = net.connect(Number(port), '127.0.0.1', () => s.write(raw));
      let got = '';
      s.on('data', (c) => { got += c; });
      s.on('close', () => resolve(got));
    });
    try {
      const tunnel = await ask(`CONNECT 127.0.0.1:${local.address().port} HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n`);
      expect(tunnel).toMatch(/^HTTP\/1\.1 403 refused by the platform/);
      expect(tunnel).not.toContain('secret');
      expect(await ask('CONNECT 10.0.0.1:443 HTTP/1.1\r\n\r\n')).toMatch(/^HTTP\/1\.1 403/);
      expect(await ask('CONNECT localhost:443 HTTP/1.1\r\n\r\n')).toMatch(/^HTTP\/1\.1 403/);
      const plain = await ask(`GET http://192.168.1.1/admin HTTP/1.1\r\nHost: 192.168.1.1\r\nConnection: close\r\n\r\n`);
      expect(plain).toMatch(/^HTTP\/1\.1 403 refused by the platform/);
      expect(egress.refused).toHaveLength(4);
    } finally {
      await egress.close();
      local.close();
    }
  });
});
