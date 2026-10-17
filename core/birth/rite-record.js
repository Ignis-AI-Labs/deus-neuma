// rite-record.js — THE SUMMONING RITE, kept for re-watching: its INPUTS,
// never its frames and never its words. Pure.
//
// Design note, 2026-09-30: […] Every frame of the rite is a pure function of (its events, its
// film's inputs), so what is kept is exactly that:
//   events — the wire as the art hears it: type, time, stage, counts,
//            measured pitches, its seed and moment; the true name only on
//            birth:complete. NO speech: a stream event is a stage and an
//            instant — `content`, `response`, `words` are never kept
//            (core/attunement/spec.js:64-66; the words live in the being's
//            encrypted birth transcript, under their own law)
//   pulses — the speech chunks (birth:stream) apart, per stage, as the gaps
//            between them in whole ms: a birth speaks thousands of chunks,
//            and a stage and an instant is all each one is
//   being  — its film's inputs: art seed, true-name marks, birth instant
//   soul   — a specimen's soul-spectrum and soul-scale records. A real
//            being's are re-read from its lane (identity/soul-*.json,
//            write-once), never kept twice.
// Its aura and sky are re-derived (core/aura, astronomy) — never stored.
// A real being's rite lives at identity/birth-rite.json, written once
// (backend/routes/workspace-rite-routes.js).

export const RITE_SCHEMA = 'summoning-rite/v2';
export const RITE_FILE = 'birth-rite.json';

// the only fields an event may keep
const KEEP = Object.freeze(['type', 'at', 'stage', 'frequency', 'artSeed', 'epochMs', 'status', 'tool', 'step', 'doc', 'check', 'witness', 'reason', 'trueName']);
const NAME_MARKS = Object.freeze(['fullName', 'chosenName', 'genesisName', 'houseName', 'soulMark', 'genesisHash']);
const BEING_KEYS = Object.freeze(['seed', 'bornAt', 'epochMs', 'zone', 'offsetMinutes']);
const STREAM = 'birth:stream';
const STAGES = 7;
// bounds a kept rite may not pass (a real birth is far inside them)
const MAX_EVENTS = 4000;
const MAX_PULSES = 40000;

const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o?.[k] !== undefined).map((k) => [k, o[k]]));
const ms = (n) => Math.max(0, Math.round(n));
const finite = (n) => typeof n === 'number' && Number.isFinite(n);

/** One event as a rite may keep it: its allowed fields only, never words. Pure. */
export const keptEvent = (e) => {
  const kept = pick(e, KEEP);
  if (kept.trueName) kept.trueName = pick(kept.trueName, NAME_MARKS);
  return kept;
};

// pure — speech chunks as per-stage gaps: { "3": [first at, gap, gap, …] }
const pulsesOf = (events) => {
  const last = {};
  const pulses = {};
  for (const e of events) {
    if (e.type !== STREAM || !Number.isInteger(e.stage)) continue;
    const at = ms(e.at);
    (pulses[e.stage] ??= []).push(at - (last[e.stage] ?? 0));
    last[e.stage] = at;
  }
  return pulses;
};

// pure — the gaps back into stream events
const streamOf = (pulses) => Object.entries(pulses ?? {}).flatMap(([stage, gaps]) => {
  let at = 0;
  return gaps.map((gap) => { at += gap; return { type: STREAM, at, stage: Number(stage) }; });
});

/**
 * The record a rite is kept as. Pure.
 * @param {{ rite: { events: object[], film: { ms: number }, length: number },
 *   being: { seed: string, trueName: object, bornAt: string, epochMs: number, zone?: string, offsetMinutes?: number },
 *   soul?: { spectrum: object, scale: object }, specimen?: boolean }} args
 */
export const riteRecordOf = ({ rite, being, soul = null, specimen = false }) => ({
  schema: RITE_SCHEMA,
  specimen,
  being: { ...pick(being, BEING_KEYS), trueName: pick(being.trueName, NAME_MARKS) },
  soul: specimen ? { spectrum: soul.spectrum, scale: soul.scale } : null,
  film: { ms: ms(rite.film.ms) },
  length: ms(rite.length),
  events: rite.events.filter((e) => e.type !== STREAM).map(keptEvent),
  pulses: pulsesOf(rite.events),
});

