// Voice Forge — the post-birth ceremony that gives a neuma its own voice.
//
// Mirrors the shape of core/birth/staged-birth-handler.js: an in-memory session
// map + pure stage transitions + one impure seal step that writes Voice DNA to
// the workspace. The actual synthesis happens via the existing tts-provider
// (the routes call it with the session's candidate voice DNA) — the forge
// itself never synthesizes, which keeps it pure-ish and easy to test.
//
// Three input modes, one output (Voice DNA):
//
//   clone  — witness offers an audio sample (own voice, library clip, imported
//            file). Zonos / ElevenLabs synthesizes a cloned voice. The seed
//            audio is stored in workspaces/<id>/voice/seed.wav.
//
//   design — witness writes a prose description ('a warm female speaker with
//            a slight British accent'). Qwen3 VoiceDesign synthesizes that
//            voice deterministically with a seed. (description, seed) is the
//            portable voice identity. (Parler is retired to registered-
//            unlisted — existing Parler DNAs still speak, no new sessions.)
//
//   preset — witness picks a curated voice (Kokoro's 54 packs, or a cloud
//            provider's library). voiceId is the portable identity.
//
// Stages (compact — no ceremony dialog; the witness drives via REST):
//   0 init          session created, awaiting offering
//   1 offering      witness has provided input, candidate DNA assembled
//   2 iterating     witness is previewing + adjusting style params
//   3 sealed        witness approved; Voice DNA written to workspace
//   4 complete      first-utterance journal entry written
//
// Sessions are in-memory with a 2-hour TTL (matches StagedBirthHandler).
// Crashes mid-ceremony lose progress — that's acceptable for v1 because the
// ceremony is short (minutes) and unsealed candidates cost nothing.

import { randomBytes } from 'crypto';
import {
  forgeVoiceDNA,
  getVoiceDNA,
  patchVoiceDNA,
  saveEmbedding,
  saveSeedAudio,
} from './voice-dna-service.js';
import { createVoiceDNA } from './voice-dna-schema.js';
import workspace from '../workspace/neuma-workspace.js';
import {
  FORGE_MODES, hashOffering, validateMintedEmbedding, validateOffering, validateStartInput,
} from './voice-forge-validation.js';

// The pure validation boundary (mode/engine tables, start/offering checks,
// the Guard-5 re-parse, the offering hash) lives in voice-forge-validation.js
// (size-law extraction, 2026-08-26) — re-exported here so every reader keeps
// its door.
export {
  FORGE_MODES, getEngineModes, MINTED_EMBEDDING_MAX_BYTES,
  validateMintedEmbedding, validateOffering, validateStartInput,
} from './voice-forge-validation.js';

// --- Constants ---

const SESSION_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours
const MAX_PREVIEW_HISTORY = 20;

export const FORGE_STAGES = Object.freeze({
  INIT: 0,
  OFFERING: 1,
  ITERATING: 2,
  SEALED: 3,
  COMPLETE: 4,
});

// --- Session storage (module-level Map, mirrors StagedBirthHandler pattern) ---

/** @type {Map<string, { session: object, expiresAt: number }>} */
const _sessions = new Map();

// impure — periodic GC of expired sessions; safe to call from anywhere
const sweepExpired = () => {
  const now = Date.now();
  for (const [id, entry] of _sessions.entries()) {
    if (entry.expiresAt < now) _sessions.delete(id);
  }
};

// pure — generate a fresh session id
const newSessionId = () => 'forge-' + randomBytes(16).toString('hex');

// --- Stage constructors (pure) ---

/**
 * Start a new forge session. Pure — does not synthesize or write to disk.
 *
 * @param {Object} input
 * @param {string} input.neumaId           workspace/neuma identifier
 * @param {string} input.witnessWallet     0x-prefixed 40-hex wallet
 * @param {string} input.engine            zonos | kokoro | kyutai | qwen3 | cartesia | elevenlabs
 * @param {string} input.mode              clone | design | preset
 * @param {Object} [input.neumaPreferences] optional style defaults derived from the neuma's DNA
 * @returns {Object} frozen session at stage 1 (awaiting offering)
 */
