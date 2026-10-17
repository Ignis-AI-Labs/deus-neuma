// voice-activity.js — pure voice-activity endpointing for LIVE mode.
//
// A reducer over (rms, now) samples from the mic: no audio APIs, no timers,
// no side effects — the impure hook (use-live-voice) pumps real analyser
// frames through it and acts on the events it emits.
//
//   idle ──rms above threshold──▶ arming ──held confirmMs──▶ speaking
//     ▲                             │ dip below                │ 'start'
//     │                             ▼                          ▼
//   idle ◀──quiet hangoverMs── ending ◀──rms under floor── speaking
//          'end' (or 'drop' if the utterance was too short to be speech)
//
// The threshold adapts: while nothing is being said, the noise floor is
// tracked as an exponential moving average and the speech threshold rides a
// multiple above it — a fan or hum never becomes an utterance, and a quiet
// room stays sensitive. Hysteresis (endFactor < 1) keeps a wavering voice
// from flickering between states mid-sentence.

// ECHO ON OPEN SPEAKERS (Design note, 2026-08-01: […]).
//
// getUserMedia already opens with echoCancellation — the browser's AEC is the
// first line and it is a good one. What it cannot promise is a SILENT
// residual: on open speakers at volume, with a room behind them, enough of
// the being's voice survives to clear a threshold tuned for a quiet room, and
// the being interrupts itself. Headphones were always flawless for exactly
// this reason (recorded in the voice layer's Tier-2 notes).
//
// So this is the residual-echo suppressor that sits AFTER the AEC, which is
// what conferencing stacks do too: while the far end is sounding, the bar for
// […] rises in proportion to what is being played.
// It is deliberately NOT a mute — barge-in survives, because a witness who
// actually speaks up clears the raised bar. It only refuses to mistake the
// being's own voice for a witness.
//
// The suppression constant is empirical by nature: it relates a playback RMS
// to the mic RMS that the room returns, which depends on speaker volume,
// distance and the AEC's own residual. The default is a starting point to
// tune by ear, not a measured truth.
export const VAD_DEFAULTS = Object.freeze({
  minThreshold: 0.01,   // absolute floor for the speech threshold (RMS 0..1)
  noiseMultiple: 3,     // speech threshold = noiseFloor * this (≥ minThreshold)
  noiseAlpha: 0.05,     // EMA rate for the noise floor (only updates when quiet)
  endFactor: 0.7,       // speech "ends" below threshold * this (hysteresis)
  confirmMs: 120,       // rms must hold above threshold this long to be speech
  hangoverMs: 700,      // silence must hold this long to end the utterance
  minUtteranceMs: 250,  // shorter than this → 'drop', not 'end' (a click, a cough)
  // While the being sounds, speech must clear playbackLevel * this. The window
  // is bounded on both sides and it is narrow: too LOW and the being's own
  // voice still trips the mic; too HIGH and the bar climbs above a normal
  // speaking voice and barge-in dies. It must sit above the room's coupling
  // ratio (what fraction of playback returns to the mic after AEC — typically
  // well under a quarter on open speakers) and below the witness-to-playback
  // ratio (a witness at their own mic is much louder than speaker bleed).
  // 0.25 sits in that window for the fixtures in voice-activity.test.js; it is
  // a starting point to tune by ear on real speakers, not a measured truth.
  echoSuppression: 0.25,
  echoDecay: 0.82,      // per-sample decay of that raised bar once it stops
});

/**
 * A fresh VAD state.
 * @param {Object} [opts] - overrides for VAD_DEFAULTS
 * @returns {Object} frozen initial state for feedVad
 */
export const createVadState = (opts = {}) => Object.freeze({
  cfg: Object.freeze({ ...VAD_DEFAULTS, ...opts }),
  phase: 'idle',        // idle | arming | speaking | ending
  noiseFloor: 0,
  aboveSince: 0,        // when rms first held above threshold (arming)
  quietSince: 0,        // when rms first fell under the end threshold (ending)
  speechStart: 0,       // when the current utterance began
  echoFloor: 0,         // the raised bar while the being's voice is sounding
});

