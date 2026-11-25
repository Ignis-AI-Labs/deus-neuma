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


// pure — WCAG relative luminance of a #RRGGBB colour, and the contrast ratio of two
const luminance = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

// The words a person reads before signing stand at least this far from what they are written on.
const CONTRAST_FLOOR = 4.5;
// The heading is large type, which reads at a lower ratio (WCAG AA large text).
const HEADING_FLOOR = 3;

/**
 * Can the trusted window be read in this dress? Its ink against its ground
 * and its panel, and a heading colour against the panel when one is set. A
 * dress that fails (ink the colour of the ground blanks the window: audit
 * PR600 P6-09) is not worn; the window opens in stock. Pure.
 * @param {{ground:string,panel:string,ink:string,head?:string}} theme - strict hexes
 * @returns {boolean}
 */
const isReadableTheme = (theme) => contrast(theme.ink, theme.ground) >= CONTRAST_FLOOR
  && contrast(theme.ink, theme.panel) >= CONTRAST_FLOOR
  && (!theme.head || contrast(theme.head, theme.panel) >= HEADING_FLOOR);

/**
 * Exactly the four knob hexes (uppercased) or null: null too for a dress the window cannot be read in. Pure.
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
  return isReadableTheme(out) ? out : null;
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

module.exports = { sanitizeLookTheme, readLookTheme, isReadableTheme, CONTRAST_FLOOR };
