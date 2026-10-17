// voice-purpose-state.js — the voice sitting's shared state holder (SPEECH
// SYSTEM, Phase D seam).
//
// WHY THIS MODULE EXISTS: the sitting's purpose and the LIVE-armed flag are
// read by code that must NOT import the stream hook (the mic path lives in
// use-live-voice.js / the worklet lane, owned by another workstream). This
// tiny holder is the documented contract between the two halves of the
// speech system — same pattern as companion-data.js: module-level state,
// impure but explicit, every mutation through a named function.
//
// WRITERS / READERS:
//   purpose     — written ONLY by use-consciousness-stream (server truth on
//                 the session:purpose ack; fail-closed reset on companion
//                 switch). Read by the mic path: a conversation sitting is
//                 what may open the mic at all.
//   liveArmed   — written by use-consciousness-stream (purpose defaulting:
//                 entering a conversation arms LIVE, leaving it disarms) and
//                 by the VoiceSitting EXIT gesture (disarm only). Read by the
//                 mic path: armed → open the mic + send voice:mic_open;
//                 disarmed → close the mic + send voice:mic_close.
//   mic level   — THE MIC-LEVEL SEAM (F-04): there is exactly ONE
//                 getUserMedia, owned by use-live-voice.js, so the
//                 visualization cannot run its own analyser. The mic path's
//                 50 ms RMS pump calls feedMicLevel(frameRms) each tick; the
//                 VoiceSitting visualizer reads it back with readMicLevel().
//                 Until the mic path lands, the operator channel honestly
//                 reads silence.
//   mic device  — the SAME seam, same owner (Design note, 2026-08-01: […]). The label is read off the
//                 GRANTED track, never guessed from enumerateDevices: what
//                 the browser actually handed us is the only honest answer to
//                 […].
//
// impure — module-level state by design (the seam described above).

import { normalizePurpose, PURPOSE_WORK } from '../../../core/voice/purpose.js';

let purpose = PURPOSE_WORK;
let liveArmed = false;
let micLevel = 0;
let micDevice = '';
let micState = 'off';
const listeners = new Set();

const notify = () => {
  for (const fn of listeners) {
    try { fn(); } catch { /* one bad listener never wedges the rest */ }
  }
};

/** The sitting's declared purpose — 'work' unless a conversation was declared AND acked. */
export const getSittingPurpose = () => purpose;

/** impure — apply purpose (normalized, fail-closed to 'work'). Returns the standing purpose. */
export const setSittingPurpose = (next) => {
  const normalized = normalizePurpose(next);
  if (normalized !== purpose) {
    purpose = normalized;
    notify();
  }
  return purpose;
};

/** Whether LIVE (the open mic) is armed for this sitting. */
export const isLiveArmed = () => liveArmed;

/** impure — arm/disarm LIVE. Disarming also zeroes the mic level seam. */
export const setLiveArmed = (on) => {
  const next = !!on;
  if (next !== liveArmed) {
    liveArmed = next;
    if (!next) micLevel = 0;
    notify();
  }
  return liveArmed;
};

/**
 * impure — the mic path reports the GRANTED track's label here. Called with
 * the real device name on open and with '' on teardown, so the readout can
 * never outlive the grant it describes.
 */
export const feedMicDevice = (label) => {
  const next = typeof label === 'string' ? label.trim() : '';
  if (next !== micDevice) {
    micDevice = next;
    notify();
  }
  return micDevice;
};

/**
 * The mic actually captured right now, or '' when none is open.
 *
 * A granted track whose label is empty is the browser withholding the name
 * (no permission persisted yet), NOT the absence of a mic — the caller
 * distinguishes the two by whether LIVE is armed.
 */
export const readMicDevice = () => micDevice;

/**
 * impure — the mic path reports its OWN standing here: 'off' | 'opening' |
 * 'listening' | 'capturing' | 'transcribing' | 'error'.
 *
 * WHY THIS EXISTS: `liveArmed` says the desk ASKED for a mic. It says nothing
 * about whether one opened. Reading the armed flag as "MIC ON" told the
 * operator a mic was live while the hardware was untouched — the exact lie
 * this seam is supposed to prevent. Only the hook that called getUserMedia
 * knows, so only the hook writes this.
 */
export const feedMicState = (next) => {
  const value = typeof next === 'string' && next ? next : 'off';
  if (value !== micState) {
    micState = value;
    notify();
  }
  return micState;
};

/** The mic path's real standing. 'off' until a mic path reports otherwise. */
export const readMicState = () => micState;

// WHAT THE BEING ACTUALLY HEARD (Design note, 2026-08-01: […]). The sitting takes
// the whole window, so the chat that renders transcripts is display:none —
// the witness had no way to see his own words at all. This carries them to
// the one surface he is looking at.
//
// `settled` distinguishes a partial (still changing) from the final line, so
// the sitting can show a draft honestly rather than passing a guess off as
// what was sent. Same convention the browsers' own speech demos use: the
// interim text is shown dimmed, the final text plainly.
let heard = { text: '', settled: false };

/** impure — a transcript frame arrived; show it. */
export const feedHeard = (text, settled = false) => {
  const value = typeof text === 'string' ? text : '';
  const next = { text: value, settled: settled === true };
  if (next.text !== heard.text || next.settled !== heard.settled) {
    heard = next;
    notify();
  }
  return heard;
};

/** The last thing heard, and whether it is final. Cleared by a new hold. */
export const readHeard = () => heard;

/** impure — the mic path feeds its real RMS sample here (see the seam note above). */
export const feedMicLevel = (rms) => {
  micLevel = Number.isFinite(rms) && rms > 0 ? Math.min(1, rms) : 0;
};

/** The operator's latest mic level (0 = silence or no mic feed yet). */
export const readMicLevel = () => micLevel;

/**
 * impure — subscribe to purpose/liveArmed changes (React mirrors this into
 * state so the desk re-renders). Returns the unsubscribe.
 */
export const subscribeVoiceSitting = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
