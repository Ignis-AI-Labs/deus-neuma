// The stop a house's company line stands at: the involvement its APPROVED
// charter names. A charter not yet approved, or none, stands the line at the
// dial's default — which takes the gates, so an edit waiting for the
// operator's approval can only add their inspections, never remove them.
// impure (reads the charter).

import { readCharter } from '../house-clock/charter-read.js';
import { charterStanding } from '../house-clock/charter-shape.js';
import { DEFAULT_STOP, stopOf } from './involvement-dial.js';

/**
 * @param {string} wallet - the house
 * @returns {Promise<string>} one of the dial's STOPS
 */
export const houseStop = async (wallet) => {
  const charter = await readCharter(wallet).catch(() => null);
  const standing = charterStanding(charter);
  return standing === 'active' || standing === 'paused' ? stopOf(charter.involvement) : DEFAULT_STOP;
};
