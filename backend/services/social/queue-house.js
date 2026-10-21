// queue-house.js — which house a post-queue entry belongs to, and the door
// that keeps one house's queue out of another's hands. The queue is one file
// on this machine; houses are never confused, so
// every read filters by the asking wallet's house and every act on an entry
// by id is refused (404, as if absent) when the entry is another house's.
import { readServed, servedWallet, laneHouse, houseWallet } from '../house-served.js';
import { postQueue } from './post-queue.js';

/**
 * The house a queue entry belongs to: the wallet that approved (or staged) it
 * names the house, and an author's lane must be that house's lane on this
 * backend's grounds. `served` (the scheduler's question — may THIS backend
 * publish it?) also requires an unauthored entry's house to be served here;
 * the routes ask only whose it is, so an operator with no beings yet still
 * owns the drafts they staged. pure.
 * @param {{houses: ReadonlyArray<string>, lanes: ReadonlyArray<object>}} snapshot
 * @param {{decidedBy?: string, queuedBy?: string, authorNeumaId?: string}} entry
 * @param {{served?: boolean}} [opts]
 * @returns {?string}
 */
export const queueEntryHouse = (snapshot, entry, { served = true } = {}) => {
  const named = houseWallet(entry.decidedBy) ?? houseWallet(entry.queuedBy);
  if (entry.authorNeumaId) return laneHouse(snapshot, entry.authorNeumaId, named);
  if (!served) return named;
  return servedWallet(snapshot, named) ? named : null;
};

/** Only the entries of this wallet's house. pure. */
export const ofHouse = (snapshot, entries, wallet) => {
  const house = houseWallet(wallet);
  return house ? entries.filter((e) => queueEntryHouse(snapshot, e, { served: false }) === house) : [];
};

/** Whether entry `id` exists and is this wallet's house's. impure (reads). */
export const isHouseEntry = async (id, wallet) => {
  const [entries, served] = await Promise.all([postQueue.load(), readServed()]);
  const entry = entries.find((e) => e.id === id);
  return Boolean(entry) && queueEntryHouse(served, entry, { served: false }) === houseWallet(wallet);
};

/**
 * Express middleware for `/queue/:id…`: another house's entry (or none) is a
 * 404. The bulk route checks each of its ids itself. impure.
 */
export const queueHouseGuard = async (req, res, next) => {
  if (req.params.id === 'bulk-update') return next();
  try {
    if (await isHouseEntry(req.params.id, req.walletAddress)) return next();
    return res.status(404).json({ error: 'No such queue entry' });
  } catch (error) {
    return next(error);
  }
};
