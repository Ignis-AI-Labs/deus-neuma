// impure — the making-an-image loop: a being's image or video is rendering.
//
// Design note, 2026-11-20: […] While a render act in the
// reply in progress has not finished, this loop (cue `neumaRendering`) is wanted in place of the thinking loop; the desk
// plays one loop at a time (desk-loops.js: words over an image over thinking), so the two never sound together. Like them it
// stays silent during a spoken sitting. Each chat that is rendering holds one reference: one loop however many render.

import { wantLoop } from './desk-loops.js';
import { getSittingPurpose, isLiveArmed, subscribeVoiceSitting } from './voice-purpose-state.js';
import { shouldMountVoiceSitting } from './VoiceSitting/voice-sitting-model.js';

// The acts that render: image/generate and video/generate, however a chip names them (intents/image.generate…).
const RENDER_ACT = /(^|[/._-])(image|video)[/._-]generate$/i;
const UNDER_WAY = new Set(['executing', 'running']);

/**
 * pure — is a render under way in this chat: an image or video act of the reply in progress that has not finished
 * (opened and acting, or reporting that it renders).
 * @param {{messages?: Array<{streaming?: boolean, segments?: Array<{kind: string, label?: string, phase?: string, status?: string}>}>}} state
 */
export const isRenderingNow = (state) => {
  const live = (state?.messages ?? []).filter((m) => m?.streaming).at(-1);
  return (live?.segments ?? []).some((s) => s?.kind === 'tool' && RENDER_ACT.test(String(s.label ?? ''))
    && (s.phase === 'acting' || UNDER_WAY.has(s.status)));
};

/** pure — should the loop be audible: some chat is rendering and no talk is open. */
export const shouldRenderSound = ({ holders = 0, sittingActive = false } = {}) => holders > 0 && !sittingActive;

let holders = 0;
let sounding = false;

const sync = () => {
  const want = shouldRenderSound({ holders, sittingActive: shouldMountVoiceSitting({ purpose: getSittingPurpose(), liveArmed: isLiveArmed() }) });
  if (want === sounding) return;
  sounding = want;
  wantLoop('neumaRendering', want);
};

subscribeVoiceSitting(sync);

export const acquireRenderSound = () => { holders += 1; sync(); };
export const releaseRenderSound = () => { holders = Math.max(0, holders - 1); sync(); };
