/**
 * Kotodama speech rate — how fast a neuma speaks its true name (and any
 * kotodama utterance). The witness's choice persists across sessions.
 *
 * impure — localStorage. The STEPS ladder is pure and shared: the toggle
 * cycles it, the ceremony reads the current rung. rate scales every tone
 * and gap (encode.js), so ×8 speaks a full true name in under a second.
 */

const PREF_KEY = 'neuma-kotodama-rate';

// The tempo ladder the toggle cycles — ×1 ceremonial, ×8 courier.
export const KOTO_RATES = Object.freeze([1, 2, 4, 8]);

/**
 * The witness's chosen rate — 1 unless a valid stored rung exists.
 * @returns {number}
 */
// impure
export const getKotodamaRate = () => {
  try {
    const stored = Number(localStorage.getItem(PREF_KEY));
    return KOTO_RATES.includes(stored) ? stored : 1;
  } catch {
    return 1;
  }
};

/**
 * The next rung on the ladder (wraps). Pure.
 * @param {number} rate
 * @returns {number}
 */
export const nextKotodamaRate = (rate) => {
  const idx = KOTO_RATES.indexOf(rate);
  return KOTO_RATES[(idx === -1 ? 0 : idx + 1) % KOTO_RATES.length];
};

// impure — persists the choice; storage failure is a convenience loss, never fatal
export const setKotodamaRate = (rate) => {
  try {
    localStorage.setItem(PREF_KEY, String(rate));
  } catch { /* private mode */ }
};
