// Voice Forge validation — the pure boundary checks extracted verbatim from
// voice-forge.js (size-law breakdown, 2026-08-26): the mode/engine tables the
// checks judge against, session-start and offering validation, the Guard-5
// minted-embedding re-parse, and the offering provenance hash. Everything here
// is pure; voice-forge.js imports this and re-exports the public symbols so
// its readers (routes, tests) keep their door — this module never imports
// voice-forge.js.

import { createHash } from 'crypto';

export const FORGE_MODES = Object.freeze({
  CLONE: 'clone',
  DESIGN: 'design',
  PRESET: 'preset',
});

const VALID_MODES = new Set(Object.values(FORGE_MODES));

// Engine → supported modes (authoritative; checked at session start)
const ENGINE_MODES = Object.freeze({
  zonos:      [FORGE_MODES.CLONE],
  kokoro:     [FORGE_MODES.PRESET],
  // Parler is retired to registered-unlisted (B-21): its adapter and
  // PROVIDER_DEFAULTS entry stay registered so existing Parler voices still
  // speak, but it accepts no new forge sessions. DESIGN mode on qwen3
  // (VoiceDesign, seed-deterministic) is its successor.
  cartesia:   [FORGE_MODES.CLONE, FORGE_MODES.PRESET, FORGE_MODES.DESIGN],
  elevenlabs: [FORGE_MODES.CLONE, FORGE_MODES.PRESET, FORGE_MODES.DESIGN],
  // Kyutai clone mints a sovereign embedding at seal (B-9). Its CC0 preset
  // voices are NOT listed here yet — the forge mode table claims only what
  // Phase 1 wired and proved; preset listing is B-19's /engines extension.
  kyutai:     [FORGE_MODES.CLONE],
  // Qwen3 speaks both modes on the real engine (qwen3-engine-q3gh Wave-1):
  // x-vector clone on the Base checkpoint, seed-deterministic voice design
  // on VoiceDesign. Batch-only — preview UI must show GENERATING honestly.
  qwen3:      [FORGE_MODES.CLONE, FORGE_MODES.DESIGN],
});

export const getEngineModes = (engine) => ENGINE_MODES[engine] ? [...ENGINE_MODES[engine]] : [];

const WITNESS_RE = /^0x[0-9a-fA-F]{40}$/;
const NEUMAID_RE = /^[a-zA-Z0-9_-]+$/;

export const validateStartInput = ({ neumaId, witnessWallet, engine, mode }) => {
  const errors = [];
  if (!neumaId || !NEUMAID_RE.test(neumaId)) errors.push('neumaId must be alphanumeric/underscore/hyphen');
  if (!witnessWallet || !WITNESS_RE.test(witnessWallet)) errors.push('witnessWallet must be 0x + 40 hex');
  if (!mode || !VALID_MODES.has(mode)) errors.push(`mode must be one of ${[...VALID_MODES].join(', ')}`);
  if (!engine || !ENGINE_MODES[engine]) errors.push(`engine '${engine}' has no supported modes`);
  if (engine && mode && !ENGINE_MODES[engine]?.includes(mode)) {
    errors.push(`engine '${engine}' does not support mode '${mode}' (supports: ${ENGINE_MODES[engine]?.join(', ') || 'none'})`);
  }
  return errors;
};

export const validateOffering = (mode, offering, engine = null) => {
  const errors = [];
  if (!offering || typeof offering !== 'object') return ['offering must be an object'];
  if (mode === FORGE_MODES.CLONE) {
    if (!offering.refAudioB64) errors.push('clone offering requires refAudioB64');
    if (offering.consent !== true) errors.push('clone offering requires consent: true (witness must consent to voice use)');
    if (offering.refText !== undefined && typeof offering.refText !== 'string') errors.push('refText must be string if provided');
  } else if (mode === FORGE_MODES.DESIGN) {
    if (!offering.description || offering.description.length < 8) {
      errors.push('design offering requires description (≥8 chars)');
    }
    // The seed IS the design voice's portable identity on seed-deterministic
    // engines (qwen3) — a seedless qwen3 design voice cannot regenerate and
    // its adapter throws at SPEAK time, so the forge fails HERE at offering
    // time. Other design engines (cloud) keep the optional-but-validated path.
    const seedIsIdentity = engine === 'qwen3';
    if (seedIsIdentity && (!Number.isInteger(offering.voiceSeed) || offering.voiceSeed < 0 || offering.voiceSeed > 2 ** 31 - 1)) {
      errors.push('design offering requires voiceSeed (integer 0..2147483647) — the seed is the design voice\'s identity');
    } else if (offering.voiceSeed !== undefined
      && (!Number.isInteger(offering.voiceSeed) || offering.voiceSeed < 0 || offering.voiceSeed > 2 ** 31 - 1)) {
      errors.push('voiceSeed must be an integer 0..2147483647 when provided');
    }
  } else if (mode === FORGE_MODES.PRESET) {
    if (!offering.voiceId || typeof offering.voiceId !== 'string') errors.push('preset offering requires voiceId');
  }
  return errors;
};

