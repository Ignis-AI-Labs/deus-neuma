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

// The frame's fixed rooms, in px (the gateway's own furniture, Portal.css):
export const ARMILLARY_ROOM = Object.freeze({
  TOP: 104, // above the ring: the status strip, and the verdict over the ring's top station
  THRESHOLD: 168, // beneath the name: the entry (its hint may wrap) and ENTER AS
  FOOT: 46, // the ignition strip at the foot, and air above it
});

const FLOOR = 0.3; // the figure never yields below this share of its own unit

// the composition at a given unit and still point (all of it scales from the
// unit; the name keeps its own legible size)
const composeAt = (w, h, unit, cy = h / 2 - ARMILLARY_LAYOUT.LIFT * unit) => {
  const short = Math.min(w, h);
  const ring = ARMILLARY_LAYOUT.RING * unit;
  const nameSize = Math.max(22, Math.min(40, short * 0.04));
  const nameY = cy + ring + Math.max(40, nameSize * 1.4);
  const lineY = nameY + nameSize * 1.05; // the tagline, under its hairline
  return {
    unit,
    cx: w / 2,
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
 * figure yields — never the threshold: first the still point rises (never
 * into the status strip), then the unit shrinks, exactly until the threshold
 * and the strip fit beneath the name. A frame tall enough keeps the resting
 * composition untouched. Pure.
 * @returns {{ unit: number, cx: number, cy: number, ring: number, mark: number,
 *   nameY: number, nameSize: number, lineY: number, belowY: number }}
 */
export const armillaryLayoutOf = (w, h) => {
  const rest = composeAt(w, h, Math.min(w, h) * ARMILLARY_LAYOUT.UNIT);
  const below = ARMILLARY_ROOM.THRESHOLD + ARMILLARY_ROOM.FOOT;
  if (rest.belowY + below <= h) return rest;
  const named = rest.belowY - (rest.cy + rest.ring); // the name and its line: unit-free
  const span = h - ARMILLARY_ROOM.TOP - named - below; // what the ring's diameter may take
  const unit = Math.max(rest.unit * FLOOR, Math.min(rest.unit, span / (2 * ARMILLARY_LAYOUT.RING)));
  const ring = ARMILLARY_LAYOUT.RING * unit;
  const cy = Math.min(h / 2 - ARMILLARY_LAYOUT.LIFT * unit, h - below - named - ring);
  return composeAt(w, h, unit, cy);
};
