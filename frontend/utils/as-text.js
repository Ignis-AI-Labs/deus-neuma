// as-text.js — a value a window prints, as TEXT. React refuses to render an
// object as a child and takes the whole window down with it (React #31: the
// SUBSTRATE window, 2026-10-18, […]); anything that
// arrives from a server and is printed goes through here. Pure.

/**
 * @param {*} v
 * @returns {string} a string as-is; an Error or `{message}`/`{error}` by its
 *   words; anything else as JSON; nothing as ''.
 */
export const asText = (v) => {
  if (typeof v === 'string') return v;
  if (v == null) return '';
  if (v instanceof Error) return v.message;
  if (typeof v?.message === 'string') return v.message;
  if (typeof v?.error === 'string') return v.error;
  try { return JSON.stringify(v) ?? String(v); } catch { return String(v); }
};
