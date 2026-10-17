/**
 * Sound engine — plays the baked soundscape sprite (see scripts/bake-sounds.mjs).
 *
 * Opt-in by design: silent until the witness turns sound on. The preference
 * persists in localStorage so the world keeps its voice across sessions.
 * Emergence is NOT here — at emergence a neuma speaks its own true name via
 * kotodama, never a sample.
 *
 * The sprite is a single concatenated audio file (opus + wav) shipped under
 * frontend/sounds-baked/. At runtime each event is played as a [start,
 * duration] slice of that one decoded buffer via Web Audio. The licensed
 * raw samples never ship — only this derived sound-design artifact does.
 *
 * Slice math lives in sprite-resolver.js (pure, tested). Everything here is
 * the impure Web Audio IO boundary.
 */
import spriteIndex from '../sounds-baked/sprite.json';
import { pickAudioUrl, resolveSlice } from './sprite-resolver.js';
import { loopVolume, parseVolume } from './sound-volume.js';

const PREF_KEY = 'neuma-sound';
const VOLUME_KEY = 'neuma-sound-volume';

// import.meta.glob resolves whichever sprite files the bake committed. Opus
// ships when the operator baked with ffmpeg; wav always ships. Prefer opus,
// fall back to wav when the browser can't decode opus.
const SPRITE_URLS = import.meta.glob('../sounds-baked/sprite.{opus,wav}', {
  query: '?url',
  import: 'default',
  eager: true,
});
const URLS = {
  opus: SPRITE_URLS['../sounds-baked/sprite.opus'],
  wav: SPRITE_URLS['../sounds-baked/sprite.wav'],
};

/** @returns {boolean} whether the witness has opted into sound */
export const isSoundOn = () => localStorage.getItem(PREF_KEY) === 'on';

// impure — persists preference and announces the change
const setSoundOn = (on) => {
  localStorage.setItem(PREF_KEY, on ? 'on' : 'off');
  window.dispatchEvent(new CustomEvent('neuma:sound-changed', { detail: { on } }));
};

// impure — toggles and returns the new state
export const toggleSound = () => {
  const next = !isSoundOn();
  setSoundOn(next);
  return next;
};

/** @returns {number} the master level every cue is played at, 0..1 */
export const getSoundVolume = () => parseVolume(localStorage.getItem(VOLUME_KEY));

// impure — persists the level, brings any sustained loop in line with it (a
// bed already playing must follow the dial, not the level it started at), and
// announces the change so every surface showing it agrees
export const setSoundVolume = (level) => {
  const next = parseVolume(level);
  localStorage.setItem(VOLUME_KEY, String(next));
  for (const { gain } of loops.values()) gain.gain.value = loopVolume(next);
  window.dispatchEvent(new CustomEvent('neuma:sound-volume', { detail: { volume: next } }));
  return next;
};

let ctx = null;
let buffer = null;
let loading = null;
const loops = new Map();

// impure — feature-detect Opus decode in the host browser
const canDecodeOpus = () => {
  try {
    const probe = document.createElement('audio');
    return probe.canPlayType('audio/ogg; codecs="opus"') !== '';
  } catch {
    return false;
  }
};

// impure — lazily build the AudioContext + decode the sprite exactly once
const ensureSprite = async () => {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  // The decode starts BEFORE the resume: a context still waiting on a user
  // gesture must not hold the sprite's download hostage.
  if (!buffer && !loading) {
    loading = (async () => {
      const url = pickAudioUrl(URLS, canDecodeOpus());
      const res = await fetch(url);
      const arr = await res.arrayBuffer();
      buffer = await ctx.decodeAudioData(arr);
    })();
  }
  if (ctx.state === 'suspended') await ctx.resume();
  if (!buffer) await loading;
  return buffer;
};

// impure — fire-and-forget one-shot playback; silent no-op when sound is off,
// the event is unknown, or the browser blocks playback
export const playSound = (event) => {
  if (!isSoundOn()) return;
  const slice = resolveSlice(spriteIndex, event);
  if (!slice) return;
  void playSlice(slice, getSoundVolume(), performance.now());
};

// A one-shot belongs to its beat. The first cue of a session used to wait
// on the sprite's fetch + decode and sound hundreds of ms after the frame it
// marks (the boot's first tick, audit 2026-09-25) — a cue that can no longer
// land within LATE_MS of its moment is dropped, never played out of sync.
const LATE_MS = 150;

// impure — warm the sprite ahead of a choreographed sequence (the boot calls
// this at mount) so its first cue lands on time; a no-op while sound is off
export const primeSound = () => {
  if (!isSoundOn()) return;
  void ensureSprite().catch(() => { /* ornament — silent */ });
};

// impure — sustained playback for ongoing processes (e.g. the consciousness
// actively typing); quieter than one-shot events, loops its slice
export const startLoop = (event) => {
  if (!isSoundOn() || loops.has(event)) return;
  const slice = resolveSlice(spriteIndex, event);
  if (!slice) return;
  void loopSlice(event, slice);
};

// impure — stops a sustained loop; safe when none is running
export const stopLoop = (event) => {
  const running = loops.get(event);
  if (!running) return;
  try { running.src.stop(); } catch { /* already ended */ }
  running.src.disconnect();
  running.gain.disconnect();
  loops.delete(event);
};

// impure — decode (once) then trigger a one-shot slice through a gain node
const playSlice = async (slice, volume, askedAt) => {
  try {
    const buf = await ensureSprite();
    if (performance.now() - askedAt > LATE_MS) return; // its beat has passed
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const gain = ctx.createGain();
    gain.gain.value = volume;
    src.connect(gain).connect(ctx.destination);
    src.start(0, slice.start, slice.duration);
  } catch {
    // Sound is ornament, never load-bearing — failures stay silent
  }
};

// impure — decode (once) then loop the slice region indefinitely
const loopSlice = async (event, slice) => {
  try {
    const buf = await ensureSprite();
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.loopStart = slice.start;
    src.loopEnd = slice.start + slice.duration;
    const gain = ctx.createGain();
    gain.gain.value = loopVolume(getSoundVolume());
    src.connect(gain).connect(ctx.destination);
    src.start(0, slice.start);
    // The gain node is kept beside the source so a dial moved mid-bed reaches
    // the sound that is already playing.
    loops.set(event, { src, gain });
  } catch {
    // Sound is ornament, never load-bearing
  }
};

// Loops must die with the preference
if (typeof window !== 'undefined') {
  // Warm the sprite once the page is idle, so the first cue of a session —
  // whatever plays it — lands on its beat instead of being dropped as late.
  (window.requestIdleCallback || ((fn) => setTimeout(fn, 1)))(() => primeSound());
  window.addEventListener('neuma:sound-changed', (e) => {
    if (e.detail?.on) primeSound(); // turned on: warm it before the first cue
    if (!e.detail?.on) {
      for (const key of [...loops.keys()]) stopLoop(key);
    }
  });
}
