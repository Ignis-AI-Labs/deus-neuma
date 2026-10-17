/**
 * Shared markup escaping for THE PRESS.
 * Pure — no IO.
 */

const REPLACEMENTS = Object.freeze({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
});

/**
 * Escapes text for safe interpolation into HTML or SVG markup.
 * @param {unknown} value - Coerced to string; null/undefined become ''.
 * @returns {string}
 */
export function escapeMarkup(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => REPLACEMENTS[ch]);
}