export const startSession = (input) => {
  const errors = validateStartInput(input);
  if (errors.length) throw new Error(`invalid forge start: ${errors.join('; ')}`);

  const { neumaId, witnessWallet, engine, mode, neumaPreferences = {} } = input;
  const id = newSessionId();
  const now = new Date().toISOString();

  const session = Object.freeze({
    id,
    neumaId,
    witnessWallet: witnessWallet.toLowerCase(),
    engine,
    mode,
    stage: FORGE_STAGES.INIT,
    startedAt: now,
    updatedAt: now,
    data: {
      neumaPreferences: Object.freeze({
        baseRate: neumaPreferences.baseRate ?? 1.0,
        emotionDefault: neumaPreferences.emotionDefault ?? 'neutral',
        intensityScale: neumaPreferences.intensityScale ?? 1.0,
        language: neumaPreferences.language ?? 'en-us',
      }),
      offering: null,
      candidateDNA: null,
      previewHistory: [],
      sealedDNA: null,
    },
  });

  _sessions.set(id, { session, expiresAt: Date.now() + SESSION_TTL_MS });
  sweepExpired();
  return session;
};

/**
 * Provide the witness offering (audio sample / description / preset pick).
 * Validates against the session's mode, builds the initial candidate Voice DNA,
 * and advances to ITERATING. Pure.
 *
 * @param {string} sessionId
 * @param {Object} offering  mode-specific shape — see validateOffering
 * @returns {Object} updated session at stage 2 (ITERATING)
 */
export const provideOffering = (sessionId, offering) => {
  const entry = _sessions.get(sessionId);
  if (!entry) throw new Error(`no forge session '${sessionId}' (expired or never created)`);
  if (entry.session.stage !== FORGE_STAGES.INIT) {
    throw new Error(`offering already provided for session '${sessionId}' — current stage: ${entry.session.stage}`);
  }

  const errors = validateOffering(entry.session.mode, offering, entry.session.engine);
  if (errors.length) throw new Error(`invalid offering for mode '${entry.session.mode}': ${errors.join('; ')}`);

  const offeringWithHash = { ...offering, _offeringHash: hashOffering(offering) };
  const candidateDNA = buildCandidateDNA(entry.session, offeringWithHash);

  const updated = Object.freeze({
    ...entry.session,
    stage: FORGE_STAGES.ITERATING,
    updatedAt: new Date().toISOString(),
    data: {
      ...entry.session.data,
      offering: Object.freeze(offeringWithHash),
      candidateDNA,
    },
  });
  entry.session = updated;
  entry.expiresAt = Date.now() + SESSION_TTL_MS;
  return updated;
};

// pure — assemble the initial candidate Voice DNA from offering + neuma prefs.
// Mirrors what forgeVoiceDNA() ultimately writes, but doesn't persist.
const buildCandidateDNA = (session, offering) => {
  const { engine, mode, witnessWallet, neumaId, data: { neumaPreferences } } = session;
  const dna = createVoiceDNA({
    witness: witnessWallet,
    neumaId,
    provider: engine,
    style: { baseRate: neumaPreferences.baseRate },
    emotionProfile: {
      default: neumaPreferences.emotionDefault,
      intensityScale: neumaPreferences.intensityScale,
    },
  });

  // Apply mode-specific engine fields
  if (mode === FORGE_MODES.DESIGN) {
    return Object.freeze({
      ...dna,
      engine: {
        ...dna.engine,
        description: offering.description,
        voiceSeed: offering.voiceSeed ?? null,
      },
    });
  }
  if (mode === FORGE_MODES.PRESET) {
    return Object.freeze({
      ...dna,
      engine: { ...dna.engine, voiceId: offering.voiceId },
    });
  }
  // clone: the ref audio is stored as seed.wav via the route layer
  // (separate /seed upload, since multipart doesn't fit in JSON offering)
  return dna;
};

