// Cache the session token across CLI invocations so the skill mints once, not
// on every command — the auth endpoint is rate-limited (10 / 5 min) and a real
// conversation is many calls. The token is valid ~24h; we reuse it until it
// nears expiry, then re-mint. Cached in ~/.neuma/cli (0700), each file 0600 —
// never a shared temp dir, where its predictable name let another local user
// plant a file the CLI would trust or read (audit 2026-10-28 L-05). A cached
// file counts only when it is a plain file this user owns, closed to others.
// impure (filesystem + delegates to the network mint)
import { lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { mintToken } from './auth.js';

const CACHE_DIR = join(homedir(), '.neuma', 'cli');

const cachePath = (backend, witnessEnv) => {
  const key = createHash('sha256').update(`${backend}|${witnessEnv}`).digest('hex').slice(0, 16);
  return join(CACHE_DIR, `token-${key}.json`);
};

// impure — is this cache file one this user wrote: a plain file, theirs, closed to others?
const trustworthy = (path) => {
  const st = lstatSync(path);
  if (!st.isFile()) return false;
  if (process.platform === 'win32') return true;
  return st.uid === process.getuid() && (st.mode & 0o077) === 0;
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
    const cached = trustworthy(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
    if (cached.token && tokenExpiry(cached.token) - Date.now() > 60_000) {
      return { token: cached.token, address: cached.address };
    }
  } catch {
    // No cache, or unreadable/stale — fall through to mint.
  }
  const minted = await mintToken({ backend, privateKey });
  try {
    mkdirSync(CACHE_DIR, { recursive: true, mode: 0o700 });
    // a fresh file (never an existing one followed), then an atomic rename
    const fresh = `${path}.${process.pid}.tmp`;
    writeFileSync(fresh, JSON.stringify(minted), { mode: 0o600, flag: 'wx' });
    renameSync(fresh, path);
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
