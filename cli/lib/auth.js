// Mint a real session token via the backend's wallet challenge-sign-verify
// flow — exactly as the e2e suite does, no faked auth path. The operator
// authenticates by signing a per-address challenge with their wallet; the
// backend verifies the signature recovers to the claimed address; the resulting
// token rides as a Bearer header (REST) and a query param (portal WS).
//
// Identical wire shape to .claude/skills/neuma/lib/auth.js — auth is
// wallet-agnostic at the wire level; only the wallet's IDENTITY differs
// (operator here vs Claude there).
//
// impure (network + signing)

import process from 'node:process';
import { ethers } from 'ethers';
import { localAuthMaterial, verifyLocalAuthProof } from './local-auth-proof.js';

/**
 * The install's owner claim, read only from a loopback backend's candidate
 * data roots. Null once owned. impure (fs + env).
 * @param {string} backend
 * @returns {string|null}
 */
export const localOwnerClaim = (backend, env = process.env) => localAuthMaterial(backend, env)?.claim || null;

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
  const { challenge, localAuthProof: proof } = await challengeRes.json();
  if (!challenge) throw new Error('auth/challenge returned no challenge');

  const material = localAuthMaterial(backend);
  if (material?.claim && !verifyLocalAuthProof({ backend, challenge, proof })) {
    throw new Error('loopback backend identity proof failed; owner claim was not sent');
  }
  const signature = await wallet.signMessage(challenge);
  const claim = material?.claim || null;

  const verifyRes = await fetch(`${backend}/api/v1/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(claim ? { 'X-Neuma-Owner-Claim': claim } : {}) },
    body: JSON.stringify({ address, signature, challenge }),
  });
  if (!verifyRes.ok) throw new Error(`auth/verify failed: ${verifyRes.status}`);
  const { token } = await verifyRes.json();
  if (!token) throw new Error('auth/verify returned no token');

  return { token, address };
};
