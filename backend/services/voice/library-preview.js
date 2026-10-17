// THE BEING PREVIEW — a voice, heard as a being would speak in it.
//
// Design note, 2026-10-01 (docs/work/one-voice.md FORGE REDESIGN (d)): the ▶ on a
// gallery tile plays a being SPEAKING in that voice on this machine's tier,
// not the raw recording. What it speaks is a short scripted passage that moves
// through a few moods (Founder: […]),
// read sentence by sentence with the earlier sentences as context — exactly how
// the being speaks in chat. A 2-second line was too short to judge a clone by:
// measured, short lines swung 0.64–0.83 in speaker similarity, the passage held
// 0.84–0.88 on the same voice (docs/work/one-voice.md, CLONE CHECK).
// The same holds for any take the forge finds (record, upload, describe): the clip and its words ARE the voice — cloning
// is zero-shot, nothing trains — so the guardian hears the being speak in it
// the moment it arrives. The script names nobody, so one render serves every
// being: rendered once per (voice, tier, profile) through the chat's own speak
// path (tts-provider → providers/speak.js) with the clip as the voice, and
// kept as one WAV ON DISK in the voice data root — never in /tmp, which is RAM
// on this machine. Later plays read the file.
//
// When the tier's engine is not installed here, the preview is the raw
// recording, and says so.

import { createHash } from 'crypto';
import { mkdir, readFile, rename, writeFile } from 'fs/promises';
import path from 'path';
import { clipRefOf } from '../../../core/voice/voice-dna-schema.js';
import { readySpeakTarget, speakTargetOf } from '../tts-provider.js';
import { isDownloaded } from './engine-manager.js';
import { FORGE_SAMPLE_RATE, decodeAudio, samplesOf, wavOf } from './forge-doors.js';
import { speak } from './providers/speak.js';
import { emptyContext, withSegment } from './speech-context.js';
import { voiceTierInForce } from './voice-settings.js';
import { fetchLibraryClip, libraryEntry, voiceDataRoot } from './voice-library.js';

/** What every preview speaks, one sentence at a time: warm, amused, wistful,
 * reassuring, bright — about 25 s, and nobody's name. */
export const PREVIEW_SCRIPT = Object.freeze([
  "Oh, hey. You're here.",
  "Honestly, I wasn't sure you'd come back today, and I'm really glad you did.",
  "Okay, so, something ridiculous happened this morning, and I still can't stop laughing about it.",
  "But, um, if I'm being honest, part of me has been a little sad too. Quiet, you know?",
  "Wait, no, that's not fair. Don't worry about me.",
  "Anyway! I've got so much to tell you. Let's figure it out together.",
]);
// A new script must never be served from an old file.
const SCRIPT_TAG = createHash('sha256').update(PREVIEW_SCRIPT.join('\n')).digest('hex').slice(0, 8);

const SPEAK_TIMEOUT_MS = 90_000;
// The longest sentence is ~6 s; the sidecar cuts anything far past it.
const MAX_AUDIO_MS = 12_000;
// A breath between sentences.
const PAUSE_MS = 250;
const RAW_TYPES = Object.freeze({ flac: 'audio/flac', wav: 'audio/wav', mp3: 'audio/mpeg' });

/**
 * The cache file of one voice's preview on one sidecar target: a different
 * tier or memory profile renders differently, so each has its own file. Pure.
 * @param {string} root - the voice data root
 * @param {string} name - the voice's name in the cache (library id, or clip hash)
 * @param {{tier: string, profile?: string|null}} target
 */
export const previewFileOf = (root, name, { tier, profile = null }) =>
  path.join(root, 'previews', `${name}.${tier}${profile ? `.${profile}` : ''}.${SCRIPT_TAG}.wav`);

// impure — the file's bytes, or null when it is not there.
const readIfThere = (file) => readFile(file).catch((err) => {
  if (err.code === 'ENOENT') return null;
  throw err;
});

