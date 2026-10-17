/**
 * Archive segment codec (Phase 1, granular sovereign memory).
 *
 * Pure encode/decode/naming/anchor logic for the sovereign archive lane —
 * the per-compaction segment files that preserve a being's raw session
 * region before compaction replaces it. IO (locks, temp+rename, DEK
 * resolution) lives in neuma-workspace.js; this module never touches disk.
 *
 * Region identity IS the path (`archive/<sessionId>/<ordinal>.seg`), so the
 * filename grammar is frozen and canonical: one ordinal, exactly one
 * spelling — leading zeros are rejected so a retry can never write a second
 * file for the same region.
 *
 * Anchors are content-time coordinates (timestamps + content hashes), never
 * live-file indexes: indexes shift on every compaction rewrite, while
 * timestamps and content travel verbatim into segments.
 */

import crypto from 'crypto';

export const ARCHIVE_SEGMENT_FORMAT = 'neuma-archive-segment';
export const ARCHIVE_SEGMENT_VERSION = 1;
export const ANCHOR_VERSION = 1;
export const ORIGIN_COMPACTION = 'compaction';
export const ORIGIN_BACKFILL = 'backfill';

const ORIGINS = Object.freeze([ORIGIN_COMPACTION, ORIGIN_BACKFILL]);

// Canonical subset of the ruled `\d{1,6}` ordinal space: leading zeros are
// aliases (01.seg and 1.seg would name the same region twice), so only the
// canonical spelling is legal on disk.
export const SEGMENT_FILE_PATTERN = Object.freeze(/^(0|[1-9]\d{0,5})\.seg$/);

// Admits live session ids and backfill pseudo-sessions (`bf-<neumaId>-<epochMs>`).
// No path separators, no dots — a session id can never traverse.
export const SESSION_ID_PATTERN = Object.freeze(/^[a-zA-Z0-9_-]{1,64}$/);

const MAX_ORDINAL = 999999;

const _isValidSessionId = (sessionId) =>
  typeof sessionId === 'string' && SESSION_ID_PATTERN.test(sessionId);

const _isValidOrdinal = (n) => Number.isInteger(n) && n >= 0 && n <= MAX_ORDINAL;

// Strict ISO-8601 — the shape new Date().toISOString() emits, plus offset
// forms. Date.parse alone is lenient ('January 1, 2026' passes it), and
// anchors are load-bearing ts→segment coordinates: the contract says ISO,
// so the gate enforces ISO before Date.parse validates the value.
const ISO_TS_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/;

const _parseableTs = (ts) =>
  typeof ts === 'string' && ISO_TS_PATTERN.test(ts) && !Number.isNaN(Date.parse(ts));

const _allMessageObjects = (messages) =>
  messages.every((m) => m !== null && typeof m === 'object' && !Array.isArray(m));

/**
 * sha256 hex of the full content, first 8 chars — the sid8 idiom. The hash
 * is over the COMPLETE text (observations truncate at 300/500 chars, which
 * is exactly why the anchor, not the stored text, is the source of truth).
 * Anchor matching is joint on timestamp + sha8 — resolution locates by ts
 * first and uses sha8 only to disambiguate same-millisecond collisions, so
 * the 32-bit space is never asked to be unique across a workspace, only
 * within one millisecond bucket.
 * @param {string} content
 * @returns {string}
 */
export const contentSha8 = (content) => {
  if (typeof content !== 'string') {
    throw new Error('contentSha8: content must be a string');
  }
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex').slice(0, 8);
};

/**
 * Canonical segment filename for an ordinal.
 * @param {number} ordinal - compactionCount (compaction origin) or 0 (backfill)
 * @returns {string}
 */
export const segmentFileName = (ordinal) => {
  if (!_isValidOrdinal(ordinal)) {
    throw new Error(`segmentFileName: ordinal must be an integer 0..${MAX_ORDINAL}, got ${ordinal}`);
  }
  return `${ordinal}.seg`;
};

/**
 * Parse a segment filename against the frozen pattern.
 * @param {string} name
 * @returns {number|null} the ordinal, or null when the name is not a canonical segment name
 */
export const parseSegmentFileName = (name) => {
  if (typeof name !== 'string') return null;
  const m = SEGMENT_FILE_PATTERN.exec(name);
  return m ? Number(m[1]) : null;
};

const _timestampBounds = (messages) => {
  const parsed = messages
    .map((msg) => (msg && _parseableTs(msg.timestamp) ? msg.timestamp : null))
    .filter((ts) => ts !== null);
  if (parsed.length === 0) return { firstTimestamp: null, lastTimestamp: null };
  const sorted = [...parsed].sort((a, b) => Date.parse(a) - Date.parse(b));
  return { firstTimestamp: sorted[0], lastTimestamp: sorted[sorted.length - 1] };
};

