/**
 * VIDEO SIGHT — a being looks at the clip it made: frames sampled across it, in
 * order, and the words its soundtrack actually speaks.
 *
 * The bar for a clip is two things: adherence to the direction and the prompt,
 * and frames that work together cohesively. A vision substrate cannot take a video, so the clip is shown the way the KSP
 * view is (ephemeral-sight.js): bounded, one-use frames that never land in the
 * being's art, plus a transcript of the audio — what was ASKED to be said can
 * only be checked against what was HEARD. A failure here never fails the
 * render: no frames and no words are said out loud instead.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { registerEphemeralSight } from './ephemeral-sight.js';
import { transcribeRecording } from '../voice/whisper-transcribe.js';
import { createLogger } from '../logger.js';
import { probeEnvironment } from '../agent-terminal-environment.js';

// a media probe starts from the probe environment, never the backend's secrets (re-audit 2026-10-29, NEW-L1)
const execFileP = promisify(execFile);
const run = (bin, args, opts = {}) => execFileP(bin, args, { ...opts, env: probeEnvironment() });
const log = createLogger('ImageForge.VideoSight');
const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const FFPROBE = process.env.FFPROBE_PATH || 'ffprobe';
// The most images one message carries (attachment-store MAX_IMAGES_PER_MESSAGE): first, a third, two thirds, last.
const FRAME_COUNT = 4;
const FRAME_WIDTH = 640;

/**
 * Evenly spaced sample times across a clip, first frame to just before the
 * end (a timestamp AT the end decodes nothing). Pure.
 * @param {number} durationS
 * @param {number} [n]
 * @returns {number[]} seconds, ascending, rounded to 0.01
 */
export const frameTimes = (durationS, n = FRAME_COUNT) => {
  if (!Number.isFinite(durationS) || durationS <= 0 || n < 1) return [];
  const last = Math.max(0, durationS - 0.1);
  return Array.from({ length: n }, (_, i) => Math.round((n === 1 ? 0 : (last * i) / (n - 1)) * 100) / 100);
};

// impure — the clip's length in seconds, or null
const durationOf = async (videoPath) => {
  const { stdout } = await run(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', videoPath]);
  const s = Number(stdout.trim());
  return Number.isFinite(s) ? s : null;
};

// impure — one frame at `t` as a JPEG
const frameAt = async (videoPath, t) => {
  const { stdout } = await run(FFMPEG, ['-v', 'error', '-ss', String(t), '-i', videoPath, '-frames:v', '1',
    '-vf', `scale=${FRAME_WIDTH}:-2`, '-f', 'image2pipe', '-vcodec', 'mjpeg', '-q:v', '4', '-'], { encoding: 'buffer', maxBuffer: 8 * 1024 * 1024 });
  return stdout;
};

// impure — the soundtrack as 16 kHz mono WAV, transcribed by the house's mounted speech engine
const heardIn = async (videoPath) => {
  const { stdout } = await run(FFMPEG, ['-v', 'error', '-i', videoPath, '-vn', '-ac', '1', '-ar', '16000', '-f', 'wav', '-'],
    { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 });
  return (await transcribeRecording(stdout, 'audio/wav')).text;
};

/**
 * Sample the clip for the being's eyes and ears. Impure. Never throws.
 * @param {string} laneId
 * @param {string} videoPath
 * @returns {Promise<{imageIds: string[], times: number[], heard: string|null}>}
 */
export const videoSight = async (laneId, videoPath) => {
  let imageIds = [];
  let times;
  try {
    times = frameTimes(await durationOf(videoPath));
    const frames = [];
    for (const t of times) frames.push({ mime: 'image/jpeg', bytes: await frameAt(videoPath, t) });
    imageIds = [...registerEphemeralSight(laneId, frames.filter((f) => f.bytes.length > 0))];
  } catch (err) {
    log.warn('the clip could not be sampled for sight', { err: err.message });
    times = [];
  }
  let heard = null;
  try {
    heard = await heardIn(videoPath);
  } catch (err) {
    log.warn('the clip\'s soundtrack could not be transcribed', { err: err.message });
  }
  return { imageIds, times: imageIds.length === times.length ? times : [], heard };
};
