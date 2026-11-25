// The in-process agent seat must authenticate its caller, not borrow the
// wallet written in the lane's owner record. impure (wallet env fs + address).

import { operatorAddress } from './wallet.js';
import { resolveWalletEnvPath } from './wallet-env.js';

/** Return the authenticated owner address or a plain refusal. impure (fs). */
export const authenticateAgentOwner = ({ cwd, laneId, owner }) => {
  if (!owner?.wallet) return { error: `${laneId} has no operator ownership record` };
  try {
    const address = operatorAddress(resolveWalletEnvPath(cwd));
    if (address.toLowerCase() !== String(owner.wallet).toLowerCase()) {
      return { error: `${laneId}: configured wallet ${address} does not own this lane (${owner.wallet})` };
    }
    return { address };
  } catch (error) {
    return { error: `${laneId}: operator wallet authentication failed — ${error.message}` };
  }
};
