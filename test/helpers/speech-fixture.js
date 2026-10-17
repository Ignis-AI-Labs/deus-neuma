/**
 * Real speech fixtures for the STT tests — espeak-ng renders a sentence, ffmpeg
 * resamples it to the 16 kHz s16le mono PCM the whisper /stream lane eats.
 *
 * RAM law (Design note, 2026-10-01, after the crash): /tmp is tmpfs here, so audio
 * fixtures live in a work dir ON DISK (data/temp, gitignored) that the caller
 * removes in afterAll; every generator has an explicit duration and a timeout.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const run = promisify(execFile);
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const GENERATOR_TIMEOUT_MS = 30_000;

/**
 * impure — a fresh work dir on disk under data/temp; the caller owns its removal.
 * @param {string} label
 * @returns {Promise<string>}
 */
export const makeDiskWorkDir = async (label) => {
  const parent = path.join(REPO_ROOT, 'data', 'temp');
  await fs.mkdir(parent, { recursive: true });
  return fs.mkdtemp(path.join(parent, `${label}-`));
};

/**
 * impure — render `text` to a WAV (espeak-ng) and to 16 kHz s16le mono PCM (ffmpeg, bounded
 * to 30 s), both inside `dir`. Resolves the PCM bytes; `name.wav` stays for callers that
 * need a container (POST /transcribe).
 * @param {string} text
 * @param {string} dir
 * @param {string} name
 * @returns {Promise<Buffer>}
 */
export const renderSpeechPcm = async (text, dir, name) => {
  const wav = path.join(dir, `${name}.wav`);
  const pcm = path.join(dir, `${name}.pcm`);
  await run('espeak-ng', ['-w', wav, '-s', '150', text], { timeout: GENERATOR_TIMEOUT_MS });
  await run('ffmpeg', [
    '-y', '-loglevel', 'error', '-t', '30', '-i', wav, '-t', '30',
    '-f', 's16le', '-acodec', 'pcm_s16le', '-ar', '16000', '-ac', '1', pcm,
  ], { timeout: GENERATOR_TIMEOUT_MS });
  return fs.readFile(pcm);
};
