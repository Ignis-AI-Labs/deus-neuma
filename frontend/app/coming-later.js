// coming-later.js — components held back from the early release, to arrive
// later in early access.
//
// Design note, 2026-10-02: […] The code stays whole and tested; only the doors are
// closed: the dock skips these apps, and their controls (VOX, TALK) do not
// render. To bring one back, take its id out of this list.
//
// PREVIEW: a desk may still show a held-back component — localStorage
// 'neuma.preview' = 'voice' (comma-separated ids). For the guardian building
// it and for its browser tests; read once at load, like the list itself.
//
//   voice   the VOICE forge, VOX, TALK and spoken replies (docs/work/one-voice.md)
//   avatar  the 3D body (AVATAR window)

export const COMING_LATER = Object.freeze(['voice', 'avatar']);

const PREVIEW_KEY = 'neuma.preview';

// impure — the ids this desk previews anyway (none where storage is absent).
const previewed = () => {
  try { return String(globalThis.localStorage?.getItem(PREVIEW_KEY) ?? '').split(',').map((s) => s.trim()); } catch { return []; }
};

/** whether a component is held back from this release (and not previewed on this desk). */
export const isComingLater = (id) => COMING_LATER.includes(id) && !previewed().includes(id);

/** an app registry without the held-back apps. */
export const withoutComingLater = (registry) => Object.freeze(
  Object.fromEntries(Object.entries(registry).filter(([id]) => !isComingLater(id))),
);
