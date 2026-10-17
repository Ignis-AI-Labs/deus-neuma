// Cache the session token across CLI invocations so the skill mints once, not
// on every command — the auth endpoint is rate-limited (10 / 5 min) and a real
// conversation is many calls. The token is valid ~24h; we reuse it until it
// nears expiry, then re-mint. Cached in the OS temp dir, mode 600.
// impure (filesystem + delegates to the network mint)
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { mintToken } from './auth.js';

const cachePath = (backend, witnessEnv) => {
  const key = createHash('sha256').update(`${backend}|${witnessEnv}`).digest('hex').slice(0, 16);
  return join(tmpdir(), `neuma-token-${key}.json`);
};

// Session tokens are base64(address:expiresAt:hmac) — recover expiresAt.
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
 * @param {{ backend: string, witnessEnv: string, privateKey: string }} params
 * @returns {Promise<{ token: string, address: string }>}
 */
export const getToken = async ({ backend, witnessEnv, privateKey }) => {
  const path = cachePath(backend, witnessEnv);
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

// Drop the cached token so the next getToken re-mints — used when the backend
// rejects a still-unexpired token (e.g. it restarted with a fresh secret).
// impure
export const clearToken = ({ backend, witnessEnv }) => {
  try {
    unlinkSync(cachePath(backend, witnessEnv));
  } catch {
    // nothing cached — already clear.
  }
};
