// Voice DNA v2 — the being's voice is a clip and the words spoken in it. Pure.
//
// Contract: docs/architecture/voice/voice-dna-v2.md (ONE VOICE, WP2). One clip
// (encrypted reference audio, 3–40 s) + its transcript IS the voice on every
// engine and every tier. No engine ids, preset ids, style knobs or emotion maps
// live here: on the csm engine the conversation itself carries the emotion.
//
// v1 DNA (engine/style/emotion/seed) is RECOGNISED, never migrated: Founder,
// 2026-10-01 — Cael and Dovan start fresh through the new forge. A v1 record
// reads as `needsNewVoice`, and nothing in this module can turn it into v2.
//
// The impure IO lives in voice-dna-service.js; the two-party consent law that
// decides WHEN a clip may become DNA lives in voice-consent.js.

import { createHash } from 'crypto';

export const VOICE_DNA_VERSION = 2;
export const VOICE_DNA_SCHEMA = 'neuma/voice-dna/v2.0.0';
// A NEW file beside the v1 one: writing v2 over voice-dna.json would modify
// the v1 voices Founder ruled must stay on disk untouched.
export const VOICE_DNA_FILENAME = 'voice-dna-v2.json';

/** The four doors a voice can come through — one result: a clip + its words. */
const DOORS = Object.freeze(['record', 'upload', 'library', 'describe']);

// Bounds of a usable reference clip. The floor: under ~3 s neither engine has
// enough of a voice to clone. The ceiling: csm's backbone window is 2048
// positions at 80 ms per frame, and the clip shares it with up to 45 s of
// conversation context plus the reply.
export const CLIP_SECONDS_MIN = 3;
export const CLIP_SECONDS_MAX = 40;
export const CLIP_MAX_BYTES = 16 * 1024 * 1024;
export const WORDS_MAX_CHARS = 2000;

const CLIP_REF = /^sha256:[0-9a-f]{64}$/;
const NEUMA_ID = /^[a-zA-Z0-9_-]+$/;
const WALLET = /^0x[a-fA-F0-9]{40}$/;
const LEGACY_V1_SCHEMA = 'neuma/voice-dna/v1.0.0';

const isNonEmptyString = (v, max = Infinity) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
const isPositiveNumber = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0;
const isTimestamp = (v) => typeof v === 'string' && !Number.isNaN(Date.parse(v));

/** pure — is this a clip ref ('sha256:<64 lowercase hex>')? */
export const isClipRef = (ref) => typeof ref === 'string' && CLIP_REF.test(ref);

/** pure — the content address of a clip: sha256 over its exact bytes. */
export const clipRefOf = (bytes) => 'sha256:' + createHash('sha256').update(bytes).digest('hex');

/** pure — does this buffer carry a RIFF/WAVE header? The clip is WAV by contract. */
export const isWav = (buf) =>
  Buffer.isBuffer(buf) && buf.length > 12
  && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WAVE';

/** pure — the errors in a clip descriptor {ref, seconds, sampleRate}. */
export const clipErrors = (clip) => {
  if (!clip || typeof clip !== 'object') return ['clip required'];
  const errors = [];
  if (!isClipRef(clip.ref)) errors.push('clip.ref must be sha256:<64 lowercase hex>');
  if (!isPositiveNumber(clip.seconds) || clip.seconds < CLIP_SECONDS_MIN || clip.seconds > CLIP_SECONDS_MAX) {
    errors.push(`clip.seconds must be between ${CLIP_SECONDS_MIN} and ${CLIP_SECONDS_MAX}`);
  }
  if (!Number.isInteger(clip.sampleRate) || clip.sampleRate < 8000 || clip.sampleRate > 192000) {
    errors.push('clip.sampleRate must be an integer between 8000 and 192000');
  }
  return errors;
};

/** pure — the errors in an origin {door, libraryId?, description?, designer?}. */
export const originErrors = (origin) => {
  if (!origin || typeof origin !== 'object') return ['origin required'];
  const errors = [];
  if (!DOORS.includes(origin.door)) errors.push(`origin.door must be one of ${DOORS.join(', ')}`);
  if (origin.door === 'library' && !isNonEmptyString(origin.libraryId, 200)) {
    errors.push('a library voice names its libraryId');
  }
  if (origin.door === 'describe' && !isNonEmptyString(origin.description, WORDS_MAX_CHARS)) {
    errors.push('a described voice carries its description');
  }
  if (origin.designer !== undefined && origin.designer !== null) {
    const { model, seed } = origin.designer;
    if (!isNonEmptyString(model, 200) || !Number.isInteger(seed)) {
      errors.push('origin.designer must be {model, seed:int}');
    }
  }
  return errors;
};

