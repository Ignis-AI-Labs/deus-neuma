/**
 * Bake the ratified soundscape into a single committed sprite.
 *
 * Reads the licensed sample library through the local symlink at
 * frontend/assets/sounds (gitignored — never committed), concatenates every
 * manifest cue into ONE sprite file with silence gaps, and writes the result
 * to frontend/sounds-baked/ (tracked — ships with the branch).
 *
 * Output:
 *   sprite.opus  — lossy, preferred (only when ffmpeg present)
 *   sprite.wav   — lossless concat, always written
 *   sprite.json  — { [event]: { start, duration } } slice index
 *
 * The raw sample files never leave the operator's machine. What ships is a
 * derived sound-design artifact (one concatenated file + an offset index),
 * not a redistributable sample pack.
 *
 * impure throughout: reads files, spawns ffmpeg/ffprobe, writes files.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SOUND_MANIFEST } from '../frontend/services/sound-manifest.js';
import { buildPlan } from './lib/bake-plan.mjs';
import { concatWavs, parseWav, wavDuration } from './lib/wav-concat.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SOUNDS_ROOT = resolve(HERE, '../frontend/assets/sounds');
const OUT_DIR = resolve(HERE, '../frontend/sounds-baked');
const GAP = 0.15;
const TARGET_RATE = 48000;
const TARGET_CHANNELS = 2;
const TARGET_FMT = 's16';

// impure — runs a command synchronously, returns trimmed stdout or throws
const run = (cmd, args) => {
  const res = spawnSync(cmd, args, { encoding: 'utf8' });
  if (res.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')}\nfailed (${res.status}): ${res.stderr}`);
  }
  return (res.stdout || '').trim();
};

// impure — probe a cue's real duration in seconds via ffprobe
const probeDuration = (file) => Number(
  run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file])
);

const hasFfmpeg = () => {
  const res = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' });
  return res.status === 0;
};

const cueList = () => Object.keys(SOUND_MANIFEST).map(
  (event) => ({ event, file: SOUND_MANIFEST[event] })
);

const verifySources = (cues) => {
  const missing = cues.filter((c) => !existsSync(join(SOUNDS_ROOT, c.file)));
  if (missing.length) {
    throw new Error(
      `Missing source samples (is the Splice symlink present at ${SOUNDS_ROOT}?):\n` +
        missing.map((m) => `  ${m.event} -> ${m.file}`).join('\n')
    );
  }
};

// impure — ffmpeg path: normalize each source, concat with silence, encode opus
const bakeWithFfmpeg = (cues) => {
  const durations = cues.map((c) => probeDuration(join(SOUNDS_ROOT, c.file)));
  const plan = buildPlan(cues, durations, GAP);
  const tmp = mkdtempSync(join(tmpdir(), 'neuma-bake-'));

  try {
    const silencePath = join(tmp, 'silence.wav');
    run('ffmpeg', [
      '-y', '-v', 'error',
      '-f', 'lavfi', '-i', `anullsrc=r=${TARGET_RATE}:cl=stereo`,
      '-sample_fmt', TARGET_FMT, '-t', String(GAP), silencePath,
    ]);

    const listLines = [];
    cues.forEach((cue, i) => {
      const norm = join(tmp, `${i}.wav`);
      run('ffmpeg', [
        '-y', '-v', 'error', '-i', join(SOUNDS_ROOT, cue.file),
        '-ar', String(TARGET_RATE), '-ac', String(TARGET_CHANNELS),
        '-sample_fmt', TARGET_FMT, norm,
      ]);
      listLines.push(`file '${norm}'`, `file '${silencePath}'`);
    });

    const listPath = join(tmp, 'list.txt');
    writeFileSync(listPath, listLines.join('\n'));

    const wavPath = join(OUT_DIR, 'sprite.wav');
    const opusPath = join(OUT_DIR, 'sprite.opus');
    run('ffmpeg', ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', wavPath]);
    run('ffmpeg', ['-y', '-v', 'error', '-i', wavPath, '-c:a', 'libopus', '-b:a', '64k', '-vbr', 'on', opusPath]);

    writeManifest(plan, 'opus', 'wav');
    console.log(`bake: ffmpeg -> sprite.opus + sprite.wav (${cues.length} cues, ${plan.total.toFixed(2)}s)`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
};

// impure — pure-JS fallback: only correct for uniform-format sources
const bakeWithoutFfmpeg = (cues) => {
  const parsed = cues.map((c) => parseWav(readFileSync(join(SOUNDS_ROOT, c.file))));
  const durations = parsed.map(wavDuration);
  const plan = buildPlan(cues, durations, GAP);
  const wavBuf = concatWavs(parsed, GAP);
  writeFileSync(join(OUT_DIR, 'sprite.wav'), wavBuf);
  writeManifest(plan, 'wav', null);
  console.log(`bake: pure-js -> sprite.wav only (${cues.length} cues, ${plan.total.toFixed(2)}s)`);
  console.log('bake: NOTE opus skipped (no ffmpeg). Sources were uniform; mixed sources require ffmpeg.');
};

// impure — write the slice index consumed by the engine at runtime
const writeManifest = (plan, format, fallbackFormat) => {
  const manifest = {
    version: 1,
    gap: GAP,
    sampleRate: TARGET_RATE,
    channels: TARGET_CHANNELS,
    total: plan.total,
    format,
    fallbackFormat,
    events: plan.index,
  };
  writeFileSync(join(OUT_DIR, 'sprite.json'), `${JSON.stringify(manifest, null, 2)}\n`);
};

const main = () => {
  const cues = cueList();
  verifySources(cues);
  if (!existsSync(OUT_DIR)) {
    throw new Error(`Output dir missing: ${OUT_DIR}`);
  }
  if (hasFfmpeg()) bakeWithFfmpeg(cues);
  else bakeWithoutFfmpeg(cues);
};

main();