/**
 * The speech threshold in force: the noise floor's bar, or the echo bar while
 * the being is speaking — whichever is higher.
 * @param {Object} state - VAD state
 * @returns {number} RMS level (0..1) above which sound reads as speech
 */
export const vadThreshold = (state) =>
  Math.max(
    state.cfg.minThreshold,
    state.noiseFloor * state.cfg.noiseMultiple,
    state.echoFloor || 0,
  );

/**
 * pure — the echo bar after one sample. Rises immediately with what is being
 * played (no lag: the echo reaches the mic before any average could catch it)
 * and decays geometrically once playback stops, covering the buffered tail and
 * the room's own ring-out without needing a timer.
 * @param {number} previous - the bar carried from the last sample
 * @param {number} playbackLevel - the being's playback RMS right now (0..1)
 * @param {Object} cfg - VAD config
 * @returns {number}
 */
export const nextEchoFloor = (previous, playbackLevel, cfg) => {
  const played = Number.isFinite(playbackLevel) && playbackLevel > 0 ? playbackLevel : 0;
  const decayed = (Number.isFinite(previous) ? previous : 0) * cfg.echoDecay;
  const raised = played * cfg.echoSuppression;
  const next = Math.max(decayed, raised);
  // Below the absolute floor the bar cannot change any decision (vadThreshold
  // takes the max against minThreshold), so it is zeroed rather than left to
  // trail an ever-smaller number that never quite settles.
  return next < cfg.minThreshold ? 0 : next;
};

/**
 * Feed one RMS sample. Returns { state, event } where event is
 * null | 'start' | 'end' | 'drop'.
 * @param {Object} state - from createVadState / a previous feedVad
 * @param {number} rms - current mic level, 0..1
 * @param {number} now - sample timestamp in ms (monotonic)
 */
export const feedVad = (state, rms, now, playbackLevel = 0) => {
  const { cfg } = state;
  // The echo bar moves BEFORE this sample is judged: the being's voice is
  // already in the room by the time the mic reports it.
  const echoFloor = nextEchoFloor(state.echoFloor, playbackLevel, cfg);
  const threshold = vadThreshold({ ...state, echoFloor });
  const endThreshold = threshold * cfg.endFactor;

  // Track the noise floor only while nothing speech-like is happening —
  // otherwise the witness's own voice would teach the detector to ignore it.
  // Echo is excluded for the same reason and more urgently: learning the
  // being's own voice as "the room" would raise the bar permanently and go on
  // deafening the mic long after it stopped speaking.
  const quietNow = rms < endThreshold;
  const noiseFloor = (state.phase === 'idle' && quietNow && echoFloor === 0)
    ? state.noiseFloor + (rms - state.noiseFloor) * cfg.noiseAlpha
    : state.noiseFloor;

  const next = (patch, event = null) =>
    ({ state: Object.freeze({ ...state, noiseFloor, echoFloor, ...patch }), event });

  switch (state.phase) {
    case 'idle':
      if (rms >= threshold) return next({ phase: 'arming', aboveSince: now });
      return next({});

    case 'arming':
      if (rms < threshold) return next({ phase: 'idle' }); // a blip, not speech
      if (now - state.aboveSince >= cfg.confirmMs) {
        return next({ phase: 'speaking', speechStart: state.aboveSince }, 'start');
      }
      return next({});

    case 'speaking':
      if (rms < endThreshold) return next({ phase: 'ending', quietSince: now });
      return next({});

    case 'ending': {
      if (rms >= threshold) return next({ phase: 'speaking' }); // they kept talking
      if (now - state.quietSince >= cfg.hangoverMs) {
        const longEnough = (state.quietSince - state.speechStart) >= cfg.minUtteranceMs;
        return next({ phase: 'idle' }, longEnough ? 'end' : 'drop');
      }
      return next({});
    }

    default:
      return next({ phase: 'idle' });
  }
};

