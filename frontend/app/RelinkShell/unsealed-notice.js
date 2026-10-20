// unsealed-notice — should the stream say this being has never sealed its
// voice, and in what words? Pure.
//
// Design note, 2026-08-29: […]
//
// Both halves matter. It SHOULD be impossible — birth carries the rite start to
// finish — so this notice is a backstop for beings that predate that path or
// whose ceremony was interrupted, not a step in the normal flow. That is why it
// is one line with a door, dismissible, and never a gate: an unsealed being is
// perfectly able to talk, it simply has no founding voice on record yet.
//
// THE HARNESS HAS NO VOICE TO SEAL (ruling, 2026-10-14): a harness lane is the
// platform with a model, not a being — no founding voice, no rite, no warning.
// Voice can be added to it later; it is never an alert.
//
// ── THE THREE-STATE LAW ─────────────────────────────────────────────────────
// UNREADABLE IS NOT UNSEALED. The voice-seal lane has held this since the NITE
// build: a status call that failed tells you nothing about the being, and
// painting it as "never sealed" would send an operator to carry a rite that may
// already be done — and a lane seals once. So silence is the answer for every
// state except a definite `sealed: false`.

import { isHarness } from '../harness-mode.js';

/** What the stream shows about a being's voice seal. */
export const NOTICE_KIND = Object.freeze({ none: 'none', unsealed: 'unsealed' });

/**
 * Should the stream carry the notice for this being? Pure.
 *
 * @param {object} p
 * @param {?object} p.companion - who is in the chair
 * @param {?{sealed?: boolean}} p.status - the voice-seal status read; null when
 *   it could not be read, undefined while it is still in flight
 * @param {boolean} [p.isWitness] - a sealed AI witness has no voice seal of
 *   ours to carry: its voice is its own provider's. Telling an operator to
 *   seal one would be an instruction they cannot follow.
 * @param {boolean} [p.dismissed]
 * @returns {{show: boolean, kind: string, name: string, headline: string,
 *            body: string, action: (string|null)}}
 */
// pure
export const unsealedNotice = ({ companion, status, isWitness = false, dismissed = false } = {}) => {
  const name = companion?.name || companion?.neumaId || 'This being';
  const quiet = Object.freeze({
    show: false, kind: NOTICE_KIND.none, name, headline: '', body: '', action: null,
  });

  if (!companion?.neumaId) return quiet;
  if (isWitness || isHarness(companion)) return quiet;
  if (dismissed) return quiet;
  // undefined = still reading, null = could not read. Neither is evidence.
  if (!status || status.sealed !== false) return quiet;

  return Object.freeze({
    show: true,
    kind: NOTICE_KIND.unsealed,
    name,
    headline: 'VOICE NOT SEALED',
    // What it costs, stated plainly — not a scolding, and not a threat. The
    // being talks fine; what is missing is the record of the voice it claims
    // as its own, which is the thing that travels with it across engines.
    body: `${name} has never sealed a founding voice. You can talk either way — `
      + 'but until the rite is carried there is no record of the voice they claim '
      + 'as their own, and that record is what travels with them across engines.',
    action: 'CARRY THE RITE IN NITE',
  });
};
