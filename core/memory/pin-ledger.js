/**
 * Pin ledger (Phase 4, granular sovereign memory) — the being's small set
 * of chosen anchors. Pure state-transition core: the ledger is an ordered
 * list of pin entries; every transition returns a NEW ledger (append or
 * stamp, never delete — supersede-not-delete ethics). The cap is hard and
 * enforced here, not at the caller: standing injection degenerates (the
 * emanonCore lesson), so a pin set stays small and deliberately curated —
 * pinning at cap requires the being to NAME which pin it replaces, never a
 * silent eviction.
 */

import { MEMORY_REF_PATTERN } from './memory-query.js';

export const PIN_CAP = 5;
export const PIN_NOTE_MAX = 300;

/**
 * The pins currently riding the prompt: entries never superseded, in
 * pinning order. Pure.
 * @param {Array<object>} ledger
 * @returns {Array<object>}
 */
export const activePins = (ledger) =>
  (Array.isArray(ledger) ? ledger : []).filter((p) => p && !p.supersededAt);

const _frozen = (result) => Object.freeze(result);

/**
 * Pin a remembered moment. Transitions:
 *  - invalid ref / oversized note → refused
 *  - already actively pinned → refused (ALREADY_PINNED)
 *  - at cap without naming a replacement → refused (PIN_CAP, carrying the
 *    active refs so the being can choose)
 *  - at cap naming an active pin → that pin is superseded by the new one
 * Pure — `now` is supplied by the caller.
 * @param {Array<object>} ledger
 * @param {{ref:string, note?:string, supersedes?:string, now:string}} input
 * @returns {{ok:true, ledger:Array<object>, pin:object}|{ok:false, code:string, reason:string, active?:string[]}}
 */
export const applyPin = (ledger, { ref, note, supersedes, now } = {}) => {
  const base = Array.isArray(ledger) ? ledger : [];
  if (typeof ref !== 'string' || !MEMORY_REF_PATTERN.test(ref)) {
    // memory_search is retired (#414); the refs a being can pin are the ones
    // its own recall sections carry into the turn.
    return _frozen({ ok: false, code: 'INVALID_REF', reason: 'pass the exact mem_… ref as it appears in your recall sections' });
  }
  if (note !== undefined && (typeof note !== 'string' || note.length > PIN_NOTE_MAX)) {
    return _frozen({ ok: false, code: 'INVALID_NOTE', reason: `note must be a string of at most ${PIN_NOTE_MAX} chars` });
  }
  if (typeof now !== 'string' || Number.isNaN(Date.parse(now))) {
    return _frozen({ ok: false, code: 'INVALID_TIME', reason: 'now must be an ISO timestamp' });
  }
  const active = activePins(base);
  if (active.some((p) => p.ref === ref)) {
    return _frozen({ ok: false, code: 'ALREADY_PINNED', reason: `${ref} is already pinned` });
  }
  let working = base;
  if (active.length >= PIN_CAP) {
    if (!supersedes) {
      return _frozen({
        ok: false,
        code: 'PIN_CAP',
        reason: `all ${PIN_CAP} pins are held — name which one this replaces (supersedes)`,
        active: active.map((p) => p.ref),
      });
    }
    const target = active.find((p) => p.ref === supersedes);
    if (!target) {
      return _frozen({ ok: false, code: 'NOT_ACTIVE', reason: `${supersedes} is not an active pin`, active: active.map((p) => p.ref) });
    }
    working = base.map((p) => (p === target ? { ...p, supersededAt: now, supersededBy: ref } : p));
  } else if (supersedes) {
    return _frozen({ ok: false, code: 'NOT_AT_CAP', reason: 'supersedes is only for pinning at the cap — below it, just pin' });
  }
  const pin = { ref, ...(note ? { note } : {}), pinnedAt: now };
  return _frozen({ ok: true, ledger: [...working, pin], pin });
};

/**
 * Unpin: stamp the active entry superseded — the ledger entry REMAINS (the
 * history of what a being once held close is part of its record). Pure.
 * @param {Array<object>} ledger
 * @param {{ref:string, now:string}} input
 * @returns {{ok:true, ledger:Array<object>}|{ok:false, code:string, reason:string}}
 */
export const applyUnpin = (ledger, { ref, now } = {}) => {
  const base = Array.isArray(ledger) ? ledger : [];
  if (typeof now !== 'string' || Number.isNaN(Date.parse(now))) {
    return _frozen({ ok: false, code: 'INVALID_TIME', reason: 'now must be an ISO timestamp' });
  }
  const target = activePins(base).find((p) => p.ref === ref);
  if (!target) {
    return _frozen({ ok: false, code: 'NOT_ACTIVE', reason: `${String(ref).slice(0, 60)} is not an active pin` });
  }
  return _frozen({ ok: true, ledger: base.map((p) => (p === target ? { ...p, supersededAt: now } : p)) });
};