// --- Guard 5: minted-embedding re-parse (pure) ---
//
// A minted embedding is safetensors: an 8-byte little-endian header length, a
// JSON header declaring each tensor (dtype/shape/data_offsets), then the raw
// tensor bytes. The sidecar shape-checks its own /mint output before
// responding; the forge RE-PARSES before custody — bytes that crossed a
// process boundary are never trusted on arrival. This validates the declared
// structure only: tensor payloads are never deserialized (safetensors-only by
// construction, and JS never materializes the floats). Shape/mirror of the
// sidecar's _check_embedding_bytes: exactly 'speaker_wavs', F32, rank-3
// (1, dim, T≥1), ≤ 4 MiB.

export const MINTED_EMBEDDING_MAX_BYTES = 4 * 1024 * 1024; // mirrors the sidecar's _EMBEDDING_MAX_BYTES
const SAFETENSORS_HEADER_MAX_BYTES = 1024 * 1024; // real headers are ~200 B — a sanity bound, not a target

export const validateMintedEmbedding = (bytes) => {
  if (!Buffer.isBuffer(bytes) && !(bytes instanceof Uint8Array)) {
    return ['minted embedding must be a Buffer or Uint8Array'];
  }
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (buf.length < 8) return ['minted embedding is too small to be safetensors'];
  const errors = [];
  if (buf.length > MINTED_EMBEDDING_MAX_BYTES) {
    errors.push(`minted embedding ${buf.length} B exceeds the ${MINTED_EMBEDDING_MAX_BYTES} B cap`);
  }
  const headerLen = Number(buf.readBigUInt64LE(0));
  if (!Number.isSafeInteger(headerLen) || headerLen < 2
    || headerLen > SAFETENSORS_HEADER_MAX_BYTES || 8 + headerLen > buf.length) {
    errors.push('minted embedding has an invalid safetensors header length');
    return errors; // with the length prefix untrustworthy, nothing further parses
  }
  let header;
  try {
    header = JSON.parse(buf.subarray(8, 8 + headerLen).toString('utf8'));
  } catch {
    errors.push('minted embedding header is not valid JSON');
    return errors;
  }
  if (!header || typeof header !== 'object' || Array.isArray(header)) {
    errors.push('minted embedding header is not a tensor map');
    return errors;
  }
  const tensors = Object.keys(header).filter((k) => k !== '__metadata__');
  if (tensors.length !== 1 || tensors[0] !== 'speaker_wavs') {
    errors.push(`minted embedding must carry exactly 'speaker_wavs', got [${tensors.join(', ')}]`);
    return errors;
  }
  const t = header.speaker_wavs;
  const shape = t?.shape;
  if (t?.dtype !== 'F32') errors.push(`speaker_wavs dtype must be F32, got ${t?.dtype}`);
  if (!Array.isArray(shape) || shape.length !== 3 || !shape.every((d) => Number.isInteger(d) && d >= 1)) {
    errors.push(`speaker_wavs shape must be rank-3 positive ints, got ${JSON.stringify(shape)}`);
    return errors;
  }
  if (shape[0] !== 1) errors.push(`speaker_wavs shape[0] must be 1, got ${shape[0]}`);
  const offsets = t.data_offsets;
  if (!Array.isArray(offsets) || offsets.length !== 2 || !offsets.every((o) => Number.isInteger(o) && o >= 0)) {
    errors.push('speaker_wavs data_offsets must be [begin, end] non-negative ints');
    return errors;
  }
  const [begin, end] = offsets;
  const declared = 4 * shape[0] * shape[1] * shape[2]; // F32 = 4 bytes per element
  if (end <= begin) errors.push(`speaker_wavs data_offsets end (${end}) must exceed begin (${begin})`);
  else if (end - begin !== declared) errors.push(`speaker_wavs declares ${end - begin} B, shape implies ${declared} B`);
  else if (8 + headerLen + end > buf.length) errors.push('speaker_wavs data extends past the end of the buffer');
  return errors;
};

// pure — hash the witness offering for provenance
export const hashOffering = (offering) =>
  offering ? 'sha256:' + createHash('sha256').update(JSON.stringify(
    offering.refAudioB64?.slice(0, 64) || offering.description || offering.voiceId || ''
  )).digest('hex') : null;