/**
 * Build a segment payload from a region about to leave the live session
 * file. Messages travel VERBATIM — content, role, timestamps untouched.
 * Per-origin law: compaction segments carry their compactionCount (which
 * must equal the filename ordinal); backfill segments carry none (their
 * ordinal is fixed at 0, one segment per pseudo-session).
 *
 * @param {{
 *   sessionId: string,
 *   origin: 'compaction'|'backfill',
 *   messages: Array<object>,
 *   archivedAt: string,
 *   compactionCount?: number,
 * }} input
 * @returns {object} frozen segment payload
 */
export const encodeSegment = ({ sessionId, origin, messages, archivedAt, compactionCount } = {}) => {
  if (!_isValidSessionId(sessionId)) {
    throw new Error('encodeSegment: sessionId must match the frozen session-id pattern');
  }
  if (!ORIGINS.includes(origin)) {
    throw new Error(`encodeSegment: origin must be one of ${ORIGINS.join('|')}, got ${origin}`);
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error('encodeSegment: messages must be a non-empty array');
  }
  if (!_allMessageObjects(messages)) {
    throw new Error('encodeSegment: every message must be an object');
  }
  if (!_parseableTs(archivedAt)) {
    throw new Error('encodeSegment: archivedAt must be a parseable ISO timestamp');
  }
  if (origin === ORIGIN_COMPACTION && !_isValidOrdinal(compactionCount)) {
    throw new Error('encodeSegment: compaction segments require an integer compactionCount');
  }
  if (origin === ORIGIN_BACKFILL && compactionCount !== undefined) {
    throw new Error('encodeSegment: backfill segments must not carry compactionCount');
  }
  const { firstTimestamp, lastTimestamp } = _timestampBounds(messages);
  return Object.freeze({
    format: ARCHIVE_SEGMENT_FORMAT,
    v: ARCHIVE_SEGMENT_VERSION,
    sessionId,
    origin,
    ...(origin === ORIGIN_COMPACTION ? { compactionCount } : {}),
    archivedAt,
    firstTimestamp,
    lastTimestamp,
    messages: Object.freeze([...messages]),
  });
};

/**
 * Validate a decrypted segment payload, optionally against the coordinates
 * it was found at. Rejects wrong format/version, per-origin shape
 * violations, and any mismatch between payload identity and the filename
 * coordinates — a mismatch means the archive was tampered with or a second
 * writer violated the single-writer assumption.
 *
 * @param {object} payload
 * @param {{expectedSessionId?: string, expectedOrdinal?: number}} [expect]
 * @returns {object} the validated payload
 */
export const decodeSegment = (payload, expect = {}) => {
  if (payload === null || typeof payload !== 'object') {
    throw new Error('decodeSegment: payload must be an object');
  }
  if (payload.format !== ARCHIVE_SEGMENT_FORMAT) {
    throw new Error(`decodeSegment: unknown format "${payload.format}"`);
  }
  if (payload.v !== ARCHIVE_SEGMENT_VERSION) {
    throw new Error(`decodeSegment: unsupported segment version ${payload.v}`);
  }
  if (!_isValidSessionId(payload.sessionId)) {
    throw new Error('decodeSegment: payload sessionId is invalid');
  }
  if (!ORIGINS.includes(payload.origin)) {
    throw new Error(`decodeSegment: payload origin "${payload.origin}" is invalid`);
  }
  if (!Array.isArray(payload.messages) || payload.messages.length === 0) {
    throw new Error('decodeSegment: payload messages must be a non-empty array');
  }
  if (!_allMessageObjects(payload.messages)) {
    throw new Error('decodeSegment: every payload message must be an object');
  }
  if (!_parseableTs(payload.archivedAt)) {
    throw new Error('decodeSegment: payload archivedAt is not a parseable timestamp');
  }
  // Integrity, not just shape: the encoder DERIVES the bounds from the
  // messages, so stored bounds that disagree with re-derivation mean the
  // payload was tampered with or hand-built. (A bad bound alone could only
  // ever cause a resolution MISS, never a mis-anchor — the exchange-locate
  // step is ts+sha8-verified — but decode is the tamper gate, so it refuses.)
  const derived = _timestampBounds(payload.messages);
  if (payload.firstTimestamp !== derived.firstTimestamp || payload.lastTimestamp !== derived.lastTimestamp) {
    throw new Error('decodeSegment: timestamp bounds do not match the carried messages');
  }
  if (payload.origin === ORIGIN_COMPACTION && !_isValidOrdinal(payload.compactionCount)) {
    throw new Error('decodeSegment: compaction segment lacks a valid compactionCount');
  }
  if (payload.origin === ORIGIN_BACKFILL && 'compactionCount' in payload) {
    throw new Error('decodeSegment: backfill segment must not carry compactionCount');
  }
  if (expect.expectedSessionId !== undefined && payload.sessionId !== expect.expectedSessionId) {
    throw new Error(
      `decodeSegment: sessionId "${payload.sessionId}" does not match location "${expect.expectedSessionId}"`
    );
  }
  if (expect.expectedOrdinal !== undefined) {
    const payloadOrdinal = payload.origin === ORIGIN_COMPACTION ? payload.compactionCount : 0;
    if (payloadOrdinal !== expect.expectedOrdinal) {
      throw new Error(
        `decodeSegment: payload ordinal ${payloadOrdinal} does not match filename ordinal ${expect.expectedOrdinal}`
      );
    }
  }
  return payload;
};

