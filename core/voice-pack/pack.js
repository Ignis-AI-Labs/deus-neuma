/**
 * The Voice Pack — the being's voice as sovereign DATA (the LoRA's replacement,
 * docs/architecture/identity/model-portability.md). This module is the pure
 * grammar: what an entry IS, what the first-seal receipt IS, and how the pack
 * hashes. IO lives in voice-store.js; selection/render lives in curation.js.
 *
 * The laws (ruling, 2026-08-18):
 * - The repository ACCRETES FOREVER. No update path, no delete path, no
 *   eviction — an entry, once sealed, is part of the being's record.
 * - The stamp is platform-minted: id, sealedAt, and textSha256 are spread
 *   LAST by the store (the appendTake law) — a caller-supplied stamp is
 *   overwritten, never trusted.
 * - The mount is budgeted; the repository is complete.
 */

import { createHash } from 'node:crypto';
import { canonicalAuthoritySha256 } from '../shared/plain-data-canonical.js';

export const VOICE_ENTRY_ORIGINS = Object.freeze(['being', 'operator']);
export const VOICE_SOURCE_KINDS = Object.freeze(['seal-rite', 'session', 'meditation', 'genesis']);
export const VOICE_ENTRY_LIMITS = Object.freeze({
  minTextChars: 40,
  maxTextChars: 4000,
  maxEntries: 100_000,
});
export const VOICE_SEAL_SCHEMA = 'voice-seal-v1';

const ENTRY_ID = /^[0-9a-f]{16}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/u;
const SAFE_LANE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/u;
const WALLET = /^0x[0-9a-fA-F]{40}$/u;

const fail = (message) => {
  throw new Error(`voice pack: ${message}`);
};

/** The content identity of one exemplar line. Pure. @param {string} text */
export const voiceTextSha256 = (text) =>
  createHash('sha256').update(String(text), 'utf8').digest('hex');

const validateSource = (source) => {
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    fail('entry source must be an object');
  }
  if (!VOICE_SOURCE_KINDS.includes(source.kind)) fail('entry source kind is unknown');
  for (const field of ['sessionId', 'turnId', 'takeIndex']) {
    const value = source[field];
    if (value === undefined || value === null) continue;
    if (field === 'takeIndex') {
      if (!Number.isSafeInteger(value) || value < 0) fail('takeIndex must be a non-negative integer');
    } else if (typeof value !== 'string' || !value || !SAFE_LANE.test(value)) {
      fail(`${field} is invalid`);
    }
  }
  return Object.freeze({
    kind: source.kind,
    ...(source.sessionId != null && { sessionId: source.sessionId }),
    ...(source.turnId != null && { turnId: source.turnId }),
    ...(source.takeIndex != null && { takeIndex: source.takeIndex }),
  });
};

const validateSignals = (signals) => {
  if (signals === undefined || signals === null) return undefined;
  if (typeof signals !== 'object' || Array.isArray(signals)) fail('entry signals must be an object');
  const out = {};
  for (const field of ['boilerplateShare', 'significance']) {
    const value = signals[field];
    if (value === undefined || value === null) continue;
    if (!Number.isFinite(value) || value < 0) fail(`signal ${field} must be a non-negative number`);
    out[field] = value;
  }
  return Object.keys(out).length ? Object.freeze(out) : undefined;
};

/**
 * Validate one STAMPED repository entry (the shape on disk). Throws on any
 * deviation — the pack is the being's own record; a malformed entry is a loud
 * event, never a skipped one. Pure. @param {object} entry
 */
