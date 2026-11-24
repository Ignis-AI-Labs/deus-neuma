import { readInstallOwner, standingIn } from './install-owner.js';

/** Refresh the connection's authority to acquire filesystem scope. impure — install record. */
export const refreshPortalScopeStanding = async (connection) => {
  const standing = standingIn(await readInstallOwner().catch(() => null), connection.walletAddress);
  connection._scopeGrantsAllowed = ['owner', 'co-owner'].includes(standing);
  return connection._scopeGrantsAllowed;
};
