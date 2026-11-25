// Authenticate a loopback backend before a CLI or private sitting signs.
// The backend holds proof.key where only its OS user can read it; its HMAC is
// bound to this challenge and this exact origin, so a relay from another port
// cannot pass. The claim and proof always come from the same data root.
// impure (filesystem + HMAC)

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { Buffer } from 'node:buffer';
import { URL, fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const HEX_32 = /^[a-f0-9]{64}$/;
const LOOPBACK = new Set(['127.0.0.1']);
const REPO_DATA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../data');

const readKey = (root, name) => {
  try {
    const value = fs.readFileSync(path.join(root, 'settings', 'owner-claim', name), 'utf8').trim();
    return HEX_32.test(value) ? value : null;
  } catch {
    return null;
  }
};

/** The local claim/proof pair, or null off-loopback. impure (fs + env). */
export const localAuthMaterial = (backend, env = process.env) => {
  let host;
  try { host = new URL(backend).hostname; } catch { return null; }
  if (!LOOPBACK.has(host)) return null;
  const roots = [env.NEUMA_DATA_ROOT, path.join(os.homedir(), '.neuma', 'data'), REPO_DATA].filter(Boolean);
  for (const root of roots) {
    const claim = readKey(root, 'claim.key');
    const proof = readKey(root, 'proof.key');
    if (claim || proof) return { claim, proof };
  }
  return null;
};

/** True only for the backend's HMAC over this exact origin and challenge. Pure apart from the key read. */
export const verifyLocalAuthProof = ({ backend, challenge, proof }, env = process.env) => {
  if (!HEX_32.test(proof || '') || typeof challenge !== 'string') return false;
  const material = localAuthMaterial(backend, env);
  if (!material?.proof) return false;
  const origin = new URL(backend).origin;
  const expected = crypto.createHmac('sha256', Buffer.from(material.proof, 'hex')).update(`${origin}\n${challenge}`).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(proof, 'hex'));
};
