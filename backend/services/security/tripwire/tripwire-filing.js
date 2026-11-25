// Tripwire filing — a finding into the threat ledger, and the card that
// follows a new critical. A decoy read is the machine's, so it goes to every
// house the watch serves; a swapped clipboard address goes to the house whose
// operator saw it.

import { threatLedgerFor } from '../threat-ledger.js';
import { alertOnNewCriticals } from '../security-alerts.js';

/**
 * One finding into one house's ledger. impure.
 * @returns {Promise<?Object>} the entry when it is new, else null
 */
export const fileToHouse = async (finding, wallet, { ledgerFor = threatLedgerFor, alert = alertOnNewCriticals } = {}) => {
  const ledger = await ledgerFor(wallet);
  const { added } = await ledger.ingest([finding]);
  await alert(added, wallet, { ledger });
  return added[0] || null;
};

/**
 * A filer for the watch: every finding to every house `houses()` names.
 * @param {{houses: () => Promise<string[]>}} opts
 * @returns {(finding: Object) => Promise<void>}
 */
export const fileToHouses = ({ houses }) => async (finding) => {
  for (const wallet of await houses()) await fileToHouse(finding, wallet);
};
