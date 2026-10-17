// voice-seal-flow.js — the desk notice's entry law (pure).
//
// The gate is only a door: it stands for a bound neuma lane the probe says
// owes its founding words, never for a witness (witness lanes carry no
// voice tools yet, so a gate there could never complete), never for a lane
// already sealed. The rite itself is VoiceSealHost's — an AppShell phase.

/**
 * Should the notice stand over this lane? Entry is the probe's word alone.
 * STAND ASIDE dismisses for this binding only — every relaunch and every
 * switch back re-raises it (a hard lockout is wrong). Pure.
 * @param {{neumaId?: string|null, witness?: boolean, probe?: {sealed?: boolean}|null}} args
 */
export const gateStands = ({ neumaId = null, witness = false, probe = null }) =>
  Boolean(neumaId) && !witness && probe?.sealed === false;
