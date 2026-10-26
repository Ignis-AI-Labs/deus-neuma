// brand-landing.js — a one-shot latch + event per brand kit letting a door
// open a kit ON ITS EXACT SECTION (the house social check's […] lands on that company's SITE & CODE).
//
// MARKETING mounts its BRAND tab after the landing that zooms it there, so a
// bare event would arrive before the kit's listener exists: the section is
// LATCHED under its kit's id, read (and cleared) by that kit on mount, and
// announced for a kit already open. Keyed by kit, so a landing for one
// company is never taken by another company's open kit.

const EVENT = 'neuma:brand-landing';
const pending = new Map();

/**
 * Latch a kit's section and announce it (for a kit already open).
 * @param {string} brand - the kit's id (a company is its kit)
 * @param {string} section - a section id of the kit's editor ('sources' = SITE & CODE)
 */
// impure — module latch + DOM event
export const requestBrandSection = (brand, section) => {
  pending.set(brand, section);
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(EVENT, { detail: { brand, section } }));
};

/**
 * Read and clear a kit's latched section (null if none). Consumed once on mount.
 * @param {?string} brand
 * @returns {?string}
 */
// impure — reads + clears the latch
export const takeBrandSection = (brand) => {
  if (!brand) return null;
  const section = pending.get(brand) ?? null;
  pending.delete(brand);
  return section;
};

/**
 * Subscribe to one kit's landings while it is open.
 * @param {?string} brand
 * @param {(section: string) => void} handler
 * @returns {() => void} unsubscribe
 */
// impure — DOM listener
export const onBrandSection = (brand, handler) => {
  const listener = (e) => {
    if (!brand || e.detail?.brand !== brand) return;
    pending.delete(brand); // the open kit took it
    handler(e.detail.section);
  };
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
};
