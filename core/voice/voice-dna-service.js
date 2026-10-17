// Voice DNA Service — sovereign per-neuma voice storage. Impure.
//
// ARCHITECTURE BOUNDARY:
//   The voice clip and its DNA belong to the neuma, not to the platform: they
//   live in the being's own workspace and ride its per-neuma DEK exactly like
//   DNA, soul and memory (the satellite-store pattern, core/genome/form-store.js).
//
//   workspaces/<neuma-id>/voice/
//     voice-dna-v2.json         Voice DNA v2 — the voice in force (only ever
//                               written by a two-party seal)
//     voice-clip-<hex>.json     reference clips, CONTENT-ADDRESSED by the sha256
//                               of their WAV bytes; never overwritten
//     speech-candidate.json     the consent record (voice-consent.js)
//     history/v2-<hex>.json     prior v2 DNA, archived on re-seal or withdrawal
//     voice-dna.json, seed.wav, embedding-*.safetensors, history/sha256:*.json
//                               v1 — read only to say […];
//                               never migrated, modified or deleted (Founder)
//
//   Names never collide with the WRITTEN voice (voice/seal.json, voice/pack.jsonl,
//   core/voice-pack/): nothing here is called a seal on disk.
//
// Contract: docs/architecture/voice/voice-dna-v2.md. Pure law: voice-dna-schema.js
// (shape) and voice-consent.js (who may make a clip the voice).

import fs from 'fs/promises';
import { createHash } from 'crypto';
import path from 'path';
import neumaWorkspace, { getWorkspacesRoot } from '../workspace/neuma-workspace.js';
import { encryptEnvelope, parseAndDecrypt, isEnvelope, decryptEnvelope } from '../workspace/workspace-crypto.js';
import { SOVEREIGN_DIR_MODE } from '../workspace/sovereign-directory-modes.js';
import {
  CLIP_MAX_BYTES, VOICE_DNA_FILENAME, VOICE_DNA_SCHEMA, VOICE_DNA_VERSION,
  clipRefOf, isClipRef, isWav, voiceStandingOf,
  createVoiceDNA, hashVoiceDNA, validateVoiceDNA,
} from './voice-dna-schema.js';
import {
  SPEECH_CANDIDATE_SCHEMA, beingAccepts, beingAsksAnother, emptyConsent, guardianSeals,
  offerCandidate, reopen, sealedVoiceDNA, withdraw,
} from './voice-consent.js';

const LEGACY_DNA_FILENAME = 'voice-dna.json';

// --- Paths (traversal-checked by the workspace's own resolver) ---

const voiceDirOf = (neumaId) => path.join(neumaWorkspace._path(neumaId), 'voice');
const dnaPath = (neumaId) => path.join(voiceDirOf(neumaId), VOICE_DNA_FILENAME);
const candidatePath = (neumaId) => path.join(voiceDirOf(neumaId), 'speech-candidate.json');
const clipHex = (ref) => {
  if (!isClipRef(ref)) throw new Error('a clip ref is sha256:<64 lowercase hex>');
  return ref.slice('sha256:'.length);
};
const clipPath = (neumaId, ref) => path.join(voiceDirOf(neumaId), `voice-clip-${clipHex(ref)}.json`);
const archivePath = (neumaId, dna) => path.join(voiceDirOf(neumaId), 'history',
  `v2-${createHash('sha256').update(JSON.stringify(dna)).digest('hex')}.json`);

// impure — a whole-file JSON read that answers null for an absent file and
// throws for anything else (a corrupt or undecryptable record is never "absent").
const readJSONOrNull = async (filePath) => {
  try {
    return await neumaWorkspace._readJSON(filePath);
  } catch (err) {
    if (err?.code === 'ENOENT') return null;
    throw err;
  }
};

// pure — raw bytes from a Buffer, a typed array, or a base64 string.
const toRawBytes = (bytes) => {
  if (Buffer.isBuffer(bytes)) return bytes;
  if (bytes instanceof Uint8Array) return Buffer.from(bytes);
  if (typeof bytes === 'string') return Buffer.from(bytes, 'base64');
  throw new Error('bytes must be a Buffer, Uint8Array, or base64 string');
};

