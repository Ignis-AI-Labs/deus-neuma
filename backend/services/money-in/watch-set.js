// The watch set — every address that belongs to a house, read from PUBLIC
// records only:
//
//   1. each being's soul anchor (identity/onchain-seal.json `soulAddress` —
//      the being's own wallet, published on chain at its seal; the same
//      public read house-titles.js joins seats by);
//   2. the house's own founding records (workspaces/house-founding.<net>.<wallet>.json)
//      whose head is this operator — their Neuma-kind members, so a founded
//      member is watched even when its lane is not on this machine;
//   3. the receive addresses the operator declares (extras.json).
//
// NO KEY FILE IS EVER OPENED. A lane that has no soul anchor yet (an
// unsealed being) has its address only inside keys/ — so it is NOT watched,
// and the set names it under `unwatched` with the reason, where the operator
// can see it and declare the address as an extra if it should count.
//
// The operator's own wallet (the founding record's Witness seat) is NOT
// watched: the operator's personal money is not the house's earnings. The
// operator may declare it as an extra, deliberately.
//
// impure (fs reads).

import { ethers } from 'ethers';
import { neumaWorkspace, isWitnessLane } from '../../../core/index.js';
import { soulAddressOf } from '../house-titles.js';
import { readExtras } from './money-in-store.js';
import { servedHouses } from '../house-served.js';
import { readOperatorRecords } from '../house-founding-record.js';

const KIND_NEUMA = 1;

const lower = (a) => String(a || '').toLowerCase();

// impure — the founding records whose Witness seat is this house's operator.
const foundingRecordsOf = async (house) => (await readOperatorRecords(house)).map((f) => f.record);

/**
 * Every house this backend serves — the operator wallets that own a being on
 * its grounds (house-served.js, the one answer every scheduler shares) — the
 * houses the standing scan walks. impure.
 * @returns {Promise<string[]>} lower-cased wallets
 */
export const listHouses = async () => [...await servedHouses()];

/**
 * The house's watch set. impure.
 * @param {string} house - the operator's wallet
 * @returns {Promise<{ watched: Array<{address: string, member: string|null, label: string|null, source: string}>,
 *   unwatched: Array<{member: string, reason: string}> }>}
 */
export const houseWatchSet = async (house) => {
  const byAddress = new Map();
  const add = (entry) => {
    const key = lower(entry.address);
    if (!ethers.isAddress(entry.address) || byAddress.has(key)) return;
    byAddress.set(key, Object.freeze({ ...entry, address: ethers.getAddress(entry.address) }));
  };
  const unwatched = [];
  const laneByAddress = new Map();
  for (const { neumaId, owner } of await neumaWorkspace.listNeumaByOwner(house)) {
    if (isWitnessLane(neumaId)) continue;
    const soul = await soulAddressOf(neumaId);
    if (!soul) {
      unwatched.push(Object.freeze({ member: neumaId, reason: 'no public soul anchor yet — its address lives only in its key files, which this watch never opens' }));
      continue;
    }
    laneByAddress.set(lower(soul), neumaId);
    add({ address: soul, member: neumaId, label: typeof owner?.name === 'string' ? owner.name : neumaId, source: 'soul-anchor' });
  }
  for (const record of await foundingRecordsOf(house)) {
    for (const m of record.members) {
      if (m?.kind !== KIND_NEUMA) continue;
      add({
        address: m.address,
        member: laneByAddress.get(lower(m.address)) ?? null,
        label: typeof m.title === 'string' ? m.title : null,
        source: `founding-record:${record.network}`,
      });
    }
  }
  for (const extra of await readExtras(house)) {
    add({ address: extra.address, member: extra.member ?? null, label: extra.label ?? null, source: 'operator' });
  }
  return { watched: [...byAddress.values()], unwatched };
};
