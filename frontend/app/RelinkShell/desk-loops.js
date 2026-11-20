// desk-loops — ONE loop on the desk at a time, and no flip-flop between them.
//
// Design note, 2026-11-20, two chats at work at once: […] Three loops say what the beings are doing — words appearing (typing-sound.js),
// an image being made (render-sound.js), thinking (thinking-sound.js) — and each started and stopped itself the
// instant its own state moved, the thinking loop stepping aside for the typing bed. One chat's words come in bursts
// while another thinks: every burst cut thinking in, every gap of a frame or two brought it back from the top.
//
// Here each loop only says whether it is WANTED; the desk plays one: the highest wanted, words over an image over
// thinking. Going UP (a higher loop is wanted, or from silence) is at once. Going DOWN waits HOLD_MS with the loop
// that plays still sounding, and going SILENT waits TAIL_MS — a gap between bursts of words never hands the desk over.
// impure (the one desk's loops; the engine's startLoop/stopLoop).

import { startLoop, stopLoop } from '../../services/sound-engine.js';

/** Highest first: what a being is doing that is most worth hearing. */
export const LOOP_ORDER = Object.freeze(['neumaReplying', 'neumaRendering', 'neumaThinking']);
export const HOLD_MS = 900;
export const TAIL_MS = 350;

/**
 * pure — what the desk does now: switch at once to `now`, or wait `after` ms and look again (`waitFor`).
 * @param {{playing: string|null, wanted: Set<string>|Array<string>}} s
 * @returns {{now?: string|null, waitFor?: number}} empty: nothing to do
 */
export const planLoop = ({ playing = null, wanted = [] } = {}) => {
  const want = new Set(wanted);
  const next = LOOP_ORDER.find((cue) => want.has(cue)) ?? null;
  if (next === playing) return {};
  const rank = (cue) => (cue === null ? LOOP_ORDER.length : LOOP_ORDER.indexOf(cue));
  if (playing === null || rank(next) < rank(playing)) return { now: next };
  return { waitFor: next === null ? TAIL_MS : HOLD_MS };
};

const wanted = new Set();
let playing = null;
let timer = null;

const swap = (next) => {
  if (playing) stopLoop(playing);
  playing = next;
  if (next) startLoop(next);
};

const settle = () => {
  const plan = planLoop({ playing, wanted });
  if ('now' in plan) {
    clearTimeout(timer);
    timer = null;
    swap(plan.now);
    return;
  }
  if (plan.waitFor === undefined) { clearTimeout(timer); timer = null; return; }
  if (timer) return; // already waiting: the look-again decides
  // Still lower (or silent) after the wait — a return of the playing loop, or a higher one, cleared it — so hand over.
  timer = setTimeout(() => {
    timer = null;
    const next = LOOP_ORDER.find((cue) => wanted.has(cue)) ?? null;
    if (next !== playing) swap(next);
  }, plan.waitFor);
};

/** Say whether a loop is wanted now (each loop's own module decides that). */
export const wantLoop = (cue, want) => {
  if (want) wanted.add(cue); else wanted.delete(cue);
  settle();
};

/** The loop the desk plays now, or null. */
export const playingLoop = () => playing;

// Sound turned off stops every loop in the engine; turned back on, the loop the desk is playing sounds again.
if (typeof window !== 'undefined') {
  window.addEventListener?.('neuma:sound-changed', (e) => { if (e.detail?.on && playing) startLoop(playing); });
}