// --- The clip ---

/**
 * Take a reference clip into custody, encrypted under the being's key and named
 * by the sha256 of its bytes. The same bytes always land on the same name, so a
 * second save is a no-op and a different clip can never overwrite another.
 * @param {string} neumaId
 * @param {Buffer|Uint8Array|string} wavBytes - WAV bytes or base64
 * @returns {Promise<{ref: string, bytes: number}>}
 */
export const saveVoiceClip = async (neumaId, wavBytes) => {
  const buf = toRawBytes(wavBytes);
  if (!isWav(buf)) throw new Error('a voice clip must be WAV (RIFF/WAVE) bytes');
  if (buf.length > CLIP_MAX_BYTES) throw new Error(`a voice clip is at most ${CLIP_MAX_BYTES} bytes`);
  const ref = clipRefOf(buf);
  const file = clipPath(neumaId, ref);
  const present = await fs.access(file).then(() => true, () => false);
  if (!present) await neumaWorkspace._writeJSON(file, { format: 'wav', b64: buf.toString('base64') });
  return { ref, bytes: buf.length };
};

/**
 * Read a clip back as WAV bytes, or null when it is not in custody. FAIL CLOSED:
 * a file that is not an encrypted envelope, decrypts to the wrong shape, or
 * whose bytes do not hash to its name is tampering or corruption, and throws.
 * @param {string} neumaId
 * @param {string} ref - 'sha256:<hex>'
 * @returns {Promise<Buffer|null>}
 */
