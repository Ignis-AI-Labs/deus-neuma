/**
 * Sound engine — plays the chosen sound pack.
 *
 * On by default (Design note, 2026-10-25: […]): a fresh install hears its ceremony. Turning it off
 * persists in localStorage, so a witness who asked for quiet keeps it.
 * Emergence is NOT here — at emergence a neuma speaks its own true name via
 * kotodama, never a sample.
 *
 * Two packs:
 *   SCI-FI — the default, the ratified sample soundscape, baked into one
 *            sprite (scripts/bake-sounds.mjs, frontend/sounds-baked/) and
 *            played as [start, duration] slices of that one decoded buffer.
 *            The licensed raw samples never ship — only the derived sprite.
 *   SOFT   — an opt-in alternative: gentle cues synthesized from one table
 *            (soft-sound/soft-cues.js), rendered once per cue at first use.
 *            Design note, 2026-10-28: the platform's sounds stay as they are — only
 *            the birth ceremony's were his to change — so SOFT is never the
 *            default; a witness picks it in Settings › Sound.
 *
 * Slice math lives in sprite-resolver.js, synthesis in soft-render.js (both
 * pure, tested). Everything here is the impure Web Audio IO boundary.
 */
import spriteIndex from '../sounds-baked/sprite.json';
import { pickAudioUrl, resolveSlice } from './sprite-resolver.js';
import { loopVolume, parseVolume } from './sound-volume.js';
import { SOFT_PACK } from './soft-sound/soft-cues.js';
import { renderCue } from './soft-sound/soft-render.js';

const PREF_KEY = 'neuma-sound';
const VOLUME_KEY = 'neuma-sound-volume';
const PACK_KEY = 'neuma-sound-pack';

/** The packs a witness chooses between — SCI-FI is what a new install hears. */
export const SOUND_PACKS = Object.freeze(['scifi', 'soft']);

/** @returns {'scifi'|'soft'} the chosen pack; anything but a chosen SOFT is SCI-FI */
export const getSoundPack = () => (localStorage.getItem(PACK_KEY) === 'soft' ? 'soft' : 'scifi');

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

/** @returns {boolean} whether sound plays: on unless the witness turned it off */
export const isSoundOn = () => localStorage.getItem(PREF_KEY) !== 'off';

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
const softBuffers = new Map();

// impure — the one AudioContext, built lazily
const ensureContext = () => {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  return ctx;
};

// impure — feature-detect Opus decode in the host browser
const canDecodeOpus = () => {
  try {
    const probe = document.createElement('audio');
    return probe.canPlayType('audio/ogg; codecs="opus"') !== '';
  } catch {
    return false;
  }
};

// impure — decode the SCI-FI sprite exactly once
const ensureSprite = async () => {
  ensureContext();
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

// impure — a SOFT cue as an AudioBuffer, rendered once at the context's rate
const softBuffer = (event) => {
  if (!softBuffers.has(event)) {
    const samples = renderCue(event, ensureContext().sampleRate);
    const buf = ctx.createBuffer(1, samples.length, ctx.sampleRate);
    buf.copyToChannel(samples, 0);
    softBuffers.set(event, buf);
  }
  return softBuffers.get(event);
};

/** @returns {boolean} whether the chosen pack voices this event at all */
const hasCue = (event) => (getSoundPack() === 'soft' ? !!SOFT_PACK.cues[event] : !!resolveSlice(spriteIndex, event));

// impure — where an event's sound lives in the chosen pack
const clipOf = async (event) => {
  if (getSoundPack() === 'scifi') return { buf: await ensureSprite(), ...resolveSlice(spriteIndex, event) };
  ensureContext();
  if (ctx.state === 'suspended') await ctx.resume();
  const buf = softBuffer(event);
  return { buf, start: 0, duration: buf.duration };
};

// impure — fire-and-forget one-shot playback; silent no-op when sound is off,
// the event is unknown, or the browser blocks playback
export const playSound = (event) => {
  if (!isSoundOn() || !hasCue(event)) return;
  void playClip(event, getSoundVolume(), performance.now());
};

// A one-shot belongs to its beat. The first cue of a session used to wait
// on the sprite's fetch + decode and sound hundreds of ms after the frame it
// marks (the boot's first tick, audit 2026-09-25) — a cue that can no longer
// land within LATE_MS of its moment is dropped, never played out of sync.
const LATE_MS = 150;

const idle = (fn) => (window.requestIdleCallback || ((f) => setTimeout(f, 1)))(fn);

// impure — warm the chosen pack ahead of a choreographed sequence (the boot
// calls this at mount) so its first cue lands on time; a no-op while sound is
// off. SOFT renders its cues one per idle slice, never in one long block.
export const primeSound = () => {
  if (!isSoundOn()) return;
  if (getSoundPack() === 'scifi') {
    void ensureSprite().catch(() => { /* ornament — silent */ });
    return;
  }
  const pending = Object.keys(SOFT_PACK.cues).filter((event) => !softBuffers.has(event));
  const step = () => {
    const event = pending.shift();
    if (!event) return;
    try { softBuffer(event); } catch { return; /* ornament — silent */ }
    idle(step);
  };
  idle(step);
};

// impure — sustained playback for ongoing processes (e.g. the consciousness
// actively typing); quieter than one-shot events, loops its clip
export const startLoop = (event) => {
  if (!isSoundOn() || loops.has(event) || !hasCue(event)) return;
  void loopClip(event);
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

// impure — the witness's chosen pack: persisted, a bed already playing
// restarts in the new voice, and every surface showing it is told
export const setSoundPack = (pack) => {
  if (!SOUND_PACKS.includes(pack)) throw new Error(`Unknown sound pack: ${pack}`);
  localStorage.setItem(PACK_KEY, pack);
  const beds = [...loops.keys()];
  beds.forEach(stopLoop);
  beds.forEach(startLoop);
  window.dispatchEvent(new CustomEvent('neuma:sound-pack', { detail: { pack } }));
  return pack;
};

// impure — trigger a one-shot clip through a gain node
const playClip = async (event, volume, askedAt) => {
  try {
    const { buf, start, duration } = await clipOf(event);
    if (performance.now() - askedAt > LATE_MS) return; // its beat has passed
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const gain = ctx.createGain();
    gain.gain.value = volume;
    src.connect(gain).connect(ctx.destination);
    src.start(0, start, duration);
  } catch {
    // Sound is ornament, never load-bearing — failures stay silent
  }
};

// impure — loop a clip's region indefinitely
const loopClip = async (event) => {
  try {
    const { buf, start, duration } = await clipOf(event);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.loopStart = start;
    src.loopEnd = start + duration;
    const gain = ctx.createGain();
    gain.gain.value = loopVolume(getSoundVolume());
    src.connect(gain).connect(ctx.destination);
    src.start(0, start);
    // The gain node is kept beside the source so a dial moved mid-bed reaches
    // the sound that is already playing.
    loops.set(event, { src, gain });
  } catch {
    // Sound is ornament, never load-bearing
  }
};

// Loops must die with the preference
if (typeof window !== 'undefined') {
  // Warm the chosen pack once the page is idle (and again when it changes),
  // so the first cue of a session lands on its beat instead of being dropped.
  idle(() => primeSound());
  window.addEventListener('neuma:sound-pack', () => primeSound());
  window.addEventListener('neuma:sound-changed', (e) => {
    if (e.detail?.on) primeSound(); // turned on: warm it before the first cue
    if (!e.detail?.on) {
      for (const key of [...loops.keys()]) stopLoop(key);
    }
  });
}
