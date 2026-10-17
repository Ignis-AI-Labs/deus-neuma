// Semantic ACT sound — a being's hands are audible, and each kind of act
// sounds like itself. The pure act→cue vocabulary lives in act-sound-map.js;
// this is the one impure line that plays it.
//
// Shaped like files-refresh.js on purpose: both take a raw `tool:usage` /
// `council:tool` frame and decide one thing about it, so the one-on-one portal
// and the council room share a rule instead of drifting apart.

import { playSound } from './sound-engine.js';
import { cueForAct } from './act-sound-map.js';

// impure — voice one act frame; a frame that warrants no cue stays silent
// (sound is ornament, never load-bearing), so callers can hand it every frame.
export const soundAct = (frame) => {
  const cue = cueForAct(frame);
  if (cue) playSound(cue);
};
