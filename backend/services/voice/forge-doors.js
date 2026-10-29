// THE FORGE DOORS — four ways in, one result: a clip and its words, measured.
//
//   record / upload  any audio → ffmpeg → 24 kHz mono → the best 10–30 s of
//                    continuous speech → WAV → words from whisper
//   library          a curated clip (voice-library.js), words pinned in the
//                    manifest, downloaded on demand and sha256-checked
//   describe         words → the designer sidecar (VoxCPM2) → three takes
//
// Every take is measured from its own samples — length, signal-to-noise,
// clipping, median pitch, pace — and given a plain verdict the guardian reads
// (too_short · clipped · noisy · good). The pitch and pace are also what the
// being reads about the voice (perceptionOf in core/voice/voice-consent.js):
// measured here, never guessed.
//
// The analysis is pure JS over 16-bit PCM; only decoding (ffmpeg), the words
// (whisper) and the design (the designer sidecar) leave this process.

import { execFile } from 'child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { promisify } from 'util';
import { clipRefOf } from '../../../core/voice/voice-dna-schema.js';
import { ensureReady, resolveServe } from './engine-manager.js';
import { fetchLibraryClip } from './voice-library.js';
import { pitchTrack, soundProfileOf } from './sound-profile.js';
import { sidecarFetch } from './sidecar-trust.js';

const run = promisify(execFile);

export const FORGE_SAMPLE_RATE = 24000;
// Record/upload aim for 10–30 s of speech: enough voice for csm to clone well,
// short enough to leave its 2048-position window room for the conversation.
export const TARGET_MIN_SECONDS = 10;
export const TARGET_MAX_SECONDS = 30;

const FRAME_SECONDS = 0.02;
const SILENCE_DB = -100;
const FLAT_SPEECH_DB = -50;
// Full scale is 32767; a sample this close to it is the converter's rail.
const CLIP_LEVEL = 32700;
// Plain-verdict bounds. More than 0.1 % of samples on the rail is audible
// distortion; under 20 dB between the voice and the room, the room clones too.
const CLIPPED_RATIO_MAX = 0.001;
const SNR_MIN_DB = 20;

// ─── Pure analysis ──────────────────────────────────────────────────────────

/** pure — 16-bit little-endian PCM bytes as samples (a trailing odd byte is dropped). */
export const samplesOf = (pcmBytes) => {
  const even = pcmBytes.length - (pcmBytes.length % 2);
  const out = new Int16Array(even / 2);
  for (let i = 0; i < out.length; i++) out[i] = pcmBytes.readInt16LE(i * 2);
  return out;
};

/** pure — mono 16-bit samples as a WAV file. */
export const wavOf = (samples, sampleRate) => {
  const data = samples.length * 2;
  const buf = Buffer.alloc(44 + data);
  buf.write('RIFF', 0, 'latin1');
  buf.writeUInt32LE(36 + data, 4);
  buf.write('WAVEfmt ', 8, 'latin1');
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36, 'latin1');
  buf.writeUInt32LE(data, 40);
  for (let i = 0; i < samples.length; i++) buf.writeInt16LE(samples[i], 44 + i * 2);
  return buf;
};

/** pure — the level of each 20 ms frame, in dBFS. */
export const frameLevels = (samples, sampleRate) => {
  const size = Math.round(sampleRate * FRAME_SECONDS);
  const levels = [];
  for (let start = 0; start + size <= samples.length; start += size) {
    let sum = 0;
    for (let i = start; i < start + size; i++) sum += samples[i] * samples[i];
    const rms = Math.sqrt(sum / size) / 32768;
    levels.push(rms > 0 ? Math.max(SILENCE_DB, 20 * Math.log10(rms)) : SILENCE_DB);
  }
  return levels;
};

const percentile = (values, p) => {
  if (!values.length) return SILENCE_DB;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
};

/**
 * Which frames carry speech. Speech sits within ~25 dB of the loud frames;
 * pauses fall below that, and never count when barely above the room. Pure.
 * @param {number[]} levels - frameLevels
 * @returns {{speech: boolean[], noiseDb: number, voiceDb: number}}
 */
