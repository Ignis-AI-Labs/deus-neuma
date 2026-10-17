/**
 * Audio-retention sweep (SPEECH SYSTEM threat-model control #5) — reusable by
 * every voice feature: operator voice PCM is biometric-class and must never
 * land on disk or in logs, and transcript content must never ride a log line.
 *
 * Two probes after a REAL voice sitting:
 *   1. findAudioArtifacts(root) — no audio-container files under the roots
 *      the sitting touched (workspaces, data dirs, temp fixture dirs).
 *   2. findLogLeaks(logText, forbiddenContent) — the backend log captured
 *      DURING the sitting carries no base64 PCM blobs (a 100 ms PCM chunk is
 *      ~4.3 KB of base64) and none of the sitting's spoken content.
 *
 * The log probe is pure; the disk probe's only impurity is the walk itself.
 */

import fs from 'fs/promises';
import path from 'path';

// Containers raw PCM or rendered speech could plausibly land in. Text-ish
// artifacts (.json, .md, .log) are the platform's own record — out of scope.
const AUDIO_EXTENSIONS = Object.freeze([
  '.pcm', '.raw', '.s16le', '.wav', '.mp3', '.ogg', '.opus', '.flac', '.m4a', '.aac',
]);

// A base64 run long enough to be audio, never a hash or token (sha256 base64
// is 43 chars; session tokens and ids are far shorter).
const BASE64_BLOB = /[A-Za-z0-9+/]{160,}={0,2}/;

// impure — recursive file walk; unreadable dirs are skipped, never fatal
const walkFiles = async (root, acc = []) => {
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) await walkFiles(full, acc);
    else if (entry.isFile()) acc.push(full);
  }
  return acc;
};

/**
 * impure — every audio-container file under root. Empty array means the
 * sitting left no voice data on disk.
 * @param {string} root
 * @returns {Promise<string[]>}
 */
export const findAudioArtifacts = async (root) =>
  (await walkFiles(root)).filter((f) => AUDIO_EXTENSIONS.includes(path.extname(f).toLowerCase()));

/**
 * pure — the retention leaks in one captured log text: 'base64' for a
 * PCM-class blob, `content:<needle>` for each forbidden utterance fragment
 * that appears. Empty array means the logs are clean.
 * @param {string} logText
 * @param {string[]} [forbiddenContent] - spoken fragments that must never be logged
 * @returns {string[]}
 */
export const findLogLeaks = (logText, forbiddenContent = []) => {
  const leaks = [];
  if (BASE64_BLOB.test(logText)) leaks.push('base64');
  for (const needle of forbiddenContent) {
    if (needle && logText.includes(needle)) leaks.push(`content:${needle.slice(0, 24)}`);
  }
  return leaks;
};
