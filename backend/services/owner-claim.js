// THE OWNER CLAIM — what a first sign-in must show to seat the install owner
// (ruling, 2026-10-30).
//
// On an install no one owns yet, the first wallet at the local desk becomes
// its owner (install-owner.js). The desk is loopback, and loopback is shared
// by every OS user on the computer, so on its own word whoever opened the app
// first took the machine. The seat now also needs this one-time secret: the
// backend writes it, while no owner stands, to a folder only the OS user that
// runs it can enter (0700, the file 0600). The desk app's main process and the
// `neuma` CLI run as that user and read it; another account cannot. It is
// removed once an owner stands.

import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { getSettingsDir } from './data-root.js';

export const OWNER_CLAIM_HEADER = 'x-neuma-owner-claim';
const SECRET = /^[a-f0-9]{64}$/;

const claimDir = () => path.join(getSettingsDir(), 'owner-claim');

/** Where the claim lives. impure (reads the data root). */
export const ownerClaimPath = () => path.join(claimDir(), 'claim.key');

const readClaim = async () => {
  try {
    const text = (await fs.readFile(ownerClaimPath(), 'utf8')).trim();
    return SECRET.test(text) ? text : null;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
};

/**
 * The claim, written now when absent or malformed. Written whole and owner-only
 * before it takes its name, so a reader never sees half a secret. impure (fs).
 * @returns {Promise<string>}
 */
export const ensureOwnerClaim = async () => {
  const existing = await readClaim();
  if (existing) return existing;
  await fs.mkdir(claimDir(), { recursive: true, mode: 0o700 });
  await fs.chmod(claimDir(), 0o700);
  const tmp = `${ownerClaimPath()}.${process.pid}.${crypto.randomBytes(4).toString('hex')}`;
  await fs.writeFile(tmp, crypto.randomBytes(32).toString('hex'), { mode: 0o600, flag: 'wx' });
  try {
    await fs.rename(tmp, ownerClaimPath());
  } finally {
    await fs.rm(tmp, { force: true });
  }
  return readClaim();
};

/**
 * Does the presented value equal the claim? Compared in constant time; a
 * missing claim is written first, so it can never be matched by absence.
 * impure (fs).
 * @param {unknown} presented
 * @returns {Promise<boolean>}
 */
export const ownerClaimMatches = async (presented) => {
  const offered = typeof presented === 'string' ? presented.trim() : '';
  const secret = await ensureOwnerClaim();
  if (!SECRET.test(offered) || !secret) return false;
  return crypto.timingSafeEqual(Buffer.from(offered), Buffer.from(secret));
};

/** The claim is spent: an owner stands. impure (fs). */
export const clearOwnerClaim = () => fs.rm(ownerClaimPath(), { force: true });