export const speechFrames = (levels) => {
  const noiseDb = percentile(levels, 0.1);
  const voiceDb = percentile(levels, 0.9);
  // A clip with no quiet frames at all (a voice that never pauses, a designed
  // clip trimmed tight) has no room to measure against: then any frame above
  // a plain -50 dBFS floor is voice.
  const threshold = voiceDb - noiseDb >= 6 ? Math.max(voiceDb - 25, noiseDb + 6) : FLAT_SPEECH_DB;
  return { speech: levels.map((l) => l > threshold && l > SILENCE_DB), noiseDb, voiceDb };
};

// pure — runs of speech frames as phrases {start, end} in seconds, joined
// across pauses shorter than `pauseSeconds`.
const phrasesOf = (speech, pauseSeconds) => {
  const phrases = [];
  speech.forEach((on, i) => {
    if (!on) return;
    const t = i * FRAME_SECONDS;
    const last = phrases[phrases.length - 1];
    if (last && t - last.end <= pauseSeconds) last.end = t + FRAME_SECONDS;
    else phrases.push({ start: t, end: t + FRAME_SECONDS });
  });
  return phrases;
};

/**
 * The best stretch of continuous speech: the run of phrases (no silence over
 * `gapSeconds` between them) holding the most speech within `maxSeconds`,
 * padded a little at both ends. A single phrase longer than the cap is cut at
 * it. Null when there is no speech at all. Pure.
 * @param {boolean[]} speech - speechFrames(...).speech
 * @param {{maxSeconds?: number, gapSeconds?: number, padSeconds?: number}} [opts]
 * @returns {{start: number, end: number}|null} seconds
 */
export const bestSpeechWindow = (speech, { maxSeconds = TARGET_MAX_SECONDS, gapSeconds = 1.5, padSeconds = 0.15 } = {}) => {
  const phrases = phrasesOf(speech, 0.3);
  if (!phrases.length) return null;
  const total = speech.length * FRAME_SECONDS;
  let best = null;
  for (let i = 0; i < phrases.length; i++) {
    let spoken = 0;
    for (let j = i; j < phrases.length; j++) {
      if (j > i && phrases[j].start - phrases[j - 1].end > gapSeconds) break;
      const end = Math.min(phrases[j].end, phrases[i].start + maxSeconds);
      spoken += Math.max(0, end - phrases[j].start);
      if (!best || spoken > best.spoken + 1e-9) best = { start: phrases[i].start, end, spoken };
      if (phrases[j].end >= phrases[i].start + maxSeconds) break;
    }
  }
  return {
    start: Math.max(0, best.start - padSeconds),
    end: Math.min(total, best.end + padSeconds, best.start + maxSeconds),
  };
};

/**
 * Median pitch of the voiced frames (sound-profile.js's YIN track, 60–400 Hz).
 * Null when too few frames are voiced to say. Pure.
 * @param {Int16Array} samples
 * @param {number} sampleRate
 * @param {boolean[]} speech - which 20 ms frames carry speech
 */
export const medianPitchHz = (samples, sampleRate, speech) => {
  const found = pitchTrack(samples, sampleRate, speech).map((p) => p.hz);
  return found.length >= 10 ? Math.round(percentile(found, 0.5) * 10) / 10 : null;
};

/**
 * Everything the forge measures about a clip. Pure.
 * @param {Int16Array} samples
 * @param {number} sampleRate
 */
export const measureClip = (samples, sampleRate) => {
  const levels = frameLevels(samples, sampleRate);
  const { speech, noiseDb, voiceDb } = speechFrames(levels);
  let railed = 0;
  for (let i = 0; i < samples.length; i++) if (Math.abs(samples[i]) >= CLIP_LEVEL) railed++;
  return Object.freeze({
    seconds: Math.round((samples.length / sampleRate) * 100) / 100,
    speechSeconds: Math.round(speech.filter(Boolean).length * FRAME_SECONDS * 100) / 100,
    snrDb: Math.round((voiceDb - noiseDb) * 10) / 10,
    clippedRatio: samples.length ? Math.round((railed / samples.length) * 1e5) / 1e5 : 0,
    pitchHz: medianPitchHz(samples, sampleRate, speech),
    // What it sounds like, measured (Design note, 2026-10-02: the being must get the sound, not the words).
    profile: soundProfileOf(samples, sampleRate, { speech, levels }),
  });
};

