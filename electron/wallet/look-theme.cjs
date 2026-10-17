// The dress reaches the trusted confirmation window — read by MAIN from the
// operator's own persisted look store, NEVER from the requesting renderer:
// a compromised app renderer must not be able to restyle the surface a
// human reads before signing. Cosmetics only — the alert register is
// semantic and no theme ever touches it.

const fs = require('node:fs');
const path = require('node:path');

const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const KNOBS = ['ground', 'panel', 'ink', 'trim'];
const OPTIONAL_KNOBS = ['head', 'body', 'ital', 'emph', 'line', 'alert', 'warn', 'okay'];


/**
 * Exactly the four knob hexes (uppercased) or null. Pure.
 * @param {*} theme
 * @returns {{ground:string,panel:string,ink:string,trim:string}|null}
 */
const sanitizeLookTheme = (theme) => {
  if (!theme || typeof theme !== 'object') return null;
  const out = {};
  for (const knob of KNOBS) {
    const v = theme[knob];
    if (typeof v !== 'string' || !HEX_RE.test(v)) return null;
    out[knob] = v.toUpperCase();
  }
  // Optional voices — strict hexes when present. NOTE: the confirm window
  // applies only ground/panel/ink/trim/head; ALERT is deliberately never
  // applied there — a warning can never be dressed quiet.
  for (const knob of OPTIONAL_KNOBS) {
    if (theme[knob] == null) continue;
    if (typeof theme[knob] !== 'string' || !HEX_RE.test(theme[knob])) return null;
    out[knob] = theme[knob].toUpperCase();
  }
  return out;
};

/**
 * The persisted look's active theme; an absent or corrupt store reads as
 * stock (null) — the window must open regardless.
 *
 * impure (fs read).
 * @param {string} [file] — override for tests; default honors
 *   NEUMA_LOOK_SETTINGS_PATH then the repo's data/settings/look.json
 * @returns {{ground:string,panel:string,ink:string,trim:string}|null}
 */
const readLookTheme = (file) => {
  const p = file
    || process.env.NEUMA_LOOK_SETTINGS_PATH
    || path.join(__dirname, '../../data/settings/look.json');
  try {
    return sanitizeLookTheme(JSON.parse(fs.readFileSync(p, 'utf8')).theme);
  } catch {
    return null;
  }
};

module.exports = { sanitizeLookTheme, readLookTheme };
