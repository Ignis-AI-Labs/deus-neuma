// contrast — does this brand clear the floor it set itself?
//
// Every brand kit declares `accessibility.contrastMin`, and until now nothing
// anywhere checked the brand against it. The number was written down and never
// read — which is the same failure mode as `logoRules.misuse` naming a rule the
// renderer was breaking. A rule in the kit that nothing enforces is a comment.
//
// So the palette editor computes the real WCAG ratio for the pairs that matter
// and badges each against the kit's OWN floor rather than a number we picked.
// If a brand says 4.5, it is held to 4.5; if it says 7, it is held to 7.
//
// ⚠️ ALPHA IS COMPOSITED, NOT IGNORED. Half of Umbrae's ink roles are
// `rgba(247,243,234,0.66)` and friends. Measuring those as if they were opaque
// would report a ratio the reader never experiences — flattering, and wrong in
// the direction that matters. Each colour is composited over the background it
// is actually drawn on before the ratio is taken.
//
// Pure throughout.

/** One channel, 0-255, from a hex pair. */
const byte = (hex, i) => parseInt(hex.slice(i, i + 2), 16);

/**
 * Any colour this renderer accepts → `{r, g, b, a}` with 0-255 channels and a
 * 0-1 alpha, or null. Pure.
 *
 * Handles the four shapes `tokenRefusals` allows: #rgb, #rrggbb, #rrggbbaa,
 * and rgb()/rgba().
 */
export const parseColor = (value) => {
  const text = String(value || '').trim();
  const hex = text.match(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/);
  if (hex) {
    const h = hex[1];
    if (h.length === 3) {
      return { r: byte(h[0] + h[0], 0), g: byte(h[1] + h[1], 0), b: byte(h[2] + h[2], 0), a: 1 };
    }
    return {
      r: byte(h, 0), g: byte(h, 2), b: byte(h, 4),
      a: h.length === 8 ? byte(h, 6) / 255 : 1,
    };
  }
  const fn = text.match(/^rgba?\(([^)]+)\)$/);
  if (!fn) return null;
  const parts = fn[1].split(/[,\s/]+/).filter(Boolean);
  if (parts.length < 3) return null;
  const chan = (p) => (p.endsWith('%') ? Math.round((parseFloat(p) / 100) * 255) : Number(p));
  const [r, g, b] = parts.slice(0, 3).map(chan);
  if (![r, g, b].every(Number.isFinite)) return null;
  const alphaText = parts[3];
  const a = alphaText === undefined
    ? 1
    : (alphaText.endsWith('%') ? parseFloat(alphaText) / 100 : Number(alphaText));
  return { r, g, b, a: Number.isFinite(a) ? Math.min(1, Math.max(0, a)) : 1 };
};

/** Lay a translucent colour over an opaque one. Pure. */
const composite = (over, under) => ({
  r: Math.round(over.r * over.a + under.r * (1 - over.a)),
  g: Math.round(over.g * over.a + under.g * (1 - over.a)),
  b: Math.round(over.b * over.a + under.b * (1 - over.a)),
  a: 1,
});

/** sRGB relative luminance, per WCAG 2. Pure. */
const luminance = ({ r, g, b }) => {
  const lin = (v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};

/**
 * The contrast ratio between a foreground and a background, 1 to 21. Pure.
 * Returns null when either colour is not one this renderer would accept —
 * a ratio computed from a typo is worse than no ratio.
 */
export const contrastRatio = (fg, bg) => {
  const back = parseColor(bg);
  const front = parseColor(fg);
  if (!back || !front) return null;
  // The background is what everything else sits on, so its own alpha has
  // nothing beneath it to composite against — treat it as laid on itself.
  const under = back.a < 1 ? composite(back, { r: 0, g: 0, b: 0, a: 1 }) : back;
  const over = front.a < 1 ? composite(front, under) : front;
  const a = luminance(over);
  const b = luminance(under);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
};

/**
 * How a ratio stands against this brand's own floor. Pure.
 *
 * `floor` is the kit's `accessibility.contrastMin`. AA/AAA are reported too
 * because they are the shared vocabulary, but the PASS is against the brand's
 * declaration — a brand that set itself 7 is not passing at 4.6.
 */
export const contrastVerdict = (ratio, floor) => {
  if (ratio === null) return { tone: 'unknown', text: '—' };
  const rounded = Math.round(ratio * 10) / 10;
  const min = Number.isFinite(floor) ? floor : 4.5;
  const level = ratio >= 7 ? 'AAA' : ratio >= 4.5 ? 'AA' : ratio >= 3 ? 'AA LARGE' : 'FAIL';
  return {
    tone: ratio >= min ? 'pass' : 'fail',
    ratio: rounded,
    level,
    text: `${rounded.toFixed(1)} · ${level}`,
  };
};
