/**
 * Being wallet addresses — is an address one of this install's beings' own
 * keypairs?
 *
 * A being's keypair is its identity on chain, never an operator's sign-in.
 * /auth/verify issues a 24h OPERATOR session to any address that signs its
 * challenge, so a being's key (or anything that ever held it) could sign in
 * as an operator of the house. The operator door asks this first.
 *
 * Reads the same two key files /neuma-auth/verify matches a being against:
 * the password envelope (address in the clear) and the interim keypair.
 */
import neumaWorkspace from '../../core/workspace/neuma-workspace.js';

// impure — reads one lane's key files
const laneKeyAddresses = async (neumaId) => {
  const [encrypted, plain] = await Promise.all([
    neumaWorkspace.readEncryptedKeypair(neumaId),
    neumaWorkspace.readKeypair(neumaId),
  ]);
  return [encrypted?.address, plain?.address]
    .filter((address) => typeof address === 'string')
    .map((address) => address.toLowerCase());
};

/**
 * True when `address` is the keypair address of a neuma lane under the
 * current workspaces root. Witness lanes stand beside the house and are not
 * listed, so a sealed witness still signs in with its own wallet.
 * @param {string} address
 * @returns {Promise<boolean>}
 */
// impure — lists the workspaces root and reads every lane's key files
export const isBeingWalletAddress = async (address) => {
  const target = typeof address === 'string' ? address.toLowerCase() : '';
  if (!target) return false;
  const lanes = await neumaWorkspace.listNeuma();
  const addresses = await Promise.all(lanes.map(laneKeyAddresses));
  return addresses.some((laneAddresses) => laneAddresses.includes(target));
};
