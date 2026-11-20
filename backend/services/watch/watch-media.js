// watch-media — what ffmpeg reads out of a recording for a neuma: how long it is and what it holds,
// the sound of one part as speech recognition takes it, and frames from across a part laid out on
// sheets the neuma looks at. The frames are taken one at a time at their moments (a seek, never a
// decode of the whole video), so a three-hour video costs what a three-minute one does. impure
// (child processes, a scratch folder)
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ensureFfmpeg, runTool, toolEnvironment } from './watch-tools.js';
import { momentsIn } from './watch-plan.js';

/** 16 kHz, mono, 16-bit: what speech recognition reads. */
export const PCM_RATE = 16_000;
const PCM_BYTES_PER_S = PCM_RATE * 2;

/**
 * A recording's length and what it holds. A still picture riding an audio file (cover art) is not
 * a video, and neither is a text file. impure
 * @param {string} file
 * @returns {Promise<{duration: number|null, hasVideo: boolean, hasAudio: boolean}>}
 */
export const probeMedia = async (file) => {
  const { ffprobe } = await ensureFfmpeg();
  const r = await runTool(ffprobe, ['-v', 'error', '-show_entries', 'format=duration,format_name:stream=codec_type:stream_disposition=attached_pic', '-of', 'json', file], { timeoutMs: 60_000 });
  if (!r.ok) throw new Error(`the file could not be read as video or audio (${r.stderr.trim().split('\n').pop() || 'ffprobe failed'})`);
  const info = JSON.parse(r.stdout || '{}');
  // ffmpeg reads a plain text file as a "video" of its characters (the tty format): words are not a recording
  const streams = info.format?.format_name === 'tty' ? [] : (info.streams || []);
  const duration = Number(info.format?.duration);
  return {
    duration: Number.isFinite(duration) && duration > 0 ? duration : null,
    hasVideo: streams.some((s) => s.codec_type === 'video' && !s.disposition?.attached_pic),
    hasAudio: streams.some((s) => s.codec_type === 'audio'),
  };
};

// impure — a tool's stdout as bytes, bounded
const runBytes = (bin, args, maxBytes) => new Promise((resolve, reject) => {
  const child = spawn(bin, args, { env: toolEnvironment(), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const chunks = [];
  let size = 0;
  let err = '';
  child.stdout.on('data', (c) => {
    size += c.length;
    if (size > maxBytes) { child.kill(); return; }
    chunks.push(c);
  });
  child.stderr.on('data', (c) => { err = `${err}${c}`.slice(-2000); });
  child.once('error', reject);
  child.once('close', (code) => (code === 0 || size > maxBytes ? resolve(Buffer.concat(chunks)) : reject(new Error(err.trim().split('\n').pop() || `ffmpeg exit ${code}`))));
});

/**
 * The sound of [start, end) as raw 16 kHz mono 16-bit samples. impure
 * @returns {Promise<Buffer>}
 */
export const pcmWindow = async (file, start, end) => {
  const { ffmpeg } = await ensureFfmpeg();
  const len = Math.max(0.1, end - start);
  return runBytes(ffmpeg, ['-v', 'error', '-ss', String(start), '-t', String(len), '-i', file, '-vn', '-ac', '1', '-ar', String(PCM_RATE), '-f', 's16le', '-'],
    Math.ceil(len * PCM_BYTES_PER_S) + 1024 * 1024);
};

/** Raw samples wrapped as a WAV file. Pure. */
export const wavOf = (pcm) => {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + pcm.length, 4); header.write('WAVE', 8);
  header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(PCM_RATE, 24); header.writeUInt32LE(PCM_BYTES_PER_S, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
};

/** The samples between two seconds of a raw window that began at `origin`. Pure. */
export const pcmSlice = (pcm, origin, from, to) => {
  const at = (s) => Math.min(pcm.length, Math.max(0, Math.floor((s - origin) * PCM_RATE) * 2));
  return pcm.subarray(at(from), at(to));
};

// impure — one frame at `t`, fitted inside a width x width box (a tall video stays tall), as a JPEG file
const frameTo = async (ffmpeg, file, t, width, out) => {
  const r = await runTool(ffmpeg, ['-v', 'error', '-y', '-ss', String(t), '-i', file, '-frames:v', '1',
    '-vf', `scale=${width}:${width}:force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2`, '-q:v', '4', out], { timeoutMs: 60_000 });
  try { return r.ok && (await fsp.stat(out)).size > 0; } catch { return false; }
};

/**
 * Frames from across [start, end) on sheets: each sheet `across` x `down` frames, read left to right,
 * top to bottom. Frames that cannot be decoded (past the end, a damaged stretch) are left out and
 * their moments with them. impure
 * @param {string} file
 * @param {{start: number, end: number, sheets: number, across: number, down: number, width: number, scratch: string}} ask
 * @returns {Promise<Array<{bytes: Buffer, moments: number[]}>>}
 */
export const frameSheets = async (file, { start, end, sheets, across, down, width, scratch }) => {
  const { ffmpeg } = await ensureFfmpeg();
  const moments = momentsIn(start, end, sheets * across * down);
  await fsp.mkdir(scratch, { recursive: true });
  const taken = [];
  for (let i = 0; i < moments.length; i += 4) {
    const batch = moments.slice(i, i + 4).map((t, j) => ({ t, out: path.join(scratch, `m-${i + j}.jpg`) }));
    const ok = await Promise.all(batch.map((m) => frameTo(ffmpeg, file, m.t, width, m.out)));
    batch.forEach((m, j) => { if (ok[j]) taken.push(m); });
  }
  const per = across * down;
  const out = [];
  for (let s = 0; s * per < taken.length; s += 1) {
    const group = taken.slice(s * per, (s + 1) * per);
    const dir = path.join(scratch, `sheet-${s}`);
    await fsp.mkdir(dir, { recursive: true });
    await Promise.all(group.map((m, k) => fsp.rename(m.out, path.join(dir, `f-${String(k).padStart(2, '0')}.jpg`))));
    const rows = Math.ceil(group.length / across);
    const cols = Math.min(across, group.length);
    const sheet = path.join(scratch, `sheet-${s}.jpg`);
    const r = await runTool(ffmpeg, ['-v', 'error', '-y', '-framerate', '1', '-i', path.join(dir, 'f-%02d.jpg'),
      '-vf', `tile=${cols}x${rows}:padding=4:color=black`, '-frames:v', '1', '-q:v', '4', sheet], { timeoutMs: 60_000 });
    if (r.ok) out.push({ bytes: await fsp.readFile(sheet), moments: group.map((m) => m.t) });
  }
  await fsp.rm(scratch, { recursive: true, force: true });
  return out;
};
