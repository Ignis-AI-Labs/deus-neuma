#!/usr/bin/env node
// level.mjs — equal-loudness copies of every bake-off clip for the listening
// page. Peak normalising (what the runners do) leaves engines up to ~9 dB apart
// in how loud they sound; a louder voice wins votes it did not earn. This
// measures each clip's integrated loudness (EBU R128) and applies ONE linear
// gain to reach -18 LUFS: the performance's own dynamics (a whisper stays a
// whisper) are untouched, only the whole clip moves. A clip whose loud moment
// (a laugh, a gasp) would clip at that gain gets a fast limiter on those peaks
// only, so it still arrives at the same loudness as everyone else.
//
//   node scripts/voice-bakeoff/level.mjs [--samples <dir>] [--from out] [--to level]
// Mirrors <samples>/<from>/** into <samples>/<to>/** as .wav. Skips clips already leveled.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readdirSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { availableParallelism } from 'node:os';
import { arg } from './args.mjs';

const run = promisify(execFile);
const samples = resolve(arg('--samples', join(import.meta.dirname, '../../voice-engines/_samples/bakeoff-2026-09-30')));
const TARGET = -18;
const PEAK_CEILING = -1;

const loudnessOf = async (file) => {
  const { stderr } = await run('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-af', 'ebur128=peak=true', '-f', 'null', '-'], { maxBuffer: 1 << 26 });
  const summary = stderr.slice(stderr.lastIndexOf('Summary:'));
  const lufs = Number(summary.match(/I:\s+(-?[\d.]+) LUFS/)?.[1]);
  const peak = Number(summary.match(/Peak:\s+(-?[\d.]+) dBFS/)?.[1]);
  return { lufs, peak };
};

const level = async (src, dst) => {
  const { lufs, peak } = await loudnessOf(src);
  const gain = Number.isFinite(lufs) ? TARGET - lufs : 0;
  const limit = Number.isFinite(peak) && peak + gain > PEAK_CEILING ? `,alimiter=limit=${10 ** (PEAK_CEILING / 20)}:level=false` : '';
  await run('ffmpeg', ['-hide_banner', '-v', 'error', '-y', '-i', src, '-af', `volume=${gain.toFixed(2)}dB${limit}`, '-c:a', 'pcm_s16le', dst]);
  return gain;
};

// every audio file under <from>, mirrored into <to> as .wav (any depth)
const from = join(samples, arg('--from', 'out'));
const to = join(samples, arg('--to', 'level'));
const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
  d.isDirectory() ? walk(join(dir, d.name)) : /\.(wav|flac|mp3)$/.test(d.name) ? [join(dir, d.name)] : []);
const jobs = walk(from)
  .map((src) => ({ src, dst: join(to, relative(from, src)).replace(/\.(flac|mp3)$/, '.wav') }))
  .filter((j) => !existsSync(j.dst));
jobs.forEach((j) => mkdirSync(dirname(j.dst), { recursive: true }));

let done = 0;
const worker = async () => {
  for (let job = jobs.shift(); job; job = jobs.shift()) {
    await level(job.src, job.dst);
    if (++done % 100 === 0) console.log(`${done} leveled`);
  }
};
await Promise.all(Array.from({ length: Math.min(8, availableParallelism()) }, worker));
console.log(`${done} clips leveled to ${TARGET} LUFS → ${to}`);