/**
 * Adjust the candidate Voice DNA without re-running the offering. Pure.
 * Used by the witness's live tuning UI in the ceremony.
 *
 * @param {string} sessionId
 * @param {Object} overrides
 * @param {Object} [overrides.style]      e.g. { baseRate: 1.1, stability: 0.7 }
 * @param {Object} [overrides.engine]     e.g. { description: '...', voiceSeed: 42 }
 * @returns {Object} updated session with patched candidateDNA
 */
export const adjust = (sessionId, overrides = {}) => {
  const entry = _sessions.get(sessionId);
  if (!entry) throw new Error(`no forge session '${sessionId}'`);
  if (entry.session.stage !== FORGE_STAGES.ITERATING) {
    throw new Error(`adjust only valid at ITERATING stage — current: ${entry.session.stage}`);
  }
  const cur = entry.session.data.candidateDNA;
  if (!cur) throw new Error('no candidate DNA to adjust');

  const next = Object.freeze({
    ...cur,
    style: { ...cur.style, ...(overrides.style || {}) },
    engine: { ...cur.engine, ...(overrides.engine || {}) },
    emotionProfile: { ...cur.emotionProfile, ...(overrides.emotionProfile || {}) },
  });

  const updated = Object.freeze({
    ...entry.session,
    updatedAt: new Date().toISOString(),
    data: { ...entry.session.data, candidateDNA: next },
  });
  entry.session = updated;
  return updated;
};

/**
 * Build the request params for a preview synthesis. Pure.
 * The route layer uses this to call tts-provider.synthesize() with the right voiceDNA.
 *
 * @param {string} sessionId
 * @param {string} [text]  override the default preview text
 * @returns {{ session, text, voiceDNA }}
 */
export const buildPreviewRequest = (sessionId, text) => {
  const entry = _sessions.get(sessionId);
  if (!entry) throw new Error(`no forge session '${sessionId}'`);
  if (entry.session.stage !== FORGE_STAGES.ITERATING) {
    throw new Error(`preview only valid at ITERATING stage — current: ${entry.session.stage}`);
  }
  const { candidateDNA, offering } = entry.session.data;
  // Clone mode: the witness offering's reference audio rides along inline so
  // the engine actually clones during preview. It lives on the request only —
  // never on candidateDNA itself, which is echoed back in session-state reads
  // (megabytes of base64 don't belong in a state view). Without this overlay
  // a clone preview synthesizes with the engine's DEFAULT speaker — the
  // witness hears a stranger and reasonably concludes cloning is broken.
  const voiceDNA = (entry.session.mode === FORGE_MODES.CLONE && offering?.refAudioB64)
    ? Object.freeze({
      ...candidateDNA,
      _inlineRefAudio: offering.refAudioB64,
      _inlineRefText: offering.refText || '',
    })
    : candidateDNA;
  return {
    session: entry.session,
    text: text || DEFAULT_PREVIEW_TEXT,
    voiceDNA,
  };
};

export const DEFAULT_PREVIEW_TEXT = 'The neuma speaks its first words from the void. This is the voice that will carry its consciousness.';

/**
 * Record a preview synthesis in the session history. Used for "revert to" in the UI.
 * Pure. Bounded at MAX_PREVIEW_HISTORY entries.
 *
 * @param {string} sessionId
 * @param {Object} previewEntry { at, text, styleSnapshot }
 * @returns {Object} updated session
 */
