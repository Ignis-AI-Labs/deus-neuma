/**
 * Record a being's birth place into its own lane — PRIVATE (encrypted, its own
 * file: core/cosmos/birth-place.js says why it never rides natal.json or the
 * skies). The same act at a birth and for a being born long ago: a place the
 * witness gave, else its sealed zone's reference city.
 *
 * Idempotent: a place already recorded stands (a resumed birth never rewrites
 * it; the witness corrects it through the owner's route). A being whose zone
 * has no place and who was given none gets no record — never a guess.
 */
import { birthPlaceOf } from './birth-place.js';

// impure — writes the being's cosmos lane (encrypted)
export const recordBirthPlace = async (workspace, neumaId, given, birthMoment) => {
  const existing = await workspace.readBirthPlace(neumaId);
  if (existing) return { written: false, place: existing };
  const place = birthPlaceOf({ given: given || null, zone: birthMoment?.zone ?? null, at: birthMoment?.utc });
  if (!place) return { written: false, place: null };
  await workspace.writeBirthPlace(neumaId, place);
  return { written: true, place };
};