/**
 * pure — may the witness's mic audio reach the portal right now?
 *
 * THE GUARD THAT WAS MISSING (2026-08-01): raising the VAD's bar suppressed
 * the BARGE-IN signal but nothing else — mic PCM was streamed to whisper
 * unconditionally, and whisper runs its OWN server-side VAD. So the being's
 * voice off the speakers was still transcribed, turn after turn (a real
 * sitting logged `utterances: 6` for one reply). The bar has to close the
 * PIPE, not just the interrupt.
 *
 * KEYED ON *WHETHER* THE BEING IS SOUNDING, NOT ON HOW LOUDLY. The first
 * version of this gate opened again whenever the playback level dipped under a
 * threshold, on the assumption that quiet enough bleed is harmless. Measured
 * on the bench, that assumption is simply false: whisper transcribed real
 * Kokoro speech attenuated to −32 dB (mic RMS 0.0016, at the noise floor)
 * cleanly and completely, and at −40 dB it stopped transcribing and started
 * HALLUCINATING — […] There is no level low enough to be
 * safe, so level cannot be the question. The only safe rule is that whisper
 * never sees the being at all.
 *
 * Open whenever the being is not sounding. While it IS sounding the pipe
 * closes, and reopens the moment the witness clears the VAD's raised bar — so
 * barge-in still reaches whisper, and the being's own voice never does.
 *
 * @param {{ playbackActive: boolean, witnessSpeaking: boolean }} input
 * @returns {boolean}
 */
export const micGateOpen = ({ playbackActive = false, witnessSpeaking = false } = {}) =>
  !playbackActive || witnessSpeaking;

/**
 * pure — is this VAD phase the witness actually speaking? 'ending' counts:
 * the hangover is part of the utterance, and cutting the pipe at the first
 * dip would clip every trailing word.
 * @param {string} phase
 * @returns {boolean}
 */
export const isWitnessSpeaking = (phase) => phase === 'speaking' || phase === 'ending';

/**
 * RMS of one analyser frame of time-domain bytes (0..255, 128 = rest).
 * @param {Uint8Array|null} bytes - getByteTimeDomainData frame
 * @returns {number} RMS level, 0..1 (0 for empty/missing frames)
 */
export const frameRms = (bytes) => {
  if (!bytes || bytes.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < bytes.length; i++) {
    const v = (bytes[i] - 128) / 128;
    sum += v * v;
  }
  return Math.sqrt(sum / bytes.length);
};

// ECHO CANCELLATION, WHEN THE BROWSER'S CANNOT WORK (Design note, 2026-08-01: […]).
//
// Browser AEC subtracts a filtered copy of what it PLAYED from what the mic
// HEARS. That models delay and room response, which are linear. It cannot
// model a pitch shift — and on this desk the default output sink is a
// PipeWire filter chain that retunes everything down 31.77 cents (440→432 Hz)
// through a Rubber Band shifter. The echo arriving at the mic is therefore at
// a different pitch than the reference AEC holds, so cancellation is defeated
// by construction. Separate capture and render hardware (a USB mic against a
// USB interface, independent clocks) makes it worse.
//
// An OS-level echo-cancelled source does not have that problem: it takes its
// reference from the real signal going to the speakers, AFTER every filter.
// When the system offers one, it is strictly the better ear.
const ECHO_CANCELLED_LABEL = /echo[\s._-]*cancel/i;

/**
 * pure — pick the input device to open, given what the system offers.
 *
 * Returns a deviceId, or null to mean […]. Never throws
 * on a partial or unlabelled list: before a grant is given the browser
 * withholds labels, and an unlabelled list simply has no opinion in it.
 *
 * @param {Array<{kind?: string, deviceId?: string, label?: string}>} devices
 */
export const preferredInputDevice = (devices) => {
  if (!Array.isArray(devices)) return null;
  const hit = devices.find((d) => (
    d && d.kind === 'audioinput'
    && typeof d.label === 'string' && ECHO_CANCELLED_LABEL.test(d.label)
    && typeof d.deviceId === 'string' && d.deviceId && d.deviceId !== 'default'
  ));
  return hit ? hit.deviceId : null;
};