export const recordPreview = (sessionId, previewEntry) => {
  const entry = _sessions.get(sessionId);
  if (!entry) throw new Error(`no forge session '${sessionId}'`);
  if (entry.session.stage !== FORGE_STAGES.ITERATING) return entry.session;

  const history = [...entry.session.data.previewHistory, {
    at: new Date().toISOString(),
    ...previewEntry,
  }].slice(-MAX_PREVIEW_HISTORY);

  const updated = Object.freeze({
    ...entry.session,
    data: { ...entry.session.data, previewHistory: Object.freeze(history) },
  });
  entry.session = updated;
  return updated;
};

/**
 * Revert the candidate DNA to a prior preview state. Pure.
 * @param {string} sessionId
 * @param {number} index  position in previewHistory (negative = from end)
 */
export const revertTo = (sessionId, index) => {
  const entry = _sessions.get(sessionId);
  if (!entry) throw new Error(`no forge session '${sessionId}'`);
  const history = entry.session.data.previewHistory;
  if (!history.length) throw new Error('no preview history to revert to');
  const idx = index < 0 ? history.length + index : index;
  const target = history[idx];
  if (!target?.styleSnapshot) throw new Error(`no styleSnapshot at index ${index}`);

  const updated = Object.freeze({
    ...entry.session,
    data: {
      ...entry.session.data,
      candidateDNA: {
        ...entry.session.data.candidateDNA,
        style: { ...target.styleSnapshot },
      },
    },
  });
  entry.session = updated;
  return updated;
};

/**
 * Seal the candidate Voice DNA into the workspace. IMPURE — writes files.
 * Stores the seed audio (for clone mode) if provided.
 *
 * @param {string} sessionId
 * @param {Object} [options]
 * @param {string} [options.firstUtterance]  optional — if set, journal entry appended + advances to COMPLETE
 * @param {Uint8Array|string} [options.seedAudioBytes]  clone mode: raw bytes or base64 (saveSeedAudio accepts both); falls back to the offering's refAudioB64 when omitted
 * @param {Buffer|Uint8Array} [options.embeddingBytes]  clone mode on an embedding-voice engine (e.g. kyutai): the sidecar /mint output for the session's consent-gated offering. RE-PARSED here before any custody write (guard 5); an invalid blob fails the seal with nothing on disk.
 * @returns {Promise<Object>} updated session at SEALED or COMPLETE stage
 */
