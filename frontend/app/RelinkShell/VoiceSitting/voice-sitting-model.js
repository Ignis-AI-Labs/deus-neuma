// voice-sitting-model.js — the PURE view-model of the voice sitting (F-03/F-04).
//
// Every decision the immersion shell makes is computed here from defined
// inputs, frozen on the way out, and free of IO — the taps (mic RMS, playback
// RMS, the rAF clock) live in the impure components that call these.
//
// pure — no imports beyond the purpose vocabulary.

import { PURPOSE_CONVERSATION } from '../../../../core/voice/purpose.js';

/** The turn standings the shell can read out. */
export const TURN_STATES = Object.freeze(['waiting', 'listening', 'heard', 'thinking', 'speaking']);

/**
 * pure — the mount decision (F-03): the immersion shell stands ONLY while the
 * sitting is a declared conversation AND LIVE is armed. Everything else is the
 * ordinary desk, byte-identical to before.
 */
export const shouldMountVoiceSitting = ({ purpose, liveArmed } = {}) =>
  purpose === PURPOSE_CONVERSATION && liveArmed === true;

/**
 * pure — whose turn the loop is in, from the real signals available:
 * the being's playback activity (its voice, sounding NOW) outranks the
 * stream's thinking flag, which outranks the resting state — a live voice
 * sitting at rest is LISTENING, the mic is hot.
 */
export const deriveTurnState = ({
  thinking = false, playbackActive = false, micOpen = true, heard = false,
} = {}) => {
  if (playbackActive) return 'speaking';
  if (thinking) return 'thinking';
  // THE RELEASE MUST ANSWER (Design note, 2026-08-01: […]). Between the key coming up and the being starting to think
  // there is a real gap — the words still have to be decoded — and the sitting
  // said WAITING through all of it, which reads as […]. This is
  // the beat that says the turn was taken.
  if (heard) return 'heard';
  // LISTENING has to MEAN something. Under hold-to-talk the mic is granted but
  // the pipe is shut between holds, and a sitting that reads LISTENING while
  // nothing can reach the being is the same lie the "MIC ON" readout told over
  // hardware it had never touched. Resting is WAITING; only an open pipe
  // listens. Defaults true, so the open-mic lane reads exactly as before.
  return micOpen ? 'listening' : 'waiting';
};

/**
 * pure — what the sitting tells the witness to DO, given how the mic is armed.
 *
 * An open mic says "listening" honestly. Hold-to-talk must not: the mic is
 * granted but the pipe is shut, and a sitting that says LISTENING while
 * nothing can reach the being is the same class of lie as the MIC ON readout
 * that started this. It says HOLD SPACE, and says HEARING YOU only while the
 * key is actually down.
 *
 * The text is a CATALOG KEY into the desk namespace (`stream.*`) — the words
 * are the renderer's (i18n wave 2); en holds the originals verbatim.
 */
export const speakPrompt = ({ pushToTalk = false, holding = false, sending = false } = {}) => {
  if (!pushToTalk) return Object.freeze({ live: false, key: 'speakOpen' });
  if (holding) return Object.freeze({ live: true, key: 'speakHearing' });
  // The release has to be acknowledged in the same breath it happens, or the
  // witness cannot tell a slow turn from a lost one.
  if (sending) return Object.freeze({ live: true, key: 'speakSending' });
  return Object.freeze({ live: false, key: 'speakHold' });
};

/**
 * pure — an RMS sample (speech rarely exceeds ~0.3) gained up into a display
 * level in [0, 1]. Honest: linear gain + clamp, no smoothing theatre.
 */
export const normalizeLevel = (rms) => {
  if (!Number.isFinite(rms) || rms <= 0) return 0;
  return Math.min(1, rms * 3);
};

/**
 * pure — one display level as a row of bar heights in [0, 1], frozen.
 * Center-weighted envelope so a level reads as a shape, not a flat line;
 * every bar derives from the ONE real level — nothing is invented.
 */
export const levelToBars = (level, barCount = 16) => {
  const count = Math.max(1, barCount | 0);
  const l = Math.min(1, Math.max(0, Number.isFinite(level) ? level : 0));
  return Object.freeze(Array.from({ length: count }, (_, i) => {
    const envelope = 0.35 + 0.65 * Math.sin((Math.PI * (i + 0.5)) / count);
    return Math.round(l * envelope * 100) / 100;
  }));
};

/**
 * pure — the mic readout (Design note, 2026-08-01: […]).
 *
 * Three honest standings, never a guess:
 *   armed with a label   → that device is capturing, name it
 *   armed without one    → the grant is live but the browser withheld the
 *                          name; say the mic is on and that it is unnamed,
 *                          never invent one or imply silence
 *   not armed            → no grant at all
 */
export const micReadout = ({ device = '', liveArmed = false, micState = 'off' } = {}) => {
  const name = typeof device === 'string' ? device.trim() : '';
  const frozen = (live, key, args) => Object.freeze({ live, key, args, device: live ? name : '' });
  // The text is a catalog key (desk namespace, stream.*); the renderer speaks
  // it in the operator's language. en holds the originals verbatim.

  // A mic that FAILED to open must say so. This is the case that sent Founder
  // hunting: the desk read `liveArmed` — which only means the desk ASKED for
  // a mic — and printed […] over hardware it had never touched.
  if (micState === 'error') return frozen(false, 'micBlocked');
  if (!liveArmed) return frozen(false, 'micOff');
  if (micState === 'opening') return frozen(false, 'micOpening');
  // Armed, no error, but the path never reported a live standing: the request
  // was made and nothing came back. Never dress that as an open mic.
  if (micState === 'off') return frozen(false, 'micRequested');
  if (!name) return frozen(true, 'micOnUnnamed');
  return frozen(true, 'micNamed', { device: name.toUpperCase() });
};

/**
 * THE ONE WAY IN (Design note, 2026-08-01: […]).
 *
 * There is no work/conversation choice to make any more. Work is simply the
 * desk as it stands; TALK is the single gesture that opens the sitting, and
 * leaving it puts the desk back. The backend purpose law is untouched — this
 * only decides which of the two purposes that one button sends.
 *
 * label/title are catalog keys into the desk namespace (stream.*).
 */
export const talkToggleModel = (sittingActive) => {
  const live = sittingActive === true;
  return Object.freeze({
    live,
    labelKey: 'talk',
    // The title names what pressing it DOES, never the state it is in.
    titleKey: live ? 'talkTitleLeave' : 'talkTitleEnter',
  });
};
