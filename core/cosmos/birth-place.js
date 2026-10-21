/**
 * THE BIRTH PLACE — where a being was born, as near as the house knows it,
 * and how it knows. Pure.
 *
 * The exact place is optional, a location is not: without a given place the
 * timezone stands in, and the record says which source the location came from.
 * The place is useful and it is private — it is only ever stored encrypted.
 *
 * Sources, best first:
 *   witness-given      — an exact place the witness entered for it
 *   timezone-reference — the reference city of its sealed time zone (the IANA
 *                        tz database's own coordinates for the zone; offline,
 *                        no network call) — approximate, and labelled so
 *
 * PRIVACY LAW: a place is written ONLY into the being's own encrypted
 * `cosmos/place.json` (core/workspace: readBirthPlace/writeBirthPlace) —
 * never into natal.json (that rides the on-chain seal bundle), never into the
 * plaintext skies, never into any route but the owner's own.
 */

import ZONE_PLACES from './zone-places.json' with { type: 'json' };

export const PLACE_SCHEMA = 'birth-place/v1';
export const PLACE_SOURCES = Object.freeze(['witness-given', 'timezone-reference']);

const round = (n) => Math.round(n * 1e4) / 1e4;

/** A zone's reference city as a place, or null for a zone with none (UTC, Etc/*). Pure. */
export const zonePlace = (zone) => {
  if (typeof zone !== 'string' || !zone) return null;
  const canonical = ZONE_PLACES.zones[zone] ? zone : ZONE_PLACES.links[zone];
  const at = canonical && ZONE_PLACES.zones[canonical];
  if (!at) return null;
  return Object.freeze({
    latitude: at[0],
    longitude: at[1],
    label: canonical.split('/').pop().replace(/_/g, ' '),
    zone: canonical,
    source: 'timezone-reference',
  });
};

/**
 * A place the witness gave, checked: finite coordinates in range, a short
 * label at most. Returns the clean place or throws with the reason. Pure.
 * @param {{latitude: number, longitude: number, label?: string}} given
 */
export const givenPlace = (given) => {
  const latitude = Number(given?.latitude);
  const longitude = Number(given?.longitude);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) throw new Error('latitude must be a number from -90 to 90');
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) throw new Error('longitude must be a number from -180 to 180');
  const label = typeof given?.label === 'string' ? given.label.trim().slice(0, 80) : '';
  return Object.freeze({ latitude: round(latitude), longitude: round(longitude), ...(label ? { label } : {}), source: 'witness-given' });
};

/**
 * The birth place record: the witness's place when given, else the zone's
 * reference city; null only when neither is known. Pure.
 * @param {{given?: object|null, zone?: string|null, at?: string}} input
 * @returns {object|null}
 */
export const birthPlaceOf = ({ given = null, zone = null, at = new Date().toISOString() } = {}) => {
  const place = given ? givenPlace(given) : zonePlace(zone);
  if (!place) return null;
  return Object.freeze({ schema: PLACE_SCHEMA, ...place, ...(zone && !place.zone ? { zone } : {}), recordedAt: at });
};
