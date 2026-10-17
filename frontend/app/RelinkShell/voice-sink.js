// voice-sink.js — the client end of the neuma's voice.
//
// The backend (`portal-stream.js`) synthesizes a neuma's reply sentence by
// sentence and streams the audio as `voice:audio` WS frames (base64 PCM +
// format/sampleRate/channels). Until now those frames had no consumer — the
// neuma was mute even with a forged voice. This sink decodes each frame and
// schedules it back-to-back on a Web Audio timeline so a reply plays as one
// continuous utterance, in order.
//
// The decode + scheduling core lives in voice-scheduler.js (shared with the
// forge streaming preview); this wrapper keeps the WS-frame concerns: the
// frame shape, base64 payloads, and the enable/mute gate the chat surface
// toggles. Ordering guarantees come from the scheduler's single promise chain.
//
// impure — owns an AudioContext (via the scheduler) and schedules playback.

import { createVoiceScheduler, base64ToBytes, pcmToFloat32Channels, RAW_FORMATS } from './voice-scheduler.js';

// The helpers' home moved to voice-scheduler.js with the extraction; they stay
// re-exported here so existing sink consumers see no change.
export { base64ToBytes, pcmToFloat32Channels };

// How long the last scheduled chunk keeps the playback channel reading live.
export const PLAYBACK_ACTIVITY_MS = 350;

// pure — the RMS of one chunk's samples (channel 0), 0 for anything that is
// not synchronously decodable raw PCM. An ENCODED frame (a cloud engine's
// wav/mp3/opus) carries no readable level here — its ACTIVITY is still real
// (it was genuinely scheduled to play); only the level is unknown, and the
// channel honestly stays dark rather than inventing one.
export const chunkRms = (bytes, format = 'pcm_s16le', channels = 1) => {
  if (!bytes || bytes.byteLength === 0) return 0;
  const fmt = String(format || '').toLowerCase();
  if (!RAW_FORMATS.has(fmt)) return 0;
  const [mono] = pcmToFloat32Channels(bytes, channels, fmt);
  if (!mono || mono.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < mono.length; i++) sum += mono[i] * mono[i];
  return Math.sqrt(sum / mono.length);
};

// pure — a level that decays linearly to silence as time passes since the
// last real sound. The tap measures chunks as they are SCHEDULED, so without
// decay a finished utterance would read as forever-speaking.
export const decayedLevel = (rms, silentForMs, decayMs = PLAYBACK_ACTIVITY_MS) => {
  if (!Number.isFinite(rms) || rms <= 0) return 0;
  const left = 1 - Math.max(0, silentForMs) / decayMs;
  return left <= 0 ? 0 : rms * left;
};

/**
 * Create a voice sink.
 *
 * @param {Object} [opts]
 * @param {() => AudioContext} [opts.createContext] - context factory (tests inject a fake)
 * @param {boolean} [opts.enabled=true] - start enabled
 * @returns {{
 *   pushAudio: (frame: Object) => void,
 *   interrupt: () => void,
 *   resume: () => void,
 *   setEnabled: (on: boolean) => boolean,
 *   isEnabled: () => boolean,
 *   isSupported: () => boolean,
 *   dispose: () => void,
 * }}
 */
export const createVoiceSink = ({ createContext, enabled = true } = {}) => {
  const scheduler = createVoiceScheduler({ createContext, enabled });

  // THE PLAYBACK LEVEL TAP (SPEECH SYSTEM F-04): the being's voice as numbers
  // — the RMS of each real chunk passing through pushAudio, decaying to
  // silence. This is deliberately NOT an AnalyserNode on the playback graph:
  // voice-scheduler.js owns that graph (and is another workstream's file),
  // and the bytes ARE the audio — measuring exactly what gets scheduled is
  // measuring the stream itself, with no second graph to keep in step.
  let lastRms = 0;
  let lastSoundAt = 0;
  const silenceTap = () => { lastRms = 0; lastSoundAt = 0; };

  return {
    // Queue one voice:audio frame for in-order playback.
    pushAudio(frame) {
      if (!scheduler.isSupported() || !scheduler.isEnabled() || !frame || !frame.bytes) return;
      let bytes;
      try {
        bytes = base64ToBytes(frame.bytes);
      } catch (err) {
        // A single bad frame must never wedge the queue.
        console.warn('[voice-sink] frame dropped:', err?.message || err);
        return;
      }
      if (bytes.byteLength === 0) return;
      lastRms = chunkRms(bytes, frame.format, frame.channels);
      lastSoundAt = Date.now();
      scheduler.pushChunk(bytes, frame);
    },

    // Cut off anything currently speaking — used for barge-in when the witness
    // sends a new message before the neuma finishes.
    interrupt() { scheduler.interrupt(); silenceTap(); },

    // Resume the context on a user gesture (autoplay policy). Frames only
    // arrive after the witness sends a message, so this is always gesture-backed.
    resume() { scheduler.resume(); },

    setEnabled(next) {
      const on = scheduler.setEnabled(next);
      if (!on) silenceTap(); // a muted speaker is not a live channel
      return on;
    },
    isEnabled() { return scheduler.isEnabled(); },
    isSupported() { return scheduler.isSupported(); },

    // impure — the live playback read-out for the visualization layer:
    // { level, active }, frozen. active = real audio was scheduled within the
    // activity window AND the sink is enabled; level decays to silence after
    // the last chunk (encoded frames report activity with level 0 — honest).
    getPlaybackState(now = Date.now()) {
      const silentFor = lastSoundAt > 0 ? now - lastSoundAt : Infinity;
      const active = scheduler.isEnabled() && silentFor < PLAYBACK_ACTIVITY_MS;
      return Object.freeze({
        level: active ? decayedLevel(lastRms, silentFor) : 0,
        active,
      });
    },

    // Resolves when the queued frames have finished decoding + scheduling (NOT
    // when they finish playing). For graceful teardown and deterministic tests.
    idle() { return scheduler.idle(); },

    dispose() { silenceTap(); scheduler.dispose(); },
  };
};