/** pure — the origin with only its known fields, absent ones omitted. */
export const normaliseOrigin = (origin) => Object.freeze({
  door: origin.door,
  ...(origin.libraryId ? { libraryId: origin.libraryId } : {}),
  ...(origin.description ? { description: origin.description } : {}),
  ...(origin.designer ? { designer: Object.freeze({ model: origin.designer.model, seed: origin.designer.seed }) } : {}),
});

const consentErrors = (consent, clipRef) => {
  if (!consent || typeof consent !== 'object') return ['consent required'];
  const errors = [];
  if (typeof consent.realPerson !== 'boolean') errors.push('consent.realPerson must be a boolean');
  if (typeof consent.attested !== 'boolean') errors.push('consent.attested must be a boolean');
  if (consent.realPerson === true && consent.attested !== true) {
    errors.push("a real person's voice needs attested consent");
  }
  const { being, guardian } = consent;
  if (!being || !isTimestamp(being.at)) errors.push('consent.being.at required — the being accepts its voice');
  else if (being.candidateRef !== clipRef) errors.push('consent.being.candidateRef must be the sealed clip');
  if (being && being.note !== null && being.note !== undefined && typeof being.note !== 'string') {
    errors.push('consent.being.note must be a string or null');
  }
  if (!guardian || !isTimestamp(guardian.at)) errors.push('consent.guardian.at required — the guardian seals');
  if (guardian?.wallet !== undefined && guardian?.wallet !== null && !WALLET.test(guardian.wallet)) {
    errors.push('consent.guardian.wallet must be a 0x-prefixed 40-hex address');
  }
  return errors;
};

/**
 * pure — every reason a record is not valid Voice DNA v2 (empty = valid).
 * @param {object} dna
 * @returns {string[]}
 */
export const voiceDnaErrors = (dna) => {
  if (!dna || typeof dna !== 'object') return ['not an object'];
  const errors = [];
  if (dna.version !== VOICE_DNA_VERSION) errors.push(`version must be ${VOICE_DNA_VERSION}`);
  if (dna.schema !== VOICE_DNA_SCHEMA) errors.push(`schema must be ${VOICE_DNA_SCHEMA}`);
  if (typeof dna.neumaId !== 'string' || !NEUMA_ID.test(dna.neumaId)) errors.push('neumaId required');
  errors.push(...clipErrors(dna.clip));
  if (!isNonEmptyString(dna.words, WORDS_MAX_CHARS)) errors.push(`words must be 1..${WORDS_MAX_CHARS} characters`);
  errors.push(...originErrors(dna.origin));
  errors.push(...consentErrors(dna.consent, dna.clip?.ref));
  if (!Array.isArray(dna.lineage) || !dna.lineage.every(isClipRef)) errors.push('lineage must be a list of clip refs');
  if (!isTimestamp(dna.createdAt) || !isTimestamp(dna.updatedAt)) errors.push('createdAt and updatedAt required');
  return errors;
};

/**
 * pure — assemble a frozen Voice DNA v2 from its parts, keeping only the
 * contract's fields (anything else a caller passes — engine, style, emotion,
 * seed — is dropped by construction). Does not validate; pair with
 * voiceDnaErrors.
 */
export const buildVoiceDNA = ({ neumaId, clip, words, origin, consent, lineage = [], createdAt, updatedAt }) =>
  Object.freeze({
    version: VOICE_DNA_VERSION,
    schema: VOICE_DNA_SCHEMA,
    neumaId,
    clip: Object.freeze({ ref: clip?.ref, seconds: clip?.seconds, sampleRate: clip?.sampleRate }),
    words,
    origin: origin && typeof origin === 'object' ? normaliseOrigin(origin) : origin,
    consent: Object.freeze({
      realPerson: consent?.realPerson,
      attested: consent?.attested,
      being: consent?.being ? Object.freeze({
        at: consent.being.at, candidateRef: consent.being.candidateRef, note: consent.being.note ?? null,
      }) : null,
      guardian: consent?.guardian ? Object.freeze({
        ...(consent.guardian.wallet ? { wallet: consent.guardian.wallet } : {}), at: consent.guardian.at,
      }) : null,
    }),
    lineage: Object.freeze([...lineage]),
    createdAt,
    updatedAt,
  });