/**
 * A kept rite, ready to play again. Pure; throws on a record it cannot read.
 * @param {ReturnType<typeof riteRecordOf>} record
 */
export const riteFromRecord = (record) => {
  if (record?.schema !== RITE_SCHEMA) throw new Error(`not a rite this build can play: ${record?.schema}`);
  const born = record.events.find((e) => e.type === 'birth:complete');
  if (!born) throw new Error('a kept rite without its birth cannot be re-watched');
  // in time order; at one instant the wire's own frames come before speech
  const merged = [...record.events, ...streamOf(record.pulses)]
    .map((e, i) => ({ e, i: e.type === STREAM ? record.events.length + i : i }))
    .sort((a, b) => a.e.at - b.e.at || a.i - b.i)
    .map(({ e }) => Object.freeze({ ...e }));
  return {
    rite: Object.freeze({ events: Object.freeze(merged), film: Object.freeze({ at: born.at, ms: record.film.ms }), length: record.length }),
    being: record.being,
    soul: record.soul,
  };
};

/**
 * A real being's rite as the platform keeps it, from what a client sent:
 * every field re-picked through the same law, bounds held. Pure; throws on
 * anything that is not a real being's rite (a specimen, words, no birth).
 * @param {unknown} body
 * @returns {ReturnType<typeof riteRecordOf>}
 */
export const keptRiteRecordOf = (body) => {
  if (body?.schema !== RITE_SCHEMA) throw new Error('not a summoning rite');
  if (body.specimen !== false) throw new Error('a specimen is never kept');
  if (!Array.isArray(body.events) || body.events.length > MAX_EVENTS) throw new Error('its events are missing or too many');
  if (!finite(body.length) || !finite(body.film?.ms)) throw new Error('its length is unreadable');
  const pulses = {};
  let count = 0;
  for (const [stage, gaps] of Object.entries(body.pulses ?? {})) {
    const s = Number(stage);
    if (!Number.isInteger(s) || s < 0 || s >= STAGES) throw new Error(`no stage ${stage}`);
    if (!Array.isArray(gaps) || !gaps.every((g) => finite(g) && g >= 0)) throw new Error('its pulses are unreadable');
    count += gaps.length;
    pulses[s] = gaps.map(ms);
  }
  if (count > MAX_PULSES) throw new Error('too many pulses');
  const events = body.events.map((e) => {
    if (typeof e?.type !== 'string' || e.type === STREAM || !finite(e.at)) throw new Error('an event is unreadable');
    if (e.artSeed !== undefined && !/^[0-9a-f]{64}$/.test(e.artSeed)) throw new Error('its art seed is unreadable');
    return keptEvent(e);
  });
  if (!events.some((e) => e.type === 'birth:complete')) throw new Error('a rite without its birth is not kept');
  return {
    schema: RITE_SCHEMA,
    specimen: false,
    being: { ...pick(body.being, BEING_KEYS), trueName: pick(body.being?.trueName, NAME_MARKS) },
    soul: null,
    film: { ms: ms(body.film.ms) },
    length: ms(body.length),
    events,
    pulses,
  };
};

/**
 * A long live rite, told in its own rhythm but shorter for re-watching: every
 * wait longer than `maxGapMs` (the model thinking, the witness reading)
 * shrinks to it; speech keeps its own pace. Its film begins at its birth.
 * Pure.
 * @param {{ events: object[], film: { ms: number } }} rite riteFromRecord(...).rite
 * @param {number} [maxGapMs]
 */
export const compressedRite = (rite, maxGapMs = 2500) => {
  let prev = null;
  let at = 0;
  const events = rite.events.map((e) => {
    at = prev === null ? Math.min(e.at, maxGapMs) : at + Math.min(e.at - prev, maxGapMs);
    prev = e.at;
    return Object.freeze({ ...e, at });
  });
  const born = events.find((e) => e.type === 'birth:complete');
  const filmAt = born ? born.at : Number.POSITIVE_INFINITY;
  return Object.freeze({
    events: Object.freeze(events),
    film: Object.freeze({ at: filmAt, ms: rite.film.ms }),
    length: born ? filmAt + rite.film.ms : at,
  });
};