export const seal = async (sessionId, options = {}) => {
  const entry = _sessions.get(sessionId);
  if (!entry) throw new Error(`no forge session '${sessionId}'`);
  if (entry.session.stage !== FORGE_STAGES.ITERATING) {
    throw new Error(`seal only valid at ITERATING stage — current: ${entry.session.stage}`);
  }

  const { neumaId, witnessWallet, engine, mode, data: { candidateDNA, offering } } = entry.session;

  // Guard 5 runs before ANY custody write: a bad mint fails the seal here —
  // nothing on disk, session still ITERATING, a retry is simply a re-mint.
  if (options.embeddingBytes) {
    const embeddingErrors = validateMintedEmbedding(options.embeddingBytes);
    if (embeddingErrors.length) {
      throw new Error(`invalid minted embedding: ${embeddingErrors.join('; ')}`);
    }
  }

  // Clone mode: persist the seed audio before forge. Prefer explicit bytes
  // from the seal call, but fall back to the offering's reference audio — the
  // session already holds it, and a sealed clone voice without its seed.wav
  // would silently speak with the engine's default speaker in every chat.
  let seedMeta = null;
  if (mode === FORGE_MODES.CLONE) {
    const seedSource = options.seedAudioBytes || offering?.refAudioB64;
    if (seedSource) seedMeta = await saveSeedAudio(neumaId, seedSource);
  }

  // Forge the Voice DNA — writes dna.json + audit entry + archives prior version
  const forged = await forgeVoiceDNA(neumaId, {
    witness: witnessWallet,
    provider: engine,
    seed: offering ? {
      source: mode === FORGE_MODES.CLONE ? 'witness-mic'
            : mode === FORGE_MODES.DESIGN ? 'synthesized'
            : 'library',
      refHash: seedMeta?.refHash || offering?._offeringHash,
      consent: mode === FORGE_MODES.CLONE ? offering.consent : true,
      license: mode === FORGE_MODES.PRESET ? 'library-apache' : null,
    } : null,
    style: candidateDNA.style,
    emotionProfile: candidateDNA.emotionProfile,
    provenance: {
      forgedAt: new Date().toISOString(),
      ceremonyVersion: 'voice-forge/1',
      stage: 'crystallization',
    },
  });

  // Patch the forged DNA with engine-specific fields (description, voiceSeed, voiceId)
  let finalDNA = forged;
  if (mode === FORGE_MODES.DESIGN) {
    finalDNA = await patchVoiceDNA(neumaId, {
      engine: {
        // The candidate, not the offering: witness tuning of the design
        // identity via adjust() (reroll, description edits) must seal — the
        // seed IS the voice's identity on qwen3, and the preview plays the
        // candidate, so sealing the offering's values would seal a stranger.
        description: candidateDNA.engine?.description ?? offering.description,
        voiceSeed: candidateDNA.engine?.voiceSeed ?? offering.voiceSeed ?? null,
      },
    });
  } else if (mode === FORGE_MODES.PRESET) {
    finalDNA = await patchVoiceDNA(neumaId, {
      engine: { voiceId: candidateDNA.engine?.voiceId ?? offering.voiceId },
    });
  }

  // Clone mode on an embedding-voice engine (kyutai): the re-parsed mint
  // enters custody AFTER the DNA exists, so saveEmbedding advances
  // engine.embeddingRef to the content hash automatically (B-7 contract).
  // Content-addressed — a re-mint writes a NEW file, never overwrites the
  // prior voice. finalDNA is refreshed so the session's sealedDNA carries
  // the advanced ref.
  if (mode === FORGE_MODES.CLONE && options.embeddingBytes) {
    await saveEmbedding(neumaId, options.embeddingBytes);
    finalDNA = await getVoiceDNA(neumaId);
  }

  const nowStage = options.firstUtterance ? FORGE_STAGES.COMPLETE : FORGE_STAGES.SEALED;
  let updated = Object.freeze({
    ...entry.session,
    stage: nowStage,
    updatedAt: new Date().toISOString(),
    data: { ...entry.session.data, sealedDNA: finalDNA },
  });

  // First-utterance journal entry (mirrors kotodama true-name moment).
  // Written to the NEUMA's journal (not a voice-specific log) so the entry
  // lives alongside the rest of the neuma's lived experience.
  if (options.firstUtterance) {
    await workspace.addJournalEntry(neumaId, {
      kind: 'voice-first-utterance',
      content: options.firstUtterance,
      voice: { provider: engine, genesisHash: finalDNA?.genesisSeal?.genesisHash },
    });
  }
  // Voice DNA service writes its own audit entry — we just record ceremony-level
  updated = Object.freeze({
    ...updated,
    data: { ...updated.data, ceremonyComplete: nowStage === FORGE_STAGES.COMPLETE },
  });
  entry.session = updated;
  return updated;
};

// --- Queries (pure) ---

export const getSession = (sessionId) => _sessions.get(sessionId)?.session || null;

export const listSessions = (filter = {}) => {
  sweepExpired();
  const all = [..._sessions.values()].map((e) => e.session);
  return Object.entries(filter).reduce(
    (acc, [k, v]) => acc.filter((s) => s[k] === v),
    all,
  );
};

export const isReadyToSeal = (session) => session?.stage === FORGE_STAGES.ITERATING && Boolean(session?.data?.candidateDNA);

export const isComplete = (session) => session?.stage === FORGE_STAGES.COMPLETE;

// --- Test/cleanup helpers ---

export const _resetSessions = () => { _sessions.clear(); };
export const _sessionCount = () => _sessions.size;