/**
 * Mint an anchor — the content-time coordinates of one exchange. sha8s are
 * computed from the FULL texts in hand at crystallize time. compactionCount
 * is present only when minted on the compaction path (the portal path
 * cannot know it and omits it).
 *
 * @param {{
 *   sessionId: string,
 *   userMessage: {content: string, timestamp: string},
 *   assistantMessage: {content: string, timestamp: string},
 *   compactionCount?: number,
 * }} input
 * @returns {object} frozen anchor
 */
export const makeAnchor = ({ sessionId, userMessage, assistantMessage, compactionCount } = {}) => {
  if (!_isValidSessionId(sessionId)) {
    throw new Error('makeAnchor: sessionId must match the frozen session-id pattern');
  }
  if (!userMessage || typeof userMessage.content !== 'string' || !_parseableTs(userMessage.timestamp)) {
    throw new Error('makeAnchor: userMessage needs string content and a parseable timestamp');
  }
  if (
    !assistantMessage ||
    typeof assistantMessage.content !== 'string' ||
    !_parseableTs(assistantMessage.timestamp)
  ) {
    throw new Error('makeAnchor: assistantMessage needs string content and a parseable timestamp');
  }
  if (compactionCount !== undefined && !_isValidOrdinal(compactionCount)) {
    throw new Error('makeAnchor: compactionCount, when present, must be a valid ordinal');
  }
  return Object.freeze({
    v: ANCHOR_VERSION,
    sessionId,
    span: Object.freeze({
      fromTs: userMessage.timestamp,
      toTs: assistantMessage.timestamp,
      userSha8: contentSha8(userMessage.content),
      assistantSha8: contentSha8(assistantMessage.content),
    }),
    ...(compactionCount !== undefined ? { compactionCount } : {}),
  });
};

const _sameMessage = (a, b) =>
  a !== null &&
  b !== null &&
  typeof a === 'object' &&
  typeof b === 'object' &&
  a.role === b.role &&
  a.timestamp === b.timestamp &&
  a.content === b.content;

/**
 * The crash-retry rule as a pure function: how does an already-staged
 * segment relate to the region a retry is about to stage?
 *
 *  - 'identical' — same region; the retry skips the write (idempotent no-op)
 *  - 'prefix'    — the staged region is a verified prefix of the current one
 *                  (tail appends landed between attempts); grow-only re-stage
 *  - 'divergent' — anything else; a second writer exists — fail closed
 *
 * @param {Array<object>} existingMessages - messages decoded from the staged segment
 * @param {Array<object>} currentMessages - the region about to be destroyed
 * @returns {'identical'|'prefix'|'divergent'}
 */
export const regionCoverage = (existingMessages, currentMessages) => {
  if (!Array.isArray(existingMessages) || !Array.isArray(currentMessages)) {
    throw new Error('regionCoverage: both arguments must be arrays');
  }
  if (existingMessages.length === 0 || existingMessages.length > currentMessages.length) {
    return 'divergent';
  }
  for (let i = 0; i < existingMessages.length; i += 1) {
    if (!_sameMessage(existingMessages[i], currentMessages[i])) return 'divergent';
  }
  return existingMessages.length === currentMessages.length ? 'identical' : 'prefix';
};

/**
 * True when a segment header's timestamp range covers the given moment —
 * the ts→segment resolution predicate. Inclusive on both ends: when two
 * adjacent segments touch at a boundary ts, both match here and the
 * resolver settles it at the exchange-locate step (ts + sha8 inside the
 * decoded segment), so header-level ambiguity can never mis-anchor.
 * @param {{firstTimestamp: string|null, lastTimestamp: string|null}} header
 * @param {string} ts
 * @returns {boolean}
 */
export const spanCoversTs = (header, ts) => {
  if (header === null || typeof header !== 'object') return false;
  if (!_parseableTs(header.firstTimestamp) || !_parseableTs(header.lastTimestamp)) return false;
  if (!_parseableTs(ts)) return false;
  const t = Date.parse(ts);
  return Date.parse(header.firstTimestamp) <= t && t <= Date.parse(header.lastTimestamp);
};
