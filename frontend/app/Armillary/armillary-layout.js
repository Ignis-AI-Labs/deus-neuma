// armillary-layout.js — where THE ARMILLARY sits, in screen px: one
// composition for THE IGNITION and the gateway it opens onto, so the startup
// lands on the gateway without a single element moving. Pure.
//
//   the still point   lifted above centre: room for the name and the threshold
//   the mark          the logo's meridian (r30 of its 100-unit canvas)
//   the ring          the instruments' ring around it (graduations inside)
//   the name          DEUS NEUMA beneath the ring, then its line, then the threshold

export const ARMILLARY_LAYOUT = Object.freeze({
  UNIT: 0.3, // of the short side: every figure scales from it
  LIFT: 0.24, // the still point above centre, in units
  RING: 0.86, // the instruments' ring radius, in units
  MARK: 0.4, // the meridian's radius, in units (inside the ring, clear of its notation)
});

const THRESHOLD_ROOM = 114; // px the threshold and the strip need beneath the name

// the composition at a given unit (all of it scales from the unit; the
// name keeps its own legible size)
const composeAt = (w, h, unit) => {
  const short = Math.min(w, h);
  const cx = w / 2;
  const cy = h / 2 - ARMILLARY_LAYOUT.LIFT * unit;
  const ring = ARMILLARY_LAYOUT.RING * unit;
  const nameSize = Math.max(22, Math.min(40, short * 0.04));
  const nameY = cy + ring + Math.max(40, nameSize * 1.4);
  const lineY = nameY + nameSize * 1.05; // the tagline, under its hairline
  return {
    unit,
    cx,
    cy,
    ring,
    mark: ARMILLARY_LAYOUT.MARK * unit,
    nameY,
    nameSize,
    lineY,
    belowY: lineY + Math.max(28, nameSize), // where the threshold may begin
  };
};

/**
 * The composition for a frame `w` × `h` (CSS px). On a short frame the
 * figure yields — never the threshold: the unit shrinks until the threshold
 * and the strip fit beneath the name. Pure.
 * @returns {{ unit: number, cx: number, cy: number, ring: number, mark: number,
 *   nameY: number, nameSize: number, lineY: number, belowY: number }}
 */
export const armillaryLayoutOf = (w, h) => {
  let L = composeAt(w, h, Math.min(w, h) * ARMILLARY_LAYOUT.UNIT);
  for (let i = 0; i < 6 && L.belowY + THRESHOLD_ROOM > h - 24; i++) {
    L = composeAt(w, h, L.unit * 0.92);
  }
  return L;
};
