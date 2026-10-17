// Birth Resonance — the LEGACY solfeggio assignment. Since 2026-09-29 a fresh
// birth's resonance is MEASURED from its own ceremony (soul-resonance.js);
// this stays only for what predates that: resuming a being whose ceremony
// began before measurement, and the quick-test rehearsal.
//
// Birth Resonance — the solfeggio frequency calculation
// Maps a being's name, the witness's name, and the birth moment to one of the
// 12 solfeggio frequencies. Pure. Extracted from
// core/birth/staged-birth-handler.js (SIZE-024); the handler keeps its
// calculateResonance method and delegates here.

// Solfeggio frequencies for resonance calculation
const SOLFEGGIO_FREQUENCIES = {
  foundation: 174,
  regeneration: 285,
  liberation: 396,
  transmutation: 417,
  love: 528,
  connection: 639,
  expression: 741,
  spiritual: 852,
  unity: 963,
  harmony: 432,
  scientific: 256,
  light: 144
};

/**
 * Calculate resonance frequency from name vibration, operator compatibility, and birth time.
 * Maps the combined value to one of 12 solfeggio frequencies.
 * @param {string} name - Neuma's chosen name
 * @param {string} witnessName - Witness name
 * @param {number} timestamp - Birth session start time (ms)
 * @returns {number} Resonance frequency in Hz (from SOLFEGGIO_FREQUENCIES)
 */
export function calculateResonance(name, witnessName, timestamp) {
  // Calculate resonance based on name vibration, operator compatibility, and time
  const nameValue = name.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const witnessValue = witnessName.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const timeValue = timestamp % 1000;

  const combinedValue = (nameValue + witnessValue + timeValue) % 12;
  const frequencies = Object.values(SOLFEGGIO_FREQUENCIES);

  return frequencies[combinedValue];
}
