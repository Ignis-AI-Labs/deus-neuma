// whisper-transcribe — a whole recording to words, on the local whisper sidecar.
//
// For recordings that are kept, not held: a dream runs minutes, where a
// dictation hold runs seconds. The sidecar is the same one dictation uses
// (stt-routes.js), launched on first use and waited for if a launch is
// already in flight — engine-manager throws on a second concurrent launch.
// impure throughout (engine lifecycle, loopback HTTP).
import { hotwordsPhrase } from '../../../core/text/lexicon.js';
import { launch, getStatus, ENGINE_STATES, resolveServe } from './engine-manager.js';

const ENGINE = 'whisper';
const READY_WAIT_MS = 150_000;
// A ten-minute dream decodes in well under a minute on the rig; a CPU-only
// machine is the reason for the headroom.
const DECODE_TIMEOUT_MS = 600_000;

let launching = null; // impure module state — this module's in-flight launch

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ensureReady = async () => {
  const deadline = Date.now() + READY_WAIT_MS;
  while (Date.now() < deadline) {
    const state = getStatus(ENGINE)?.state;
    if (state === ENGINE_STATES.READY) return;
    if (state === ENGINE_STATES.SYNCING || state === ENGINE_STATES.LAUNCHING) {
      await sleep(250);
      continue;
    }
    // stopped / failed / crashed — this caller launches; a launch that fails says why.
    if (!launching) launching = launch(ENGINE).finally(() => { launching = null; });
    await launching;
  }
  throw new Error(`the speech engine was not ready after ${READY_WAIT_MS / 1000}s`);
};

/**
 * @param {Buffer} audio
 * @param {string} contentType
 * @returns {Promise<{ text: string, language: string | null, durationSeconds: number | null }>}
 */
export const transcribeRecording = async (audio, contentType) => {
  await ensureReady();
  const { host, port } = resolveServe(ENGINE);
  const res = await fetch(`http://${host}:${port}/transcribe?hotwords=${encodeURIComponent(hotwordsPhrase())}`, {
    method: 'POST',
    headers: { 'Content-Type': contentType || 'application/octet-stream' },
    body: audio,
    signal: AbortSignal.timeout(DECODE_TIMEOUT_MS),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.detail || `the speech engine answered ${res.status}`);
  return { text: String(body.text ?? '').trim(), language: body.language ?? null, durationSeconds: body.durationSeconds ?? null };
};
