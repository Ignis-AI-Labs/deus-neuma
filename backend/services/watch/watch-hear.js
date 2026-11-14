// watch-hear — what a recording says, part by part, with the second each sentence begins.
//
// The recording's own captions when it has them (read in an instant, in the words its maker or the
// site wrote). Otherwise the app's own speech recognition hears it on this computer: the installed
// app's whisper.cpp, dictation's own engine (set up on the spot when dictation never was: Founder,
// 2026-11-14, […]). In a checkout, the
// house's speech server when one is already running, else whisper.cpp on the PROCESSOR: watching
// never loads a speech model onto the graphics card by itself (2026-11-14, a probe of this did, beside
// the house's model). A recording is heard in five-minute pieces kept beside it, so a part asked for
// twice, or two parts that overlap, are heard once. impure (speech engines, fs)
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createLogger } from '../logger.js';
import { startSttJob, sttJob, sttReadiness, transcribeWav, usesManagedStt } from '../managed-stt.js';
import { transcribeRecording } from '../voice/whisper-transcribe.js';
import { resolveServe } from '../voice/engine-manager.js';
import { probeHealth } from '../voice/engine-process.js';
import { linesIn, paragraphs, parseCaptions } from './watch-plan.js';
import { pcmSlice, pcmWindow, wavOf } from './watch-media.js';

const log = createLogger('WatchHear');
/** One piece of a recording heard in one go. */
export const PIECE_S = 300;
// the house's speech server answers text without times, so it hears in half-minute steps
const SIDECAR_STEP_S = 30;
const SETUP_WAIT_MS = 20 * 60_000;

/**
 * Which speech recognition hears a recording here: the installed app's ('managed'), the house's
 * speech server already running in a checkout ('sidecar'), or whisper.cpp on the processor
 * ('processor'). impure (one loopback probe)
 */
const speechRoute = async () => {
  if (usesManagedStt()) return 'managed';
  const { host, port } = resolveServe('whisper');
  return (await probeHealth(host, port)).verdict === 'ready' ? 'sidecar' : 'processor';
};

// impure — whisper.cpp's speech recognition, set up first if it never was
const readySpeech = async (processor) => {
  if ((await sttReadiness()).ready) return;
  log.info('speech recognition is not set up: setting it up to hear a recording', { processor });
  startSttJob({ processor });
  const until = Date.now() + SETUP_WAIT_MS;
  while (Date.now() < until) {
    const job = sttJob();
    if (job.state === 'succeeded') return;
    if (job.state === 'failed') throw new Error(`speech recognition could not be set up: ${job.detail || job.error || 'the setup failed'}`);
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('speech recognition was still setting up after 20 minutes');
};

/**
 * One piece heard: lines with the second each begins, on the recording's clock. impure
 * @param {string} file
 * @param {number} from
 * @param {number} to
 * @returns {Promise<Array<{at: number, text: string}>>}
 */
const hearPiece = async (file, from, to) => {
  const pcm = await pcmWindow(file, from, to);
  if (pcm.length < 3200) return [];
  const route = await speechRoute();
  if (route !== 'sidecar') {
    const processor = route === 'processor';
    await readySpeech(processor);
    const heard = await transcribeWav(wavOf(pcm), { processor });
    if (heard.segments?.length) return heard.segments.map((s) => ({ at: from + s.start, text: s.text })).filter((l) => l.text);
    return heard.text ? [{ at: from, text: heard.text }] : [];
  }
  const lines = [];
  for (let t = from; t < to; t += SIDECAR_STEP_S) {
    const step = pcmSlice(pcm, from, t, Math.min(to, t + SIDECAR_STEP_S));
    if (step.length < 3200) continue;
    const { text } = await transcribeRecording(wavOf(step), 'audio/wav');
    if (text) lines.push({ at: t, text });
  }
  return lines;
};

/**
 * What the recording says inside [start, end), as timed paragraphs, and where the words came from.
 * Captions answer at once; otherwise each five-minute piece the part touches is heard (or read back
 * from beside the recording, when it was heard before). impure
 * @param {{dir: string, file: string|null, captions: string|null, duration: number|null}} entry
 * @param {number} start
 * @param {number} end
 * @returns {Promise<{lines: Array<{at: number, text: string}>, from: 'captions'|'heard'|'none', note?: string}>}
 */
export const heardIn = async (entry, start, end) => {
  if (entry.captions) {
    const lines = paragraphs(parseCaptions(await fsp.readFile(entry.captions, 'utf8')));
    return { lines: linesIn(lines, start, end), from: 'captions' };
  }
  if (!entry.file) return { lines: [], from: 'none', note: 'no captions, and the recording itself could not be fetched to hear it' };
  const heardDir = path.join(entry.dir, 'heard');
  await fsp.mkdir(heardDir, { recursive: true });
  const lines = [];
  const last = entry.duration ?? end;
  for (let p = Math.floor(start / PIECE_S); p * PIECE_S < Math.min(end, last); p += 1) {
    const from = p * PIECE_S;
    const to = Math.min((p + 1) * PIECE_S, last);
    const kept = path.join(heardDir, `${from}.json`);
    let piece;
    if (fs.existsSync(kept)) piece = JSON.parse(await fsp.readFile(kept, 'utf8'));
    else {
      piece = await hearPiece(entry.file, from, to);
      await fsp.writeFile(kept, JSON.stringify(piece));
    }
    lines.push(...piece);
  }
  return { lines: linesIn(paragraphs(lines), start, end), from: 'heard' };
};

/** Every piece heard so far, in order, for the transcript kept in the neuma's workspace. impure */
export const heardSoFar = async (entry) => {
  if (entry.captions) return paragraphs(parseCaptions(await fsp.readFile(entry.captions, 'utf8')));
  const heardDir = path.join(entry.dir, 'heard');
  let names = [];
  try { names = await fsp.readdir(heardDir); } catch { return []; }
  const pieces = await Promise.all(names.filter((n) => n.endsWith('.json')).sort((a, b) => parseFloat(a) - parseFloat(b))
    .map(async (n) => JSON.parse(await fsp.readFile(path.join(heardDir, n), 'utf8'))));
  return paragraphs(pieces.flat());
};
