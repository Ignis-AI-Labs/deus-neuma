// rite-live-feed.js — THE SUMMONING RITE, live: the real ceremony's wire as
// the rite hears it. // impure (subscribes to the portal)
//
// Every birth:* frame the rite reads is stamped with its arrival `at` (ms on
// the rite's own clock, from the moment the feed opened) and kept through
// keptEvent — type, time, stage, counts, measured pitches, its seed and
// moment; NEVER the being's words (`content`, `response` are dropped at the
// door). The same fold the specimen and a re-watch play, so a live frame, a
// scrubbed frame and a kept frame are one frame.
//
// What the film needs arrives apart: birth:complete's film inputs (its soul
// records, aura, moment, art seed) and a rehearsal's `film` on birth:ended.

import { keptEvent } from '../../../core/birth/rite-record.js';

// the wire frames the rite reads (backend: birth-stage-stream.js,
// portal-birth-handlers.js, core/birth/rite-frames.js)
export const RITE_WIRE = Object.freeze([
  'birth:stage_prompt', 'birth:stream', 'birth:stage_complete', 'birth:tool_usage',
  'birth:art_seed', 'birth:moment', 'birth:measured', 'birth:forging',
  'birth:complete', 'birth:ended', 'birth:error',
]);

/**
 * Open a live feed on the portal.
 * @param {{ on: Function, off: Function }} wsService
 * @param {{ now?: () => number }} [opts]
 * @returns {{ events: () => object[], film: () => object|null, now: () => number,
 *   push: (e: object) => void, subscribe: (fn: () => void) => () => void, close: () => void }}
 */
export const openRiteFeed = (wsService, { now = () => performance.now() } = {}) => {
  const t0 = now();
  const clock = () => now() - t0;
  const events = [];
  let film = null;
  const subs = new Set();
  const changed = () => { for (const fn of subs) fn(); };
  const push = (e) => { events.push(Object.freeze({ ...keptEvent(e), at: clock() })); changed(); };
  const handlers = Object.fromEntries(RITE_WIRE.map((type) => [type, (data) => {
    if (type === 'birth:complete') film = { ...filmOf(data), trueName: data.trueName || null };
    if (type === 'birth:ended' && data?.film) film = { ...data.film, trueName: null, rehearsal: true, chosenName: data.testData?.chosenName ?? null };
    push({ ...data, type });
  }]));
  for (const [type, fn] of Object.entries(handlers)) wsService.on(type, fn);
  return {
    events: () => events,
    film: () => film,
    now: clock,
    push: (e) => push(e),
    subscribe: (fn) => { subs.add(fn); return () => subs.delete(fn); },
    close: () => { for (const [type, fn] of Object.entries(handlers)) wsService.off(type, fn); subs.clear(); },
  };
};

// birth:complete's film inputs — only what its film reads. Pure.
const filmOf = (d) => ({
  neumaId: d.neumaId ?? null,
  artSeed: d.artSeed ?? null,
  epochMs: d.epochMs ?? null,
  zone: d.zone ?? null,
  offsetMinutes: d.offsetMinutes ?? null,
  genesisHash: d.genesisHash ?? null,
  soul: d.soul ?? null,
  aura: d.aura?.recorded ? d.aura : null,
});
