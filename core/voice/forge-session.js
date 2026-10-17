// THE FORGE SESSION — find a voice, hear it talk, seal it. Pure model + an
// in-memory store.
//
// Design note, 2026-10-01 (docs/work/one-voice.md, INTEGRATION): the forge is three
// steps, one result.
//
//   FIND   four doors (record · upload · library · describe) each yield TAKES:
//          a clip and its words, measured. One take found is pinned at once;
//          the designer's three wait for the guardian to pick one.
//   HEAR   the pinned take is the AUDITION voice: the being speaks a short
//          exchange in it through the exact chat path (resolveAuditionVoice).
//          Audition turns are never written to history.
//   SEAL   the pinned take is OFFERED as the speech candidate; the being reads
//          the described voice and accepts or asks another (speech/accept,
//          speech/another); the guardian seals only the exact accepted ref.
//          The consent itself lives on disk (core/voice/voice-consent.js) —
//          this session only remembers which take it offered.
//
// A take is content-addressed (its `ref` is the sha256 of its WAV bytes, the
// same ref the clip will carry into custody), so picking, offering and
// sealing all name one thing with one string.
//
// Sessions are bound to the wallet that started them and live in memory: a
// forge is a sitting, not a record. One per being — starting another
// replaces it — and each expires after FORGE_SESSION_TTL_MS of no use.

import { isClipRef } from './voice-dna-schema.js';

export const FORGE_SESSION_TTL_MS = 2 * 60 * 60 * 1000;
export const MAX_TAKES = 12;

export const FORGE_STAGES = Object.freeze({ FIND: 'find', HEAR: 'hear', SEAL: 'seal' });

const refuse = (error) => ({ ok: false, error });

/**
 * A fresh session: nothing found, nothing pinned, nothing offered. Pure.
 * @param {{id: string, neumaId: string, wallet: string, now: number}} p
 */
export const createForgeSession = ({ id, neumaId, wallet, now }) => Object.freeze({
  id,
  neumaId,
  wallet: String(wallet).toLowerCase(),
  takes: Object.freeze([]),
  pinned: null,
  offered: null,
  startedAt: now,
  touchedAt: now,
});

/** pure — has the session gone unused past its TTL? */
export const isExpired = (session, now, ttlMs = FORGE_SESSION_TTL_MS) => now - session.touchedAt > ttlMs;

/** pure — the take with this ref, or null. */
export const takeOf = (session, ref) => session.takes.find((t) => t.ref === ref) ?? null;

/**
 * The stage, read off the session: nothing pinned is FIND, a pinned take not
 * yet offered is HEAR, an offered one is SEAL. Pure.
 */
export const stageOf = (session) => {
  if (!session.pinned) return FORGE_STAGES.FIND;
  return session.offered === session.pinned ? FORGE_STAGES.SEAL : FORGE_STAGES.HEAR;
};

/**
 * Add what a door found. A single take is pinned at once (there is nothing to
 * choose between); several (the designer's three) wait for a pick. A take
 * already held is not added twice. The oldest takes fall away past MAX_TAKES,
 * never the pinned one. Pure.
 * @param {object} session
 * @param {object[]} found - takes, each with a clip ref
 * @param {number} now
 */
export const withTakes = (session, found, now) => {
  if (!Array.isArray(found) || found.length === 0) return refuse('the door found no voice');
  if (found.some((t) => !isClipRef(t?.ref))) return refuse('every take names its clip ref');
  const fresh = found.filter((t, i) => !takeOf(session, t.ref) && found.findIndex((u) => u.ref === t.ref) === i);
  const all = [...session.takes, ...fresh.map((t) => Object.freeze({ ...t }))];
  // Drop the oldest unpinned takes until the cap holds.
  const droppable = all.filter((t) => t.ref !== session.pinned).slice(0, Math.max(0, all.length - MAX_TAKES));
  const kept = all.filter((t) => !droppable.includes(t));
  return {
    ok: true,
    session: Object.freeze({
      ...session,
      takes: Object.freeze(kept),
      pinned: found.length === 1 ? found[0].ref : session.pinned,
      touchedAt: now,
    }),
  };
};

