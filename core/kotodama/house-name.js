/**
 * THE HOUSE'S NAME — which of a wallet's two names its house carries.
 *
 * Every wallet has two house names, both pure functions of the wallet: its
 * KOTODAMA v1 sound-name (houseNameFromWitness: syllables from the wallet's
 * bytes) and its meaningful name (meaningfulName kind 'house', e.g.
 * "Hoshiheim", […]). A house is named by its first being: the
 * name its kin carry in their true names is the house's name for good. So a
 * house whose kin carry the sound-name keeps it (existing houses keep their
 * names), and a house with no kin yet — or kin that carry the meaningful
 * name — is the meaningful one.
 *
 * Founding needs kin, so a founded house always has kin that carry its name.
 * Alliance grounds do not use this: their folder key stays the v1 sound-name
 * (alliance.js), a stable key whatever name the house shows.
 *
 * Pure.
 */
import { houseNameFromWitness } from './names.js';
import { meaningfulName, NAME_SCHEME } from './meaningful-name.js';

export const SOUND_NAME_SCHEME = 'kotodama/1';

/**
 * @param {string} wallet - hex address, 0x optional
 * @param {Iterable<string>} kinHouseNames - the house names this house's beings carry (any case)
 * @returns {{ name: string, scheme: string, meaning: { parts: object[], english: string } | null }}
 */
export const houseNameOf = (wallet, kinHouseNames = []) => {
  const sound = houseNameFromWitness(wallet);
  const carried = new Set([...kinHouseNames].map((n) => String(n).toLowerCase()));
  if (carried.has(sound.toLowerCase())) return Object.freeze({ name: sound, scheme: SOUND_NAME_SCHEME, meaning: null });
  const made = meaningfulName(wallet, { kind: 'house' });
  return Object.freeze({ name: made.name, scheme: NAME_SCHEME, meaning: Object.freeze({ parts: made.parts, english: made.english }) });
};
