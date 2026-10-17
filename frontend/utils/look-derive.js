// look-derive.js — pure derivation of the platform's dress.
//
// LINE & CYCLE's entire material system is opacity steps over a few base
// colors (docs/design/interface/design-language.md: the light ramp does the structural work).
// The LOOK exposes a small set of knobs and derives every token from them
// at the stock opacities, so a custom look stays coherent by construction
// instead of exposing ~40 raw tokens.
//
// REQUIRED knobs — the surface itself: GROUND (the void), PANEL (window
// fills), INK (the light — hairlines + every unclaimed text voice), TRIM
// (the one live accent).
// OPTIONAL knobs — voices a dress may claim, absent on any dress saved
// before they existed (nothing stored ever breaks or shifts):
//   HEAD — section headings (absent: ink at the stock relationship)
//   BODY — body prose (absent: the ink text ramp)
//   ITAL — italic / a shade of tone (absent: inherit the body)
//   EMPH — bold / the color of strong words (absent: primary ink)

//   LINE — hairlines and borders (absent: the ink edge ramp)
//   ALERT — denials, warnings, deletions, the council's standby
//   WARN — the approaching-limit amber (context gauge, git modified)
//   OKAY — quiet success (git added, the council's open floor)
// Council voice hues stay semantic-per-seat and are NOT knobs (a later
// cycle); the trusted wallet window's warning register NEVER themes.

export const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export const LOOK_KNOBS = Object.freeze(['ground', 'panel', 'ink', 'trim']);
export const OPTIONAL_KNOBS = Object.freeze([
  'head', 'body', 'ital', 'emph', 'line', 'folder', 'alert', 'warn', 'okay',
]);
export const HEAD_KNOB = 'head';


// The stock dress — mirrors frontend/styles/tokens.css exactly; applying it
// is the same as applying no override at all. STOCK_FACES are the optional
// knobs' resting values (the stylesheet's own), shown by the UI until a
// dress claims that voice.
export const STOCK_LOOK = Object.freeze({
  ground: '#000000',
  panel: '#000000',
  ink: '#FFFFFF',
  trim: '#5FE9FF',
});

export const STOCK_FACES = Object.freeze({
  head: null,
  body: null,
  ital: null,
  emph: null,
  line: null,
  folder: '#B9A2D0',
  alert: '#FF5533',
  warn: '#FFB86B',
  okay: '#00FF88',
});


const channel = (hex, i) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
const rgba = (hex, alpha) =>
  `rgba(${channel(hex, 0)}, ${channel(hex, 1)}, ${channel(hex, 2)}, ${alpha})`;

/**
 * Derive the token override map from the knobs. Opacity steps mirror
 * tokens.css — the stock values fall out exactly when given STOCK_LOOK.
 * Optional-knob families are emitted ONLY when their knob is present, so
 * an unclaimed voice keeps the stylesheet's own semantic color.
 * @param {{ground: string, panel: string, ink: string, trim: string,
 *   head?: string, body?: string, ital?: string, emph?: string, line?: string, folder?: string,
 *   alert?: string, warn?: string, okay?: string}} look
 * @returns {Record<string, string>} CSS custom property name → value
 */
