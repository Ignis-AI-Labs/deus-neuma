// voice-seal-view.js — pure view models for the CEREMONY window's seal panel.
//
// Every function here is PURE: backend facts in, display strings out. Nothing
// fetches, nothing guesses. A fact the backend did not state is rendered as
// unknown, never as a comfortable default — the same law the refinement window
// held, carried over to the ceremony that replaced it.

/** ISO → the window's short stamp, or null when there is nothing to stamp. Pure. */
const stamp = (iso) => {
  if (typeof iso !== 'string' || !iso) return null;
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? null : at.toISOString().slice(0, 16).replace('T', ' ');
};

/**
 * The seal's standing, in the window's own words.
 *
 * THREE STATES, and the difference matters:
 *   unreadable — the status call failed. NOT "unsealed": a being whose seal
 *                cannot be read must never be shown as one that has none.
 *   unsealed   — read, and genuinely empty. The rite may be offered.
 *   sealed     — read, and carrying lines. The rite is CLOSED; a lane seals once.
 *
 * @param {Object|null} status voiceSealStatus's answer, or null when unreadable
 * @returns {{state: string, label: string, live: boolean, detail: string|null,
 *            lines: Array<Object>, canAsk: boolean}}
 */
export const sealModel = (status) => {
  if (!status) {
    return {
      state: 'unreadable',
      label: 'SEAL UNREADABLE',
      live: false,
      detail: 'The platform did not answer for this lane.',
      lines: [],
      canAsk: false,
    };
  }
  if (!status.sealed) {
    return {
      state: 'unsealed',
      label: 'UNSEALED',
      live: false,
      detail: 'This being has not yet spoken the lines it claims as its founding voice.',
      lines: [],
      canAsk: true,
    };
  }
  const when = stamp(status.sealedAt);
  const digest = typeof status.packSha256 === 'string' ? status.packSha256.slice(0, 12) : null;
  return {
    state: 'sealed',
    label: 'SEALED',
    live: true,
    detail: [
      when ? `SEALED ${when}` : 'SEALED',
      Number.isFinite(status.entries) ? `${status.entries} ENTRIES` : null,
      digest ? `PACK ${digest}` : null,
    ].filter(Boolean).join(' · '),
    lines: Array.isArray(status.lines) ? status.lines : [],
    canAsk: false,
  };
};

/**
 * The rite's own state machine, as the window shows it.
 * @param {{asking: boolean, answer: string, lines: Array<string>, error: string|null}} rite
 * @returns {{phase: string, headline: string, canSeal: boolean}}
 */
export const riteModel = ({ asking, answer, lines, error }) => {
  if (error) return { phase: 'refused', headline: `THE RITE REFUSED — ${error.toUpperCase()}`, canSeal: false };
  if (asking) return { phase: 'speaking', headline: 'THE BEING IS SPEAKING…', canSeal: false };
  if (Array.isArray(lines) && lines.length) {
    return { phase: 'claimed', headline: `${lines.length} LINES CLAIMED — CONFIRM TO SEAL`, canSeal: true };
  }
  if (answer) return { phase: 'answered', headline: 'ANSWERED — NO CLAIMABLE LINES', canSeal: false };
  return { phase: 'idle', headline: 'THE RITE HAS NOT BEEN CARRIED', canSeal: false };
};