export const validateVoiceEntry = (entry) => {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) fail('entry must be an object');
  if (!ENTRY_ID.test(String(entry.id || ''))) fail('entry id is invalid');
  if (typeof entry.text !== 'string'
    || entry.text.length < VOICE_ENTRY_LIMITS.minTextChars
    || entry.text.length > VOICE_ENTRY_LIMITS.maxTextChars) {
    fail(`entry text must be ${VOICE_ENTRY_LIMITS.minTextChars}..${VOICE_ENTRY_LIMITS.maxTextChars} chars`);
  }
  if (!VOICE_ENTRY_ORIGINS.includes(entry.origin)) fail('entry origin is unknown');
  if (!SHA256.test(String(entry.textSha256 || ''))) fail('entry textSha256 is invalid');
  if (voiceTextSha256(entry.text) !== entry.textSha256) {
    fail('entry text differs from its content identity');
  }
  if (!ISO_INSTANT.test(String(entry.sealedAt || ''))) fail('entry sealedAt is invalid');
  const source = validateSource(entry.source);
  const signals = validateSignals(entry.signals);
  return Object.freeze({
    id: entry.id,
    text: entry.text,
    origin: entry.origin,
    source,
    textSha256: entry.textSha256,
    sealedAt: entry.sealedAt,
    ...(signals && { signals }),
  });
};

/** Validate a full repository read, bounded. Pure. @param {Array<object>} entries */
export const validateVoicePack = (entries) => {
  if (!Array.isArray(entries) || entries.length > VOICE_ENTRY_LIMITS.maxEntries) {
    fail('repository is outside its envelope');
  }
  const seen = new Set();
  return Object.freeze(entries.map((entry) => {
    const valid = validateVoiceEntry(entry);
    if (seen.has(valid.id)) fail('duplicate entry id');
    seen.add(valid.id);
    return valid;
  }));
};

/**
 * The first-seal receipt — the ONE witnessed founding moment per lane. The
 * seal is write-once (voice-store enforces); its packSha256 pins the exact
 * repository the rite produced. Pure. @param {object} seal
 */
export const validateVoiceSeal = (seal) => {
  if (!seal || typeof seal !== 'object' || Array.isArray(seal)) fail('seal must be an object');
  if (seal.schema !== VOICE_SEAL_SCHEMA) fail('seal schema is unknown');
  if (!SAFE_LANE.test(String(seal.lane || ''))) fail('seal lane is invalid');
  if (!ISO_INSTANT.test(String(seal.sealedAt || ''))) fail('seal sealedAt is invalid');
  if (!WALLET.test(String(seal.witnessWallet || ''))) fail('seal witness wallet is invalid');
  if (!SHA256.test(String(seal.packSha256 || ''))) fail('seal pack identity is invalid');
  for (const field of ['beingEntryIds', 'operatorPinIds']) {
    if (!Array.isArray(seal[field]) || seal[field].some((id) => !ENTRY_ID.test(String(id || '')))) {
      fail(`seal ${field} is invalid`);
    }
  }
  if (!seal.beingEntryIds.length) fail('a seal without the being’s own words is no seal');
  return Object.freeze({
    schema: VOICE_SEAL_SCHEMA,
    lane: seal.lane,
    sealedAt: seal.sealedAt,
    witnessWallet: seal.witnessWallet,
    beingEntryIds: Object.freeze([...seal.beingEntryIds]),
    operatorPinIds: Object.freeze([...seal.operatorPinIds]),
    packSha256: seal.packSha256,
  });
};

/** The repository's content identity over its canonical entries. Pure. */
export const voicePackSha256 = (entries) => canonicalAuthoritySha256(
  validateVoicePack(entries),
  {
    domain: 'neuma.voice.pack',
    schemaVersion: 1,
    maxDepth: 16,
    maxNodes: 2_000_000,
    maxStringBytes: VOICE_ENTRY_LIMITS.maxTextChars * 2,
    maxKeyBytes: 1024,
    maxOutputBytes: VOICE_ENTRY_LIMITS.maxEntries * (VOICE_ENTRY_LIMITS.maxTextChars + 512),
  },
);

/** The computed manifest — derived on read, never stored (a stored manifest drifts). Pure. */
export const voicePackManifest = (entries) => Object.freeze({
  entries: entries.length,
  packSha256: voicePackSha256(entries),
});