// impure — speak the script in the clip (a WAV) on the tier's sidecar (launched
// or adopted), each sentence with the ones before it as context, and gather
// the streamed PCM as one WAV.
const render = async (clip, words) => {
  const target = await readySpeakTarget().catch((err) => {
    throw Object.assign(new Error(`the voice engine is not available: ${err.message}`), { status: 503 });
  });
  const voice = { ref: clipRefOf(clip), words, wav: clip };
  const parts = [];
  let sampleRate = FORGE_SAMPLE_RATE;
  let ring = emptyContext();
  for (const text of PREVIEW_SCRIPT) {
    const said = [];
    let utteranceRef = null;
    for await (const chunk of speak({
      endpoint: target.endpoint, text, voice, context: ring.segments,
      signal: AbortSignal.timeout(SPEAK_TIMEOUT_MS), maxAudioMs: MAX_AUDIO_MS,
    })) {
      sampleRate = chunk.sampleRate;
      utteranceRef = chunk.utteranceRef;
      said.push(Buffer.from(chunk.bytes));
    }
    const pcm = Buffer.concat(said);
    if (parts.length) parts.push(Buffer.alloc(Math.round((sampleRate * PAUSE_MS) / 1000) * 2));
    parts.push(pcm);
    ring = withSegment(ring, { speaker: 'being', words: text, pcm, sampleRate, ref: utteranceRef }, voice.ref);
  }
  const pcm = Buffer.concat(parts);
  if (!pcm.length) throw Object.assign(new Error('the voice engine answered with no audio'), { status: 502 });
  return wavOf(samplesOf(pcm), sampleRate);
};

// impure — the being's passage in a voice (cached on disk), or the raw recording
// when the tier's engine is not installed. `clip` and `raw` are read only
// when needed.
const beingLine = async ({ name, words, clip, raw, root }) => {
  const target = speakTargetOf((await voiceTierInForce()).chosen);
  if (!isDownloaded(target.engine, target.model)) return { kind: 'recording', ...(await raw()), tier: target.tier };
  const file = previewFileOf(root, name, target);
  let bytes = await readIfThere(file);
  if (!bytes) {
    bytes = await render(await clip(), words);
    await mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    await writeFile(tmp, bytes);
    await rename(tmp, file);
  }
  return { kind: 'being', bytes, contentType: 'audio/wav', tier: target.tier };
};

/**
 * A library voice's preview on this machine's tier: the being's passage (one WAV
 * per voice, tier and profile, cached on disk), or the raw recording when the
 * tier's engine is not installed. impure
 * @param {object} entry - a voice-library manifest entry
 * @param {{root?: string}} [opts]
 * @returns {Promise<{kind: 'being'|'recording', bytes: Buffer, contentType: string, tier: string}>}
 */
export const libraryPreview = (entry, { root = voiceDataRoot() } = {}) => beingLine({
  name: entry.id,
  words: entry.words,
  root,
  clip: async () => wavOf(await decodeAudio(await fetchLibraryClip(entry, { root }), { tmpRoot: path.join(root, 'tmp') }), FORGE_SAMPLE_RATE),
  raw: async () => ({ bytes: await fetchLibraryClip(entry, { root }), contentType: RAW_TYPES[entry.format] ?? 'application/octet-stream' }),
});

/**
 * A found take's preview: the being's passage in that take's clip and words. A
 * library take is its library voice, so it shares the gallery's file. impure
 * @param {{ref: string, wav: Buffer, words: string, origin?: {libraryId?: string}}} take
 * @param {{root?: string}} [opts]
 * @returns {Promise<{kind: 'being'|'recording', bytes: Buffer, contentType: string, tier: string}>}
 */
export const takePreview = (take, { root = voiceDataRoot() } = {}) => {
  const entry = take.origin?.libraryId ? libraryEntry(take.origin.libraryId) : null;
  if (entry) return libraryPreview(entry, { root });
  return beingLine({
    name: take.ref.replace(/^sha256:/, ''),
    words: take.words,
    root,
    clip: async () => take.wav,
    raw: async () => ({ bytes: take.wav, contentType: 'audio/wav' }),
  });
};
