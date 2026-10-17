// Cache the operator's session token across CLI invocations so we mint once,
// not on every command. The auth endpoint is rate-limited (10 / 5 min) and a
// real interactive session is many calls. The token is valid ~24h; we reuse
// it until it nears expiry, then re-mint. Cached in the OS temp dir, mode 600.
//
// The cache filename embeds a hash of (backend, walletEnv) so multiple
// configurations on one machine don't collide AND so the operator cache is
// distinct from the .claude/skills/neuma cache (different wallet, different
// token, different file).
//
// impure (filesystem + delegates to network mint)

import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { mintToken } from './auth.js';

const cachePath = (backend, walletEnv) => {
  const key = createHash('sha256').update(`${backend}|${walletEnv}`).digest('hex').slice(0, 16);
  return join(tmpdir(), `neuma-cli-token-${key}.json`);
};

// Session tokens are base64(address:expiresAt:hmac) — recover expiresAt.
// Treats malformed tokens as expired (returns 0) so we re-mint defensively.
const tokenExpiry = (token) => {
  try {
    const exp = Number(Buffer.from(token, 'base64').toString('utf8').split(':')[1]);
    return Number.isFinite(exp) ? exp : 0;
  } catch {
    return 0;
  }
};

/**
 * Reuse a still-valid cached token, else mint a fresh one and cache it.
 * @param {{ backend: string, walletEnv: string, privateKey: string }} params
 * @returns {Promise<{ token: string, address: string }>}
 */
export const getToken = async ({ backend, walletEnv, privateKey }) => {
  const path = cachePath(backend, walletEnv);
  try {
    const cached = JSON.parse(readFileSync(path, 'utf8'));
    if (cached.token && tokenExpiry(cached.token) - Date.now() > 60_000) {
      return { token: cached.token, address: cached.address };
    }
  } catch {
    // No cache, or unreadable/stale — fall through to mint.
  }
  const minted = await mintToken({ backend, privateKey });
  try {
    writeFileSync(path, JSON.stringify(minted), { mode: 0o600 });
  } catch {
    // Cache write is best-effort; the token still works for this run.
  }
  return minted;
};

/**
 * Drop the cached token so the next getToken re-mints — used when the backend
 * rejects a still-unexpired token (e.g. it restarted with a fresh secret).
 * impure
 * @param {{ backend: string, walletEnv: string }} params
 */
export const clearToken = ({ backend, walletEnv }) => {
  try {
    unlinkSync(cachePath(backend, walletEnv));
  } catch {
    // Nothing cached — already clear.
  }
};
