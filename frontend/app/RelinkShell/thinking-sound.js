// impure — the thinking loop: the being is working on its answer and nothing is appearing yet.
//
// Design note, 2026-11-19: […]
// It is his own sound (frontend/sounds-own/thinking.wav, cue `neumaThinking`). It plays from the moment a turn is
// sent until the being's words start to appear, and again whenever its reasoning is streaming (the thought bubble).
// The desk plays one loop at a time (desk-loops.js): it gives way to the typing bed (typing-sound.js) and to the
// making-an-image loop (render-sound.js), never flip-flopping with them, and like the typing
// bed it stays silent during a spoken sitting (Design note, 2026-08-01: no desk sounds under a conversation).
// Each chat that is thinking holds one reference, so one loop plays however many chats are thinking.

import { wantLoop } from './desk-loops.js';
import { getSittingPurpose, isLiveArmed, subscribeVoiceSitting } from './voice-purpose-state.js';
import { shouldMountVoiceSitting } from './VoiceSitting/voice-sitting-model.js';

/**
 * pure — is this chat thinking right now: the turn was sent and nothing has come back yet, or the reply in
 * progress is in a stretch of reasoning (its newest part is a thought).
 * @param {{thinking?: boolean, messages?: Array<{streaming?: boolean, segments?: Array<{kind: string}>}>}} state
 */
export const isThinkingNow = (state) => {
  if (state?.thinking) return true;
  const live = (state?.messages ?? []).filter((m) => m?.streaming).at(-1);
  return live?.segments?.at(-1)?.kind === 'thought';
};

/** pure — is the loop wanted: some chat is thinking and no talk is open (the desk decides whether it sounds). */
export const shouldThinkingSound = ({ holders = 0, sittingActive = false } = {}) => holders > 0 && !sittingActive;

let holders = 0;
let sounding = false;

const sync = () => {
  const want = shouldThinkingSound({
    holders,
    sittingActive: shouldMountVoiceSitting({ purpose: getSittingPurpose(), liveArmed: isLiveArmed() }),
  });
  if (want === sounding) return;
  sounding = want;
  wantLoop('neumaThinking', want);
};

subscribeVoiceSitting(sync);

export const acquireThinkingSound = () => { holders += 1; sync(); };
export const releaseThinkingSound = () => { holders = Math.max(0, holders - 1); sync(); };
