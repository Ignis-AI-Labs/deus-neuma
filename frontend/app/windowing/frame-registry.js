// frame-registry.js — the live registry of floating-window frames.
//
// Window geometry is deliberately per-window state (useWindowFrame), so a
// drag knows nothing about its siblings — until it needs a split target.
// Each frame keeps its entry current here (rect as shown, stacking z,
// whether it can be a target, and the applySplit door a sibling's drop
// walks through). impure — module-level registry, same spirit as
// setDeskRegion in use-window-frame.js; per-document, so pop-out desks
// are isolated by construction.

const frames = new Map();
const listeners = new Set();
const notify = () => listeners.forEach((fn) => fn());

/**
 * Keep a frame's entry current (registration and update are one act).
 * @param {string} id the window's storage key (unique per open window)
 * @param {{rect:{x,y,w,h}, z:number, targetable:boolean, applySplit:(half:object)=>void}} entry
 */
export const registerFrame = (id, entry) => { frames.set(id, entry); notify(); };

export const unregisterFrame = (id) => { frames.delete(id); notify(); };

/** How many windows are open on this desk. */
export const frameCount = () => frames.size;

/** impure — hear every change to the registry; returns the unsubscribe. */
export const subscribeFrames = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

/**
 * Is this frame wholly covered by one frame stacked above it? Then nothing
 * of it can be seen, and it need not be drawn at all (2026-10-04: two
 * maximized windows stacked kept a full-screen layer each — the GPU's tile
 * budget overflowed and content stopped drawing). Only a frame that truly
 * covers its rect counts (targetable: neither shaded nor departing).
 * @param {string} id
 */
export const isFrameOccluded = (id) => {
  const me = frames.get(id);
  if (!me) return false;
  const a = me.rect;
  for (const [other, f] of frames) {
    if (other === id || !f.targetable || f.z <= me.z) continue;
    const b = f.rect;
    if (b.x <= a.x && b.y <= a.y && b.x + b.w >= a.x + a.w && b.y + b.h >= a.y + a.h) return true;
  }
  return false;
};

/**
 * The topmost targetable frame under a pointer, excluding the asker (a
 * drag never targets itself). Highest z wins — what the witness sees on
 * top is what the drop divides.
 * @param {{x,y}} p pointer in canvas space
 * @param {string} excludeId
 * @returns {object|null} the registry entry, or null
 */
export const topFrameAt = (p, excludeId) => {
  let best = null;
  for (const [id, f] of frames) {
    if (id === excludeId || !f.targetable) continue;
    const { rect } = f;
    if (p.x < rect.x || p.x > rect.x + rect.w || p.y < rect.y || p.y > rect.y + rect.h) continue;
    if (!best || f.z > best.z) best = f;
  }
  return best;
};
