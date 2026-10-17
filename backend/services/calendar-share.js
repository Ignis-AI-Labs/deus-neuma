// calendar-share.js — the operator's SUBSCRIBE LINK for their task deadlines.
//
// A calendar app (phone, Google, Apple) cannot carry the desk's Bearer
// session, so the feed authenticates with a per-wallet share token riding
// the URL. The trade-off is stated, not hidden: a URL leak reads the
// deadlines feed — nothing more; the feed is read-only by construction and
// the token is revocable in one call (a revoke kills every old link).
//
// Tokens live at the realm ROOT (not per-wallet) because the only operation
// that needs them is […] — a reverse
// lookup a per-wallet file would have to scan the whole realm to answer.
// One atomic JSON file, the realm-persistence law (writeJsonAtomic).
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { getRealmRoot, writeJsonAtomic } from './user-realm.js';
import { createLogger } from './logger.js';

const log = createLogger('CalendarShare');

const tokensFile = () => path.join(getRealmRoot(), 'calendar-tokens.json');

// impure — the whole token map: { [token]: { wallet, createdAt } }.
const readTokens = async () => {
  try {
    const parsed = JSON.parse(await fs.readFile(tokensFile(), 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw err;
  }
};

const writeTokens = (tokens) => writeJsonAtomic(tokensFile(), tokens);

/**
 * Mint (or replace) the wallet's share token. One live token per wallet —
 * minting again invalidates the old link, which is the revocation story a
 * single-holder operator actually needs. impure.
 * @param {string} wallet
 * @returns {Promise<{token: string, createdAt: string}>}
 */
export const mintCalendarToken = async (wallet) => {
  const key = String(wallet).toLowerCase();
  const tokens = await readTokens();
  // A fresh token every mint — the old one stops matching the moment this
  // write lands (single-holder law: the newest link IS the link).
  for (const [token, entry] of Object.entries(tokens)) {
    if (String(entry?.wallet).toLowerCase() === key) delete tokens[token];
  }
  const token = crypto.randomBytes(24).toString('hex');
  const createdAt = new Date().toISOString();
  tokens[token] = { wallet: key, createdAt };
  await writeTokens(tokens);
  log.info('calendar share token minted', { wallet: key });
  return { token, createdAt };
};

/** Revoke the wallet's share token, if one stands. impure. */
export const revokeCalendarToken = async (wallet) => {
  const key = String(wallet).toLowerCase();
  const tokens = await readTokens();
  const before = Object.keys(tokens).length;
  const next = Object.fromEntries(
    Object.entries(tokens).filter(([, entry]) => String(entry?.wallet).toLowerCase() !== key),
  );
  if (Object.keys(next).length === before) return false;
  await writeTokens(next);
  return true;
};

/**
 * The wallet a feed token belongs to, or null — an unknown token reads as
 * no wallet, never as a guessed one. impure.
 * @param {string} token
 * @returns {Promise<string|null>}
 */
export const walletForCalendarToken = async (token) => {
  if (typeof token !== 'string' || token.length < 24) return null;
  const tokens = await readTokens();
  return tokens[token]?.wallet ?? null;
};
