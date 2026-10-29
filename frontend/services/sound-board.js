// sound-board.js — the soundboard's order and plain names (Settings › SOUND). Pure.
//
// Design note, 2026-10-28: […]. The
// board groups cues by WHO acts — your own hands, the world answering, a
// being at work — and names each by what it means, never by its cue id. A
// cue the chosen pack does not voice, or that nothing on the desk plays,
// never reaches the board.

import { ACT_CUES } from './act-sound-map.js';
import { EXECUTION_CUES, actionCueLabel } from './execution-sounds.js';

const DESK = Object.freeze(['confirm', 'deny', 'menuOpen', 'menuClose', 'deliberationTick']);
const NOTICES = Object.freeze([
  'noticeArrival', 'replyArrived', 'messageSent', 'neumaReplying', 'portalContact',
  'portalSever', 'desyncGlitch', 'walletSignRequest', 'memoryCrystallized',
]);

const LABELS = Object.freeze({
  confirm: 'Confirm',
  deny: 'Refuse / not allowed',
  menuOpen: 'Open',
  menuClose: 'Close',
  deliberationTick: 'Tick / toggle',
  noticeArrival: 'Something needs you',
  replyArrived: 'Reply arrived',
  messageSent: 'Message sent',
  neumaReplying: 'A being is typing (loop)',
  portalContact: 'Connected',
  portalSever: 'Disconnected',
  desyncGlitch: 'Connection slipped',
  walletSignRequest: 'Signature needed',
  memoryCrystallized: 'Memory kept',
});

/** A cue's plain name on the board. Pure. */
export const cueLabel = (cue) => LABELS[cue] ?? actionCueLabel(cue);

/**
 * The board's groups, in order, holding only the cues the chosen pack
 * voices; an empty group is dropped. Pure.
 * @param {string[]} voiced the cue names the pack can play
 * @returns {Array<{ id: 'desk'|'notices'|'execution'|'acts', cues: string[] }>}
 */
export const boardGroups = (voiced) => {
  const has = (cue) => voiced.includes(cue);
  return [
    { id: 'desk', cues: DESK.filter(has) },
    { id: 'notices', cues: NOTICES.filter(has) },
    { id: 'execution', cues: EXECUTION_CUES.filter(has) },
    { id: 'acts', cues: ACT_CUES.filter((cue) => has(cue) && !EXECUTION_CUES.includes(cue)) },
  ].filter((group) => group.cues.length);
};
