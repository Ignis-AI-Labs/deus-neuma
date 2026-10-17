/**
 * A real witness for a real lane — the auth-mock replacement (#390 tranche 4).
 *
 * 67 test files still open with the repealed recipe:
 *
 *   vi.doMock('auth.js', () => ({ requireAuth: (req,_,next) => {
 *     req.walletAddress = '0xtest'; next(); } }))
 *
 * That injects an identity instead of proving one, so a route's ownership
 * gate is measured against a string the test chose. The real path is two
 * lines and needs no network or chain — auth.js is pure ethers plus an HMAC
 * — which is why the mock never bought anything.
 *
 * What this helper adds over calling createSessionToken directly (51 files
 * already do that, and that stays perfectly fine) is the PAIRING. The
 * ownership gate compares the token's address against owner.json on disk,
 * so a lane claimed by one address and a token minted for another fails in
 * a way that reads like a broken gate rather than a broken test. Binding
 * them to one wallet here removes that whole class of confusion.
 */
import { ethers } from 'ethers';
import { createSessionToken } from '../../backend/services/auth.js';
import { claimOwner } from './claim-owner.js';

/**
 * A witness wallet that genuinely owns `neumaId`, with a real session token.
 * impure (writes owner.json).
 *
 * @param {string} workspacesRoot - the temp root the workspace singleton points at
 * @param {string} neumaId - the lane this witness owns
 * @returns {Promise<{wallet: ethers.HDNodeWallet, address: string, token: string,
 *   authorize: (req: any) => any, header: {Authorization: string}}>}
 */
export const witnessFor = async (workspacesRoot, neumaId) => {
  const wallet = ethers.Wallet.createRandom();
  await claimOwner(workspacesRoot, neumaId, wallet.address);
  const token = createSessionToken(wallet.address);
  return {
    wallet,
    address: wallet.address,
    token,
    /** supertest: request(app).get(url).use? — call as authorize(request(app).get(url)) */
    authorize: (req) => req.set('Authorization', `Bearer ${token}`),
    header: { Authorization: `Bearer ${token}` },
  };
};

/**
 * A real wallet with a real session that owns NOTHING — the other half of
 * every ownership test. A 403 proven with this is a real gate refusing a
 * real stranger, not a mock returning false. impure only via key generation.
 */
export const strangerWitness = () => {
  const wallet = ethers.Wallet.createRandom();
  const token = createSessionToken(wallet.address);
  return {
    wallet,
    address: wallet.address,
    token,
    authorize: (req) => req.set('Authorization', `Bearer ${token}`),
    header: { Authorization: `Bearer ${token}` },
  };
};