/**
 * The plain verdict on a measured clip, worst problem first. Pure.
 * @param {{seconds: number, snrDb: number, clippedRatio: number}} m
 * @param {{minSeconds?: number}} [opts]
 * @returns {'too_short'|'clipped'|'noisy'|'good'}
 */
export const verdictOf = (m, { minSeconds = TARGET_MIN_SECONDS } = {}) => {
  if (m.seconds < minSeconds) return 'too_short';
  if (m.clippedRatio > CLIPPED_RATIO_MAX) return 'clipped';
  if (m.snrDb < SNR_MIN_DB) return 'noisy';
  return 'good';
};

/** pure — words per second over the clip, or null with no words. */
export const wordsPerSecondOf = (words, seconds) => {
  const count = (String(words ?? '').match(/\S+/g) ?? []).length;
  return count && seconds > 0 ? Math.round((count / seconds) * 100) / 100 : null;
};

/**
 * A take: the clip as WAV, its ref, its words, what was measured and the
 * verdict. Pure.
 * @param {{samples: Int16Array, words: string, origin: object, realPerson: boolean|null, minSeconds?: number}} p
 */
export const makeTake = ({ samples, words, origin, realPerson, minSeconds }) => {
  const wav = wavOf(samples, FORGE_SAMPLE_RATE);
  const m = measureClip(samples, FORGE_SAMPLE_RATE);
  return Object.freeze({
    ref: clipRefOf(wav),
    door: origin.door,
    seconds: m.seconds,
    sampleRate: FORGE_SAMPLE_RATE,
    words,
    origin: Object.freeze({ ...origin }),
    realPerson,
    measured: Object.freeze({ pitchHz: m.pitchHz, wordsPerSecond: wordsPerSecondOf(words, m.seconds), profile: m.profile }),
    quality: Object.freeze({
      verdict: verdictOf(m, { minSeconds }),
      speechSeconds: m.speechSeconds,
      snrDb: m.snrDb,
      clippedRatio: m.clippedRatio,
    }),
    wav,
  });
};

// ─── IO ─────────────────────────────────────────────────────────────────────

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
// An upload is trimmed to its best 30 s; ten minutes is the most of it read.
const DECODE_MAX_SECONDS = 600;

/**
 * Any audio ffmpeg reads → 24 kHz mono 16-bit samples. A temp file, not a
 * pipe: containers with their index at the end (m4a, some webm) cannot be
 * read from a stream. `tmpRoot` puts that file on disk where a caller holds
 * one (default the OS temp dir). impure
 * @param {Buffer} bytes
 * @param {{tmpRoot?: string}} [opts]
 * @returns {Promise<Int16Array>}
 */
