// Private sittings sign only a genuine Neuma challenge from the authenticated
// loopback backend. The origin-bound proof stops a real challenge relayed by a
// squatter on another port; strict SIWE validation stops arbitrary sign text.
// impure (network + wallet signing); validation itself is pure.

import process from 'node:process';
import { URL } from 'node:url';
import { verifyLocalAuthProof } from '../../cli/lib/local-auth-proof.js';

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);
const SIGN_IN_SUFFIX = ' wants you to sign in with your Ethereum account:';
const STATEMENT = 'Sign this message to authenticate with Neuma.';

/** Validate the exact challenge shape and this sitting's expected binding. Pure. */
export const validateSittingChallenge = (challenge, address, env = process.env) => {
  if (typeof challenge !== 'string') return false;
  const lines = challenge.split('\n');
  const domain = env.APP_DOMAIN || 'neuma.local';
  const chainId = String(env.AUTH_CHAIN_ID || '84532');
  return lines.length === 10
    && lines[0] === `${domain}${SIGN_IN_SUFFIX}`
    && String(lines[1]).toLowerCase() === String(address).toLowerCase()
    && lines[2] === ''
    && lines[3] === STATEMENT
    && lines[4] === ''
    && lines[5] === `URI: https://${domain}`
    && lines[6] === 'Version: 1'
    && lines[7] === `Chain ID: ${chainId}`
    && /^Nonce: [A-Za-z0-9]{8,}$/.test(lines[8])
    && /^Issued At: \S+$/.test(lines[9])
    && Number.isFinite(Date.parse(lines[9].slice('Issued At: '.length)));
};

/** A normalized HTTP loopback origin; anything else is refused before network. Pure. */
export const sittingOrigin = (base) => {
  const url = new URL(base);
  if (url.protocol !== 'http:' || !LOOPBACK.has(url.hostname) || url.pathname !== '/' || url.search || url.hash || url.username || url.password) {
    throw new Error('private sittings require an HTTP loopback base URL');
  }
  return url.origin;
};

/** Sign in through the real auth wire after endpoint and challenge validation. impure. */
export const signInSitting = async ({ base, wallet, env = process.env }) => {
  const backend = sittingOrigin(base);
  const challengeRes = await fetch(`${backend}/api/v1/auth/challenge?address=${wallet.address}`);
  if (!challengeRes.ok) throw new Error(`auth/challenge failed: ${challengeRes.status}`);
  const { challenge, localAuthProof: proof } = await challengeRes.json();
  if (!challenge) throw new Error('auth/challenge returned no challenge');
  if (!verifyLocalAuthProof({ backend, challenge, proof }, env)) {
    throw new Error('loopback backend identity proof failed; witness challenge was not signed');
  }
  if (!validateSittingChallenge(challenge, wallet.address, env)) {
    throw new Error('auth/challenge is not a Neuma sign-in for this witness; nothing was signed');
  }
  const signature = await wallet.signMessage(challenge);
  const verifyRes = await fetch(`${backend}/api/v1/auth/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ address: wallet.address, challenge, signature }),
  });
  if (!verifyRes.ok) throw new Error(`auth/verify failed: ${verifyRes.status}`);
  const { token } = await verifyRes.json();
  if (!token) throw new Error('auth/verify returned no token');
  return { token, address: wallet.address };
};