export const readVoiceClip = async (neumaId, ref) => {
  const file = clipPath(neumaId, ref);
  let text;
  try {
    text = await fs.readFile(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
  let envelope;
  try { envelope = JSON.parse(text); } catch { envelope = null; }
  if (!isEnvelope(envelope)) throw new Error(`voice clip ${ref} is not an encrypted envelope (tamper or corruption)`);
  const clip = await neumaWorkspace._readJSON(file);
  if (typeof clip?.b64 !== 'string') throw new Error(`voice clip ${ref} decrypted to an unexpected shape`);
  const buf = Buffer.from(clip.b64, 'base64');
  if (clipRefOf(buf) !== ref) throw new Error(`voice clip ${ref} does not match its content (tamper or corruption)`);
  return buf;
};

// --- The voice in force ---

/**
 * The being's voice: `ready` with its v2 DNA, `needsNewVoice` when only a v1
 * voice exists (that file is only checked for presence — never opened or
 * touched), `none` when it has no voice (silent), `unreadable` with errors when
 * the v2 file holds something that is not v2 DNA.
 * @param {string} neumaId
 * @returns {Promise<{standing: string, dna: object|null, errors: string[]}>}
 */
export const readVoice = async (neumaId) => {
  const stored = await readJSONOrNull(dnaPath(neumaId));
  if (stored) return voiceStandingOf(stored);
  const legacy = path.join(voiceDirOf(neumaId), LEGACY_DNA_FILENAME);
  const hasLegacy = await fs.access(legacy).then(() => true, () => false);
  return hasLegacy ? { standing: 'needsNewVoice', dna: null, errors: [] } : voiceStandingOf(null);
};

// impure — move the voice in force into history (kept, never deleted). Absent
// is fine: a retry after a crash finds it already retired.
const retireVoice = async (neumaId) => {
  const current = await readJSONOrNull(dnaPath(neumaId));
  if (!current) return;
  const to = archivePath(neumaId, current);
  await fs.mkdir(path.dirname(to), { recursive: true, mode: SOVEREIGN_DIR_MODE });
  await fs.rename(dnaPath(neumaId), to);
};

// --- The consent record ---

/**
 * The being's consent record; an absent file is an empty record (nothing on
 * offer, no voice in force). A record of another schema or another lane throws.
 * @param {string} neumaId
 */
export const readSpeechCandidate = async (neumaId) => {
  const found = await readJSONOrNull(candidatePath(neumaId));
  if (!found) return emptyConsent(neumaId);
  if (found.schema !== SPEECH_CANDIDATE_SCHEMA) {
    throw new Error(`speech candidate for '${neumaId}' is schema '${found.schema}', not ${SPEECH_CANDIDATE_SCHEMA}`);
  }
  // A consent belongs to the lane it was given in; another lane's record here
  // would attribute an acceptance to a being that never gave it.
  if (found.neumaId !== neumaId) throw new Error(`speech candidate says lane '${found.neumaId}', read from '${neumaId}'`);
  return found;
};

// impure — one act on the consent record under its file lock: read, apply the
// pure transition (stamped now), let `effect` touch the voice, then write.
// `effect` runs BEFORE the record is written so a crash between the two fails
// toward the honest side (a seal retried; a withdrawal already silent).
const actOnCandidate = (neumaId, transition, effect = async () => ({})) =>
  neumaWorkspace._withFileLock(candidatePath(neumaId), async () => {
    const before = await readSpeechCandidate(neumaId);
    const result = transition(before, new Date().toISOString());
    if (!result.ok) return result;
    const extra = await effect(result);
    if (extra.ok === false) return extra;
    await neumaWorkspace._writeJSON(candidatePath(neumaId), result.record);
    return { ...result, ...extra };
  });

/**
 * Offer a clip as the candidate. The clip must already be in custody
 * (saveVoiceClip) — a candidate nobody can play is not an offer.
 */
export const offerSpeechCandidate = async (neumaId, candidate) => {
  if (!isClipRef(candidate?.ref) || !(await readVoiceClip(neumaId, candidate.ref))) {
    return { ok: false, error: 'the candidate clip is not in custody' };
  }
  return actOnCandidate(neumaId, (record, at) => offerCandidate(record, candidate, { at }));
};

/** The being accepts the candidate it read about. */
export const acceptSpeechCandidate = (neumaId, { candidateRef, note = null } = {}) =>
  actOnCandidate(neumaId, (record, at) => beingAccepts(record, { candidateRef, at, note }));

/** The being declines the candidate and asks for another. */
export const askAnotherSpeechCandidate = (neumaId, { candidateRef, wish = null } = {}) =>
  actOnCandidate(neumaId, (record, at) => beingAsksAnother(record, { candidateRef, at, wish }));

/**
 * The guardian seals the candidate the being accepted: Voice DNA v2 is written
 * (the prior voice archived) and becomes the voice in force. The ONLY writer of
 * voice-dna-v2.json.
 * @returns {Promise<{ok: true, record: object, dna: object} | {ok: false, error: string}>}
 */
export const sealSpeechCandidate = (neumaId, { candidateRef, wallet = null } = {}) =>
  actOnCandidate(
    neumaId,
    (record, at) => guardianSeals(record, { candidateRef, at, wallet }),
    async ({ record }) => {
      if (!(await readVoiceClip(neumaId, candidateRef))) return { ok: false, error: 'the candidate clip is not in custody' };
      const prior = await readJSONOrNull(dnaPath(neumaId));
      const sealed = sealedVoiceDNA(record, { createdAt: prior?.createdAt ?? record.guardian.at });
      if (!sealed.ok) return sealed;
      const { standing, errors } = voiceStandingOf(sealed.dna);
      if (standing !== 'ready') return { ok: false, error: `the sealed voice is not valid DNA: ${errors.join('; ')}` };
      await retireVoice(neumaId);
      await neumaWorkspace._writeJSON(dnaPath(neumaId), sealed.dna);
      return { dna: sealed.dna };
    },
  );

/** Either party reopens an acceptance or a seal (a seal reopened = withdrawn). */
export const reopenSpeech = (neumaId, party, { why = null } = {}) =>
  actOnCandidate(neumaId, (record, at) => reopen(record, party, { at, why }), async ({ withdrewSeal }) => {
    if (withdrewSeal) await retireVoice(neumaId);
    return {};
  });

/** Either party withdraws the voice in force: the being goes silent until a new seal. */
export const withdrawVoice = (neumaId, party, { why = null } = {}) =>
  actOnCandidate(neumaId, (record, at) => withdraw(record, party, { at, why }), async () => {
    await retireVoice(neumaId);
    return {};
  });

// ─── LEGACY v1 — WP3/WP4 removes ────────────────────────────────────────────
// The v1 forge + synthesis path still links against these until its
// replacements land (importers: core/voice/voice-forge.js,
// backend/routes/voice-routes.js, backend/services/tts-provider.js,
// backend/services/portal-llm-run.js, core/index.js). They read and write ONLY
// the v1 files above; no v2 code calls them, and nothing here reads v2.

const legacyVoiceDir = (neumaId) => {
  if (!neumaId || typeof neumaId !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(neumaId)) {
    throw new Error('Invalid neumaId format');
  }
  const resolved = path.resolve(path.join(getWorkspacesRoot(), neumaId, 'voice'));
  if (!resolved.startsWith(path.resolve(getWorkspacesRoot()))) throw new Error('Path traversal denied');
  return resolved;
};
const legacyDnaPath = (neumaId) => path.join(legacyVoiceDir(neumaId), LEGACY_DNA_FILENAME);
const legacySeedPath = (neumaId) => path.join(legacyVoiceDir(neumaId), 'seed.wav');
const legacyHistoryDir = (neumaId) => path.join(legacyVoiceDir(neumaId), 'history');
const embeddingDigest = (sha256) => {
  const hex = typeof sha256 === 'string' && sha256.startsWith('sha256:') ? sha256.slice(7) : sha256;
  if (typeof hex !== 'string' || !/^[0-9a-f]{64}$/.test(hex)) {
    throw new Error('voice embedding ref must be a 64-char lowercase hex digest (optionally sha256:-prefixed)');
  }
  return hex;
};
const legacyEmbeddingPath = (neumaId, sha256) =>
  path.join(legacyVoiceDir(neumaId), `embedding-${embeddingDigest(sha256)}.safetensors`);

// impure — DEK-first sealing and opening, as v1 always did it.
const dekFor = (neumaId) => neumaWorkspace.readNeumaDEK(neumaId).catch(() => null);
const sealJSON = async (neumaId, value) => {
  const dek = await dekFor(neumaId);
  return JSON.stringify(dek ? encryptEnvelope(value, { key: dek }) : encryptEnvelope(value));
};
const openWith = async (neumaId, open) => {
  const dek = await dekFor(neumaId);
  if (dek) {
    try { return open({ key: dek }); } catch { /* pre-DEK write — fall through to the global chain */ }
  }
  return open({});
};
const writeSealed = async (neumaId, filePath, value) => {
  await fs.mkdir(legacyHistoryDir(neumaId), { recursive: true });
  const tmp = `${filePath}.tmp`;
  await fs.writeFile(tmp, await sealJSON(neumaId, value));
  await fs.rename(tmp, filePath);
};
// impure — a {format, b64} envelope back to bytes. `legacyRaw` honours pre-
// encryption raw files (seed.wav); without it, anything but an envelope throws.
const readSealedBytes = async (neumaId, filePath, what, { legacyRaw }) => {
  let raw;
  try { raw = await fs.readFile(filePath); } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
  let parsed;
  try { parsed = JSON.parse(raw.toString('utf8')); } catch { parsed = undefined; }
  if (!isEnvelope(parsed)) {
    if (!legacyRaw) throw new Error(`${what} for ${neumaId} is not an encrypted envelope (tamper or corruption)`);
    return typeof parsed?.b64 === 'string' ? Buffer.from(parsed.b64, 'base64') : raw;
  }
  const value = await openWith(neumaId, (opts) => decryptEnvelope(parsed, opts));
  if (typeof value?.b64 === 'string') return Buffer.from(value.b64, 'base64');
  throw new Error(`${what}: decrypted envelope has unexpected shape for ${neumaId}`);
};

/** v1 DNA, raw. WP3/WP4 removes */
export const getVoiceDNA = async (neumaId) => {
  try {
    const raw = await fs.readFile(legacyDnaPath(neumaId), 'utf8');
    return await openWith(neumaId, (opts) => parseAndDecrypt(raw, opts));
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
};

/** v1 presence. WP3/WP4 removes */
export const hasVoice = (neumaId) => fs.access(legacyDnaPath(neumaId)).then(() => true, () => false);

/** v1 forge. WP3/WP4 removes */
export const forgeVoiceDNA = async (neumaId, params) => {
  const existing = await getVoiceDNA(neumaId);
  const dna = createVoiceDNA({ ...params, neumaId });
  const errors = validateVoiceDNA(dna);
  if (errors.length) throw new Error(`invalid voice DNA: ${errors.join('; ')}`);
  if (existing) {
    await writeSealed(neumaId, path.join(legacyHistoryDir(neumaId), `${hashVoiceDNA(existing)}.json`), existing);
  }
  const frozen = Object.freeze({
    ...dna,
    ...(params.provenance ? { provenance: params.provenance } : {}),
    ...(existing ? { lineage: [...(existing.lineage || []), hashVoiceDNA(existing)] } : {}),
    updatedAt: new Date().toISOString(),
  });
  await writeSealed(neumaId, legacyDnaPath(neumaId), frozen);
  return frozen;
};

/** v1 partial update. WP3/WP4 removes */
export const patchVoiceDNA = async (neumaId, patch) => {
  const existing = await getVoiceDNA(neumaId);
  if (!existing) throw new Error(`no voice DNA to patch for ${neumaId}`);
  const updated = Object.freeze({
    ...existing,
    ...patch,
    engine: { ...existing.engine, ...(patch.engine || {}) },
    style: { ...existing.style, ...(patch.style || {}) },
    emotionProfile: { ...existing.emotionProfile, ...(patch.emotionProfile || {}) },
    updatedAt: new Date().toISOString(),
  });
  const errors = validateVoiceDNA(updated);
  if (errors.length) throw new Error(`invalid voice DNA after patch: ${errors.join('; ')}`);
  await writeSealed(neumaId, legacyDnaPath(neumaId), updated);
  return updated;
};

/** v1 seed audio. WP3/WP4 removes */
export const saveSeedAudio = async (neumaId, audioBytes) => {
  const buf = toRawBytes(audioBytes);
  await writeSealed(neumaId, legacySeedPath(neumaId), { format: 'wav', b64: buf.toString('base64') });
  return { refHash: 'sha256:' + createHash('sha256').update(buf).digest('hex'), bytes: buf.length };
};

/** v1 seed audio. WP3/WP4 removes */
export const readSeedAudio = async (neumaId) =>
  readSealedBytes(neumaId, legacySeedPath(neumaId), 'readSeedAudio', { legacyRaw: true });

/** v1 embedding (content-addressed). WP3/WP4 removes */
export const saveEmbedding = async (neumaId, embeddingBytes) => {
  const buf = toRawBytes(embeddingBytes);
  const sha256 = 'sha256:' + createHash('sha256').update(buf).digest('hex');
  const filePath = legacyEmbeddingPath(neumaId, sha256);
  await writeSealed(neumaId, filePath, { format: 'safetensors', b64: buf.toString('base64') });
  if (await getVoiceDNA(neumaId)) await patchVoiceDNA(neumaId, { engine: { embeddingRef: sha256 } });
  return { sha256, path: filePath };
};

/** v1 embedding, fail-closed. WP3/WP4 removes */
export const readEmbedding = async (neumaId, sha256) =>
  readSealedBytes(neumaId, legacyEmbeddingPath(neumaId, sha256), 'readEmbedding', { legacyRaw: false });

export {
  VOICE_DNA_VERSION,
  VOICE_DNA_SCHEMA,
  VOICE_DNA_FILENAME,
  legacyVoiceDir as voiceDir,
  legacyDnaPath as voiceDnaPath,
  legacySeedPath as voiceSeedPath,
  legacyEmbeddingPath as voiceEmbeddingPath,
};