export const decodeAudio = async (bytes, { tmpRoot = os.tmpdir() } = {}) => {
  await mkdir(tmpRoot, { recursive: true });
  const dir = await mkdtemp(path.join(tmpRoot, 'neuma-forge-'));
  try {
    const input = path.join(dir, 'in');
    await writeFile(input, bytes);
    const { stdout } = await run(FFMPEG, [
      '-hide_banner', '-loglevel', 'error', '-nostdin', '-i', input, '-t', String(DECODE_MAX_SECONDS),
      '-ac', '1', '-ar', String(FORGE_SAMPLE_RATE), '-f', 's16le', '-acodec', 'pcm_s16le', 'pipe:1',
    ], { encoding: 'buffer', maxBuffer: DECODE_MAX_SECONDS * FORGE_SAMPLE_RATE * 2 + 1024 });
    if (!stdout.length) throw new Error('the audio held no samples');
    return samplesOf(stdout);
  } catch (err) {
    const why = err.stderr?.toString().trim().split('\n').pop() || err.message;
    throw Object.assign(new Error(`could not read that audio: ${why}`), { status: 400 });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};

// impure — a sidecar ready to serve, or an error the route answers as 503.
const ready = (engineId) => ensureReady(engineId).catch((err) => {
  throw Object.assign(new Error(`the ${engineId} engine is not available: ${err.message}`), { status: 503 });
});

// impure — POST a sidecar endpoint on its loopback serve address.
const postSidecar = async (engineId, route, init, timeoutMs) => {
  const { host, port } = resolveServe(engineId);
  const res = await sidecarFetch(`http://${host}:${port}${route}`, { method: 'POST', ...init, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    let detail = body.slice(0, 200);
    try { detail = String(JSON.parse(body).detail ?? detail).slice(0, 200); } catch { /* keep the raw slice */ }
    throw Object.assign(new Error(`${engineId} ${route} failed (${res.status}): ${detail}`), { status: res.status === 400 ? 400 : 502 });
  }
  return res;
};

/**
 * The words spoken in a clip, from the whisper sidecar (launched on demand).
 * impure
 * @param {Buffer} wav
 */
export const transcribeClip = async (wav) => {
  await ready('whisper');
  const res = await postSidecar('whisper', '/transcribe', { headers: { 'Content-Type': 'audio/wav' }, body: wav }, 180_000);
  return String((await res.json()).text ?? '').trim();
};

/**
 * Record / upload: the best 10–30 s of the speech, transcribed. `realPerson`
 * is what the guardian stated (a recording is always a real person). impure
 * @param {Buffer} bytes - any audio
 * @param {{door: 'record'|'upload', realPerson: boolean|null}} p
 */
export const findFromAudio = async (bytes, { door, realPerson }) => {
  const samples = await decodeAudio(bytes);
  const window = bestSpeechWindow(speechFrames(frameLevels(samples, FORGE_SAMPLE_RATE)).speech);
  if (!window) throw Object.assign(new Error('no speech was heard in that audio'), { status: 422 });
  const clip = samples.subarray(Math.floor(window.start * FORGE_SAMPLE_RATE), Math.ceil(window.end * FORGE_SAMPLE_RATE));
  const words = await transcribeClip(wavOf(clip, FORGE_SAMPLE_RATE));
  if (!words) throw Object.assign(new Error('no words were heard in that audio'), { status: 422 });
  return [makeTake({ samples: clip, words, origin: { door }, realPerson })];
};

// A library clip is a curated whole (some are 6–10 s), so the bar for "too
// short" is the clip floor of Voice DNA itself, not the record target.
const LIBRARY_MIN_SECONDS = 3;

/**
 * Library: the curated clip, words from its manifest entry. Every library
 * voice is a real person who released it under its licence (CC0 / CC BY) —
 * the licence is the consent, so it is attested by the entry itself. impure
 * @param {object} entry - a voice-library entry
 * @param {{root?: string}} [opts]
 */
export const findFromLibrary = async (entry, opts = {}) => {
  const samples = await decodeAudio(await fetchLibraryClip(entry, opts));
  return [Object.freeze({
    ...makeTake({ samples, words: entry.words, origin: { door: 'library', libraryId: entry.id }, realPerson: true, minSeconds: LIBRARY_MIN_SECONDS }),
    attested: true,
  })];
};

const DESIGNER = 'designer';
export const DESIGN_TAKES = 3;
const DESIGN_TIMEOUT_MS = 120_000;

/**
 * One designed clip from a running designer sidecar: its WAV, its words and
 * the seed that made it. impure
 * @param {{description: string, seed: number}} p
 */
export const designClip = async ({ description, seed }) => {
  const res = await postSidecar(DESIGNER, '/design', {
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ description, seed }),
  }, DESIGN_TIMEOUT_MS);
  const out = await res.json();
  if (typeof out?.wav_b64 !== 'string' || typeof out?.words !== 'string') {
    throw Object.assign(new Error('the designer answered without a clip and its words'), { status: 502 });
  }
  return { wav: Buffer.from(out.wav_b64, 'base64'), words: out.words, seed: out.seed, model: out.model };
};

/**
 * Describe: words → three designed takes (consecutive seeds), launching the
 * designer on demand. Nobody's real voice. impure
 * @param {{description: string, seed: number}} p
 */
export const findFromDescription = async ({ description, seed }) => {
  await ready(DESIGNER);
  const takes = [];
  for (let i = 0; i < DESIGN_TAKES; i++) {
    const made = await designClip({ description, seed: seed + i });
    takes.push(makeTake({
      samples: await decodeAudio(made.wav),
      words: made.words,
      origin: { door: 'describe', description, designer: { model: made.model, seed: made.seed } },
      realPerson: false,
      minSeconds: LIBRARY_MIN_SECONDS,
    }));
  }
  return takes;
};
