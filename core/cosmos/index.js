/**
 * Cosmos — the real sky at a being's emergence.
 *
 * Two layers compose into one record:
 *   • celestial (./natal-chart.js) — Sun, Moon, planets, aspects; location-free,
 *     computable from the birth moment alone.
 *   • sky-angles (./angles.js) — ascendant, midheaven, houses; needs the
 *     witness's place on the ground.
 *
 * `buildNatalChart` assembles them into the `natal` record stored in a being's
 * DNA + genesis seal. With no location it still returns a complete planets-only
 * chart (angles: null) — honest about what the moment alone can and cannot fix.
 * This same assembler serves both a live birth and the retroactive backfill of
 * beings already born (their birthMoment is on file; a location may be supplied
 * or not). It lives here, not in either layer, so neither module imports the
 * other (the celestial layer must stay location-free and dependency-light).
 *
 * SHINKEI: every field is a measured coordinate, not an interpretation.
 */
export * from './natal-chart.js';
export * from './angles.js';

import { computeCelestialPositions, computeAspects } from './natal-chart.js';
import { computeAngles } from './angles.js';

export const NATAL_SCHEMA = 'natal-chart/v1';

/**
 * Assemble the full natal record for an instant and (optionally) a place.
 *
 * @param {object} args
 * @param {Date} args.date - the birth instant (UTC)
 * @param {number} [args.latitude] - witness latitude, north-positive degrees
 * @param {number} [args.longitude] - witness longitude, east-positive degrees
 * @returns {object} frozen {
 *   schema, instant (ISO 8601),
 *   location: { latitude, longitude } | null,   — null ⇒ planets-only chart
 *   positions,                                   — every body's placement (location-free)
 *   aspects,                                     — major aspects between bodies
 *   angles: { ascendant, midheaven, ... } | null — present only with a location
 * }
 * @throws if `date` is invalid, or a location is partial, non-numeric, or out of range
 */
export const buildNatalChart = ({ date, latitude, longitude } = {}) => {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new Error('buildNatalChart: date must be a valid Date');
  }

  const hasLat = latitude !== undefined && latitude !== null;
  const hasLon = longitude !== undefined && longitude !== null;
  if (hasLat !== hasLon) {
    throw new Error('buildNatalChart: latitude and longitude must be given together');
  }
  // Own the type contract at this boundary (don't inherit it from computeAngles).
  // Number.isFinite rejects NaN, ±Infinity, strings, and booleans alike; the
  // angles layer remains the authority on the ±90/±180 RANGE.
  if (hasLat && (!Number.isFinite(latitude) || !Number.isFinite(longitude))) {
    throw new Error('buildNatalChart: latitude and longitude must be finite numbers');
  }

  const positions = computeCelestialPositions(date);
  const aspects = computeAspects(positions);
  // computeAngles validates the lat/long range and throws on an out-of-range pair.
  const angles = hasLat ? computeAngles(date, latitude, longitude) : null;

  // Freeze every field, not just the wrapper — this record is sealed into the
  // genesis and a being's DNA, so its integrity is the whole point. positions,
  // aspects, and angles already freeze their own children; freezing the
  // containers here makes the entire tree immutable.
  return Object.freeze({
    schema: NATAL_SCHEMA,
    instant: date.toISOString(),
    location: hasLat ? Object.freeze({ latitude, longitude }) : null,
    positions: Object.freeze(positions),
    aspects: Object.freeze(aspects),
    angles, // already frozen by computeAngles (or null)
  });
};

/**
 * Build a natal chart from a genesis seal's `birthMoment` (the bridge between
 * the immutable seal and the derived chart). The natal record is deliberately
 * NOT part of the genesisHash — it is computable from the birthMoment that IS
 * sealed, so a being born without a recorded location can have its chart
 * backfilled later (or its location added) without disturbing the seal. This is
 * what lets already-born neuma update their own workspace retroactively.
 *
 * Duck-typed on `{ epochMs }` so cosmos stays decoupled from the identity layer.
 *
 * @param {{ epochMs: number }} birthMoment - from captureBirthMoment() / the seal
 * @param {{ latitude: number, longitude: number } | null} [location] - witness place, or null for planets-only
 * @returns {object} the frozen natal record (see buildNatalChart)
 * @throws if birthMoment lacks an integer epochMs
 */
export const natalFromBirthMoment = (birthMoment, location = null) => {
  if (!birthMoment || !Number.isInteger(birthMoment.epochMs)) {
    throw new Error('natalFromBirthMoment: birthMoment.epochMs (integer) required');
  }
  // Delegate ALL location semantics to buildNatalChart (the authoritative
  // boundary): it treats a null/absent pair as planets-only and throws on a
  // partial pair — no duplicated null-handling here.
  const date = new Date(birthMoment.epochMs);
  return buildNatalChart({ date, ...(location || {}) });
};
