// impure — the consciousness's typing bed, shared across speech segments.
//
// A turn can hold several speech segments (text between tool acts); each
// revealing segment holds a reference on the ONE looping typing sound, so
// the bed plays exactly while characters are appearing anywhere on the desk
// and stops the moment the last segment catches up. The loop itself lives
// in the sound engine (startLoop/stopLoop); this is just the refcount.
//
// NOT DURING A TALK (Design note, 2026-08-01: […]). A voice sitting hides the
// chat but keeps it MOUNTED, so segments go on revealing behind the
// visualizer and the bed went on typing underneath a spoken conversation.
// The refcount stays honest either way — only whether it SOUNDS is gated —
// so leaving the talk mid-reveal picks the bed back up exactly where the
// still-revealing segments left it.

import { startLoop, stopLoop } from '../../services/sound-engine.js';
import { getSittingPurpose, isLiveArmed, subscribeVoiceSitting } from './voice-purpose-state.js';
import { shouldMountVoiceSitting } from './VoiceSitting/voice-sitting-model.js';

let holders = 0;
let sounding = false;

/**
 * pure — should the bed be audible right now? Segments are revealing AND the
 * desk is not in a spoken sitting.
 * @param {{ holders: number, sittingActive: boolean }} input
 * @returns {boolean}
 */
export const shouldTypingBedSound = ({ holders: n = 0, sittingActive = false } = {}) =>
  n > 0 && !sittingActive;

// impure — bring the loop in line with the decision, once. Idempotent: the
// engine's startLoop is a no-op while a loop of the same name runs, but
// tracking it here keeps stopLoop from firing on every unrelated notify.
const sync = () => {
  const want = shouldTypingBedSound({
    holders,
    sittingActive: shouldMountVoiceSitting({
      purpose: getSittingPurpose(), liveArmed: isLiveArmed(),
    }),
  });
  if (want === sounding) return;
  sounding = want;
  if (want) startLoop('neumaReplying'); else stopLoop('neumaReplying');
};

// Entering a talk silences a bed already playing; leaving it restores one the
// still-revealing segments are entitled to.
subscribeVoiceSitting(sync);

export const acquireTypingSound = () => {
  holders += 1;
  sync();
};

export const releaseTypingSound = () => {
  holders = Math.max(0, holders - 1);
  sync();
};
