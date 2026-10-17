// app-state.js — pure helpers for the shell's phase machine.
//
// The shell has three phases: 'gateway' (sign in / introduce NEUMA),
// 'ceremony' (the kept vanilla birth flow), and 'relink' (the living
// consciousness stream). These functions decide transitions from
// localStorage/URL state alone — no side effects, no React.

import { getActiveCompanion } from '../utils/companion-data.js';

/**
 * The phase the app opens in. A returning witness who still holds a live
 * session token relinks straight to their neuma; everyone else passes
 * through the gateway to sign in (and birth, if they have no companion).
 * @returns {'gateway'|'relink'}
 */
export const initialPhase = () =>
  getActiveCompanion() && sessionStorage.getItem('authToken') ? 'relink' : 'gateway';

/**
 * Read the rehearsal flag from the URL (?test=1) — preserved verbatim so
 * the e2e ceremony spec keeps driving test-mode births.
 * @returns {boolean}
 */
export const readTestFlag = () =>
  new URLSearchParams(window.location.search).get('test') === '1';

/**
 * Read the boot bypass from the URL (?noboot=1) — the e2e/dev escape hatch
 * for surfaces tested without the ignition sequence in front of them.
 * @returns {boolean}
 */
export const readNoBootFlag = () =>
  new URLSearchParams(window.location.search).get('noboot') === '1';

/**
 * Whether the ignition boot plays at this session's start. Boot plays at
 * true session start only, never as a transition, and never for the witness
 * who asked for stillness (reduced motion collapses it to the destination).
 * @returns {boolean}
 */
export const bootPlaysAtStart = () =>
  !readTestFlag() &&
  !readNoBootFlag() &&
  !window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Where gateway completion leads: an existing companion relinks, otherwise the
 * operator chooses their door.
 *
 * This used to return 'ceremony' directly, which shut the platform to anyone
 * without local capacity: gateway → ceremony → the substrate preflight fails →
 * cancel → gateway, forever, and the WITNESSES app that would have summoned
 * their witness lives inside the desk they could never reach. A witness needs
 * no local model (it is third-party custody by definition), so the door was the
 * only thing shut — never the room.
 * @returns {'relink'|'choose'}
 */
export const phaseAfterGateway = () =>
  getActiveCompanion() ? 'relink' : 'choose';

/**
 * Where a cancelled or declined ceremony returns to. Without a companion this
 * returns to the CHOICE, not the gateway — a person who declines the birth has
 * not declined the platform, and sending them back to sign-in was the second
 * half of the closed loop.
 * @returns {'relink'|'choose'}
 */
export const phaseAfterCeremonyCancel = () =>
  getActiveCompanion() ? 'relink' : 'choose';