export const deriveLookVars = ({
  ground, panel, ink, trim, head, body, ital, emph, line, folder, alert, warn, okay,
}) => {
  const claimed = (hex) => (hex && HEX_RE.test(hex) ? hex : null);
  const text = claimed(body) || ink;
  const edge = claimed(line) || ink;
  return {
    '--color-heading': claimed(head) || rgba(ink, 0.7),
    '--color-void': ground,
    '--color-pure-black': ground,
    '--color-glass': rgba(ground, 0.5),
    '--color-void-veil': rgba(ground, 0.18),
    '--color-surface': rgba(panel, 0.98),
    '--color-surface-elevated': rgba(panel, 0.95),
    '--color-white': ink,
    '--color-text-primary': rgba(text, 0.95),
    '--color-text-secondary': rgba(text, 0.7),
    '--color-text-tertiary': rgba(text, 0.5),
    '--color-text-disabled': rgba(text, 0.3),
    '--line': rgba(edge, 0.18),
    '--line-hover': rgba(edge, 0.4),
    '--grid': rgba(edge, 0.02),
    '--color-border-primary': rgba(edge, 0.2),
    '--color-border-hover': rgba(edge, 0.4),
    '--color-border-focus': rgba(edge, 0.6),
    '--color-glass-light': rgba(edge, 0.02),
    '--color-glass-hover': rgba(edge, 0.05),
    '--color-input-fill': rgba(edge, 0.08),
    '--color-input-fill-focus': rgba(edge, 0.12),
    '--glow-white': `0 0 20px ${rgba(edge, 0.1)}`,
    '--signal': trim,
    '--signal-dim': rgba(trim, 0.5),
    '--signal-faint': rgba(trim, 0.18),
    '--glow-cyan': `0 0 20px ${rgba(trim, 0.3)}`,
    ...(claimed(ital) ? { '--color-italic': ital } : {}),
    ...(claimed(emph) ? { '--color-emphasis': emph } : {}),
    ...(claimed(alert) ? {
      '--alert': alert,
      '--alert-dim': rgba(alert, 0.55),
      '--alert-tint': rgba(alert, 0.12),
      '--hand-rest': rgba(alert, 0.55),
      '--color-error': alert,
      '--color-error-muted': rgba(alert, 0.3),
      '--color-error-bg': rgba(alert, 0.1),
    } : {}),
    ...(claimed(folder) ? { '--tabstrip-ground-ink': folder } : {}),
    ...(claimed(warn) ? { '--warn': warn } : {}),
    ...(claimed(okay) ? {
      '--color-green': okay,
      '--hand-open-tint': rgba(okay, 0.12),
      '--color-success-muted': rgba(okay, 0.3),
      '--color-success-bg': rgba(okay, 0.1),
    } : {}),
  };
};


// EVERY var a dress may ever set — the removal set. applyLook must clear
// all of these before applying a theme, or a knob RELEASED between two
// dresses (alert claimed, then unclaimed) would leave a stale override.
export const LOOK_VAR_NAMES = Object.freeze(
  Object.keys(deriveLookVars({
    ...STOCK_LOOK,
    head: '#FFFFFF', body: '#FFFFFF', ital: '#FFFFFF', emph: '#FFFFFF', line: '#FFFFFF',
    folder: '#B9A2D0', alert: '#FF5533', warn: '#FFB86B', okay: '#00FF88',
  })),
);

const knobEq = (a, b, knob) => {
  const va = typeof a?.[knob] === 'string' ? a[knob].toUpperCase() : null;
  const vb = typeof b?.[knob] === 'string' ? b[knob].toUpperCase() : null;
  return va === vb;
};

/**
 * Do two looks dress the platform identically? Case-insensitive on the
 * hex; an absent optional knob equals only an absent one.
 * @param {*} a
 * @param {*} b
 * @returns {boolean}
 */
export const isSameLook = (a, b) =>
  LOOK_KNOBS.every(
    (knob) =>
      typeof a?.[knob] === 'string' &&
      typeof b?.[knob] === 'string' &&
      a[knob].toUpperCase() === b[knob].toUpperCase(),
  ) && OPTIONAL_KNOBS.every((knob) => knobEq(a, b, knob));

/**
 * A valid theme object — the four required knobs as #RRGGBB; optional
 * knobs strict when present. Pure.
 * @param {*} theme
 * @returns {boolean}
 */
export const isValidLook = (theme) =>
  !!theme && typeof theme === 'object' &&
  LOOK_KNOBS.every((knob) => typeof theme[knob] === 'string' && HEX_RE.test(theme[knob])) &&
  OPTIONAL_KNOBS.every(
    (knob) => theme[knob] == null || (typeof theme[knob] === 'string' && HEX_RE.test(theme[knob])),
  );
