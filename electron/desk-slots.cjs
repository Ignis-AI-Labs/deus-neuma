// Desk slots — stable identities for NEUMA's OS windows.
//
// A desk slot is a small positive integer a window claims for its lifetime.
// Slot 1 is the desk that always existed (its persisted layout keys predate
// slots and must keep working untouched); new windows claim the LOWEST free
// slot, so closing desk 2 and opening a window again reclaims desk 2 — and
// with it, that desk's persisted layout ([…], the sprint's restart semantics).
//
// Pure functions only — the registry itself (a Map of live windows) lives in
// desk-windows.cjs; these compute over plain data so they can be proven in
// unit tests without an Electron process.

const SLOT_ARG_PREFIX = '--neuma-desk-slot=';

/**
 * Pure — the lowest positive integer not currently occupied.
 * @param {Iterable<number>} occupied - Slots currently held by live windows
 * @returns {number} the slot a new window should claim (≥ 1)
 */
const lowestFreeSlot = (occupied) => {
  const taken = new Set(occupied);
  let slot = 1;
  while (taken.has(slot)) slot += 1;
  return slot;
};

/**
 * Pure — read the desk slot this renderer was launched with from its argv
 * (main passes it via webPreferences.additionalArguments; it is not a secret).
 * Malformed or absent values resolve to null — the caller falls back to
 * slot 1 semantics, never crashes.
 * @param {readonly string[]} argv - process.argv as seen in the preload
 * @returns {number|null} the claimed slot, or null when none was declared
 */
const parseDeskSlot = (argv) => {
  if (!Array.isArray(argv)) return null;
  const arg = argv.find((a) => typeof a === 'string' && a.startsWith(SLOT_ARG_PREFIX));
  if (!arg) return null;
  const n = Number(arg.slice(SLOT_ARG_PREFIX.length));
  return Number.isInteger(n) && n >= 1 ? n : null;
};

module.exports = { SLOT_ARG_PREFIX, lowestFreeSlot, parseDeskSlot };
