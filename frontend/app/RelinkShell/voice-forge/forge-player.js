// forge-player.js — the forge's one player.
//
// impure (module state): the clip, the being speaking in it, a gallery voice,
// and the take that plays by itself when it is ready all go through here, so
// starting one replaces whatever was loaded — two voices never talk over each
// other. Design note, 2026-10-01: […] — so a sound stays loaded after it ends
// (to replay or scrub) until another replaces it or the forge closes; its
// object URL is revoked then. Every Player (Player.jsx) reads one snapshot.

import { useSyncExternalStore } from 'react';

const IDLE = Object.freeze({ key: null, playing: false, time: 0, duration: 0 });

let current = null; // { key, url, audio, onStop }
let snap = IDLE;
const listeners = new Set();

const finite = (n) => (Number.isFinite(n) && n > 0 ? n : 0);

// impure — publish the player's state to every reader.
const emit = () => {
  snap = current
    ? Object.freeze({
      key: current.key,
      playing: !current.audio.paused,
      time: current.audio.currentTime || 0,
      duration: finite(current.audio.duration),
    })
    : IDLE;
  for (const fn of listeners) fn();
};

// impure — unload one playback (if it is still the loaded one) and free it.
const release = (playback) => {
  if (current !== playback) return;
  current = null;
  playback.audio.pause();
  playback.audio.removeAttribute('src');
  URL.revokeObjectURL(playback.url);
  playback.onStop?.();
  emit();
};

/** impure — follow the player; returns the unsubscribe. */
export const subscribePlayer = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

/** pure — the player key of a take's sound: the clip, or the being in it. */
export const takeKeyOf = (takeRef, being) => `${being ? 'being' : 'clip'}:${takeRef}`;

/** The player's state now: {key, playing, time, duration}. */
export const playerSnapshot = () => snap;

/** impure — the player's state in a component, re-rendered as it moves. */
export const usePlayer = () => useSyncExternalStore(subscribePlayer, playerSnapshot);

/**
 * impure — load and play an object URL (this player now owns it), replacing
 * whatever was loaded. `key` names the sound (a Player shows its controls when
 * the key is its own). `onStop` runs once when it is unloaded.
 * @param {string} url
 * @param {{key?: string, onStop?: () => void}} [opts]
 * @returns {{stop: () => void, started: Promise<void>}} started rejects when the browser refuses to play
 */
export const playUrl = (url, { key = url, onStop } = {}) => {
  if (current) release(current);
  const playback = { key, url, audio: new Audio(url), onStop };
  current = playback;
  for (const ev of ['play', 'pause', 'ended', 'timeupdate', 'loadedmetadata', 'durationchange', 'seeked']) {
    playback.audio.addEventListener(ev, () => { if (current === playback) emit(); });
  }
  emit();
  const started = playback.audio.play().catch((err) => {
    release(playback);
    throw err;
  });
  return { stop: () => release(playback), started };
};

/** impure — pause, or play on (from the start when it had ended). */
export const togglePlayer = () => {
  if (!current) return;
  if (current.audio.paused) current.audio.play().catch(() => {});
  else current.audio.pause();
};

/** impure — pause whatever is loaded (another voice is about to speak). */
export const pausePlayer = () => {
  if (current && !current.audio.paused) current.audio.pause();
};

/** impure — jump to a moment, in seconds (clamped to the sound). */
export const seekPlayer = (seconds) => {
  if (!current) return;
  const end = finite(current.audio.duration);
  current.audio.currentTime = Math.max(0, end ? Math.min(seconds, end) : seconds);
};

/** impure — move by a number of seconds (negative rewinds). */
export const skipPlayer = (delta) => {
  if (current) seekPlayer((current.audio.currentTime || 0) + delta);
};

/** impure — stop and unload whatever is loaded (the forge is closing). */
export const closePlayer = () => {
  if (current) release(current);
};