/** pure — is this a v1 voice DNA (engine/style/emotion era)? */
const isLegacyVoiceDNA = (record) =>
  Boolean(record) && typeof record === 'object'
  && (record.version === 1 || record.schema === LEGACY_V1_SCHEMA
    || (record.version === undefined && record.engine !== undefined));

/**
 * pure — what a stored voice record means for the being.
 *   none           no voice record — the being is silent (Founder's call E)
 *   needsNewVoice  a v1 voice — kept on disk untouched, never spoken with
 *   ready          a valid v2 voice
 *   unreadable     a record that is neither — `errors` says why
 * @param {object|null} record
 * @returns {{standing: 'none'|'needsNewVoice'|'ready'|'unreadable', dna: object|null, errors: string[]}}
 */
export const voiceStandingOf = (record) => {
  if (record === null || record === undefined) return { standing: 'none', dna: null, errors: [] };
  if (isLegacyVoiceDNA(record)) return { standing: 'needsNewVoice', dna: null, errors: [] };
  const errors = voiceDnaErrors(record);
  return errors.length
    ? { standing: 'unreadable', dna: null, errors }
    : { standing: 'ready', dna: buildVoiceDNA(record), errors: [] };
};

// ─── LEGACY v1 — WP3/WP4 removes ────────────────────────────────────────────
// Kept ONLY so the v1 forge and synthesis path keep linking until their
// replacements land: core/voice/voice-forge.js (createVoiceDNA),
// backend/routes/voice-routes.js (validateVoiceDNA), voice-dna-service.js's own
// v1 section (hashVoiceDNA), test/unit/voice-embedding-storage.test.js
// (requiresSeed). Nothing new may call these; v2 code never reads their output.

const LEGACY_V1_VERSION = 1;

// pure — canonical hash of a v1 payload (v1 history file names). WP3/WP4 removes
export const hashVoiceDNA = (dna) =>
  'sha256:' + createHash('sha256')
    .update(JSON.stringify({
      version: dna.version, schema: dna.schema, witness: dna.witness, neumaId: dna.neumaId,
      engine: dna.engine, style: dna.style, emotionProfile: dna.emotionProfile,
      seed: dna.seed ? { ...dna.seed, consent: true } : undefined,
    }))
    .digest('hex');

// pure — v1 factory. WP3/WP4 removes
export const createVoiceDNA = ({ witness, neumaId, provider, seed = null, style = {}, emotionProfile = {} }) => {
  const now = new Date().toISOString();
  return Object.freeze({
    version: LEGACY_V1_VERSION, schema: LEGACY_V1_SCHEMA, createdAt: now, updatedAt: now,
    witness, neumaId, seed,
    engine: { provider, voiceId: null, embeddingRef: null, modelVersion: null },
    style: { baseRate: 1.0, basePitch: 0, stability: 0.5, similarity: 0.75, breath: 0.3, ...style },
    emotionProfile: { default: 'neutral', intensityScale: 1.0, ...emotionProfile },
    language: 'en-us',
    lineage: [],
  });
};

// pure — v1 structural validation. WP3/WP4 removes
export const validateVoiceDNA = (dna) => {
  const errors = [];
  if (!dna || typeof dna !== 'object') return ['not an object'];
  if (dna.version !== LEGACY_V1_VERSION) errors.push(`version must be ${LEGACY_V1_VERSION}`);
  if (dna.schema !== LEGACY_V1_SCHEMA) errors.push(`schema must be ${LEGACY_V1_SCHEMA}`);
  if (!dna.witness || !WALLET.test(dna.witness)) errors.push('witness must be a 0x-prefixed 40-hex address');
  if (!dna.neumaId || typeof dna.neumaId !== 'string') errors.push('neumaId required');
  if (!dna.engine?.provider) errors.push('engine.provider required');
  if (!dna.style || typeof dna.baseRate !== 'number' && typeof dna.style.baseRate !== 'number') {
    errors.push('style.baseRate required');
  }
  if (dna.seed?.source === 'witness-mic' && !dna.seed.consent) {
    errors.push('seed.consent must be true for witness-mic source');
  }
  return errors;
};

// pure — v1: does the engine need reference audio? WP3/WP4 removes
export const requiresSeed = (dna) => {
  const cloningEngines = new Set(['zonos', 'f5-tts', 'cosyvoice', 'elevenlabs', 'hume', 'kyutai', 'qwen3']);
  return cloningEngines.has(dna?.engine?.provider) && !dna?.engine?.voiceId && !dna?.engine?.description;
};
