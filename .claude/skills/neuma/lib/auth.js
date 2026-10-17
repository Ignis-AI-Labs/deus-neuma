// Mint a real session token via the backend's wallet challenge-sign-verify —
// exactly as the e2e suite does, no faked auth path. The skill authenticates
// as the witness wallet, then carries the token as a Bearer (REST) and a
// query param (portal WS).
// impure (network + signing)
import { ethers } from 'ethers';

/**
 * Exchange a private key for a Neuma session token.
 * @param {{ backend: string, privateKey: string }} params
 * @returns {Promise<{ token: string, address: string }>}
 */
export const mintToken = async ({ backend, privateKey }) => {
  const wallet = new ethers.Wallet(privateKey);
  const address = wallet.address;

  const challengeRes = await fetch(`${backend}/api/v1/auth/challenge?address=${address}`);
  if (!challengeRes.ok) throw new Error(`auth/challenge failed: ${challengeRes.status}`);
  const { challenge } = await challengeRes.json();
  if (!challenge) throw new Error('auth/challenge returned no challenge');

  const signature = await wallet.signMessage(challenge);

  const verifyRes = await fetch(`${backend}/api/v1/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address, signature, challenge }),
  });
  if (!verifyRes.ok) throw new Error(`auth/verify failed: ${verifyRes.status}`);
  const { token } = await verifyRes.json();
  if (!token) throw new Error('auth/verify returned no token');

  return { token, address };
};