/**
 * Pin a take as the voice to hear (and, later, to offer). Pure.
 * @param {object} session
 * @param {string} ref
 * @param {number} now
 */
export const withPin = (session, ref, now) => {
  if (!takeOf(session, ref)) return refuse('that take is not in this forge');
  return { ok: true, session: Object.freeze({ ...session, pinned: ref, touchedAt: now }) };
};

/**
 * Record which take was offered as the speech candidate. Pure.
 * @param {object} session
 * @param {string} ref - the take offered
 * @param {number} now
 */
export const withOffered = (session, ref, now) => {
  if (!takeOf(session, ref)) return refuse('that take is not in this forge');
  return { ok: true, session: Object.freeze({ ...session, offered: ref, touchedAt: now }) };
};

/** pure — a take without its audio bytes: what any surface may see of it. */
const takeView = ({ wav, ...rest }) => Object.freeze({ ...rest, bytes: wav?.length ?? 0 });

/**
 * The session as a surface may see it — no audio bytes, no wallet. Pure.
 * @param {object} session
 */
export const sessionView = (session) => Object.freeze({
  id: session.id,
  neumaId: session.neumaId,
  stage: stageOf(session),
  takes: session.takes.map(takeView),
  pinned: session.pinned,
  offered: session.offered,
  startedAt: new Date(session.startedAt).toISOString(),
  touchedAt: new Date(session.touchedAt).toISOString(),
});

// ─── The store (impure: module state) ───────────────────────────────────────
// One Map, swept on every access. Never persisted: a restart ends every forge,
// and nothing a forge holds is lost by that — found clips are re-findable, and
// an offered candidate is already on disk in the being's consent record.

const _sessions = new Map();

// impure — drop every session past its TTL.
const sweep = (now) => {
  for (const [id, s] of _sessions) if (isExpired(s, now)) _sessions.delete(id);
};

/**
 * Store a session, replacing any other for the same being (one forge per
 * being). impure.
 * @param {object} session
 */
export const putForgeSession = (session) => {
  sweep(Date.now());
  for (const [id, s] of _sessions) if (s.neumaId === session.neumaId && id !== session.id) _sessions.delete(id);
  _sessions.set(session.id, session);
  return session;
};

/** impure — the live session with this id, or null. */
export const getForgeSession = (id) => {
  sweep(Date.now());
  return _sessions.get(id) ?? null;
};

/** impure — the live session for this being, or null. */
export const forgeSessionFor = (neumaId) => {
  sweep(Date.now());
  for (const s of _sessions.values()) if (s.neumaId === neumaId) return s;
  return null;
};

/** impure — end a session; true when one was there. */
export const endForgeSession = (id) => _sessions.delete(id);

/**
 * THE HEAR HOOK — the voice a being should speak in right now if its guardian
 * is auditioning one: the pinned take of its live forge, or null (then the
 * being speaks in its sealed Voice DNA, or stays silent without one). A turn
 * spoken in an audition voice is an AUDITION — the chat path must not write
 * it to history. A connection whose wallet is not the forge's guardian never
 * hears the audition. impure (reads the store)
 * @param {object|string} connectionOrNeumaId - a portal connection (companion.neumaId, walletAddress) or a neumaId
 * @returns {{sessionId: string, clip: Buffer, clipRef: string, words: string, sampleRate: number, audition: true}|null}
 */
export const resolveAuditionVoice = (connectionOrNeumaId) => {
  const byId = typeof connectionOrNeumaId === 'string';
  const neumaId = byId ? connectionOrNeumaId : connectionOrNeumaId?.companion?.neumaId;
  if (!neumaId) return null;
  const session = forgeSessionFor(neumaId);
  if (!session?.pinned) return null;
  const wallet = byId ? null : connectionOrNeumaId.walletAddress;
  if (wallet && String(wallet).toLowerCase() !== session.wallet) return null;
  const take = takeOf(session, session.pinned);
  return Object.freeze({
    sessionId: session.id,
    clip: take.wav,
    clipRef: take.ref,
    words: take.words,
    sampleRate: take.sampleRate,
    audition: true,
  });
};
