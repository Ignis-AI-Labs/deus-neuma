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

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { URL, fileURLToPath } from 'node:url';
import { ethers } from 'ethers';

const CLAIM = /^[a-f0-9]{64}$/;
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);
const REPO_DATA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../data');

/**
 * The install's owner claim (backend/services/owner-claim.js), read the way a
 * backend on this computer resolves its data root: NEUMA_DATA_ROOT, the
 * packaged home root, the repo's data/. Sent only to a loopback backend, so on
 * a fresh install the operator's own CLI can seat the owner; null once owned.
 * impure (fs + env).
 * @param {string} backend
 * @returns {string|null}
 */
export const localOwnerClaim = (backend, env = process.env) => {
  let host;
  try { host = new URL(backend).hostname; } catch { return null; }
  if (!LOOPBACK.has(host)) return null;
  const roots = [env.NEUMA_DATA_ROOT, path.join(os.homedir(), '.neuma', 'data'), REPO_DATA].filter(Boolean);
  for (const root of roots) {
    try {
      const text = fs.readFileSync(path.join(root, 'settings', 'owner-claim', 'claim.key'), 'utf8').trim();
      if (CLAIM.test(text)) return text;
    } catch { /* not this root */ }
  }
  return null;
};

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
  const claim = localOwnerClaim(backend);

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
