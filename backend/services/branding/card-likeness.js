// card-likeness — how alike two card designs are in their LAYOUT, paint aside.
//
// Design note, 2026-11-16: […].
// Two companies drawing the shared stat card are the same drawing in different colours; a design
// copied from another company and only recoloured is too. So likeness reads the drawing itself —
// which shapes stand where, at what size, in what order — and ignores what a kit changes anyway
// (colours, faces, marks, the copy). Pure.

// The attributes that place and size a shape. Colour, opacity, font family and the like are paint.
const GEOMETRY = ['x', 'y', 'width', 'height', 'cx', 'cy', 'r', 'rx', 'ry', 'x1', 'y1', 'x2', 'y2',
  'd', 'points', 'transform', 'font-size', 'text-anchor', 'viewBox'];

/** The drawing's shapes in order, each with its geometry: a design's fingerprint, paint stripped. Pure. */
export const layoutTokens = (svg) => {
  const text = String(svg || '').replace(/<!--[\s\S]*?-->/g, '').replace(/\{\{[^}]*\}\}/g, '{}');
  const tokens = [];
  for (const [, name, attrs] of text.matchAll(/<([A-Za-z][\w:-]*)([^>]*)>/g)) {
    const geometry = GEOMETRY
      .map((key) => [key, attrs.match(new RegExp(`(?:^|\\s)${key}\\s*=\\s*"([^"]*)"`))?.[1]])
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => `${key}=${value.replace(/\s+/g, ' ').trim()}`);
    tokens.push([name, ...geometry].join(' '));
  }
  return tokens;
};

const shingles = (tokens, k = 3) => {
  const out = new Set();
  if (tokens.length < k) { out.add(tokens.join('|')); return out; }
  for (let i = 0; i + k <= tokens.length; i += 1) out.add(tokens.slice(i, i + k).join('|'));
  return out;
};

/**
 * How alike two designs' layouts are, 0 to 1 (1: the same drawing). Pure.
 * @param {string} a an SVG design
 * @param {string} b another
 */
export const layoutLikeness = (a, b) => {
  if (a === b) return 1;
  const [x, y] = [shingles(layoutTokens(a)), shingles(layoutTokens(b))];
  let shared = 0;
  for (const s of x) if (y.has(s)) shared += 1;
  const union = x.size + y.size - shared;
  return union ? shared / union : 1;
};

/** At or above this, two companies' cards read as the same card — the copy-and-paste look. */
export const TOO_ALIKE = 0.7;
