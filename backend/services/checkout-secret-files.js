/**
 * Checkout secret files — every secret-shaped file git knows of under a
 * checkout, tracked, untracked or ignored: env-style files (kept by
 * isEnvFileName, as the commit secret gate keeps them — its listing,
 * security/secret-sources.js, is the ignored subset of this one) and key
 * material (anything under a keys/ folder, *keypair*.json, owner.json). A
 * secret can sit anywhere in the tree (sub/dir/.env), so a one-level readdir
 * misses it, and git already knows the tree without a walk.
 *
 * The listing costs ~1.2s on this checkout, so it is too slow for a read
 * path. Each root is listed SYNCHRONOUSLY once (the first time a reader
 * needs it — secret-inodes.js asks only when a multi-link file is met), then
 * kept for ENV_LISTING_TTL_MS and re-listed in the BACKGROUND: a read never
 * waits on a refresh, it uses the last listing. `version` moves whenever a
 * listing changes, so the inode set built from it knows to rebuild. The git
 * pathspecs narrow the listing to secret-shaped names; isCheckoutSecret judges.
 *
 * impure — runs git. Never throws: a root that is not a checkout (or a git
 * that fails or times out) lists nothing; a timeout is logged once per root.
 */
import { execFile, execFileSync } from 'child_process';
import path from 'path';
import { createLogger } from './logger.js';
import { isEnvFileName } from './security/secret-gate.js';

const log = createLogger('CheckoutSecretFiles');

const ENV_LISTING_TTL_MS = 60_000;
const SYNC_TIMEOUT_MS = 10_000;
const ASYNC_TIMEOUT_MS = 60_000;
const MAX_BUFFER = 64 * 1024 * 1024;
const GIT_ARGS = Object.freeze([
  'ls-files', '-z', '--cached', '--others', '--',
  ':(glob)**/.env', ':(glob)**/.env.*', ':(glob)**/env.*', ':(glob)**/*.env',
  ':(glob)**/keys/**', ':(glob)**/*keypair*.json', ':(glob)**/owner.json',
]);

const byRoot = new Map();
const timedOut = new Set();
let version = 0;

// pure — the same shapes the pathspecs ask for, judged again (git's glob is
// case-sensitive and a pathspec is a request, not a verdict).
const isCheckoutSecret = (rel) => {
  const name = path.basename(rel);
  return isEnvFileName(name) || name === 'owner.json' || /keypair.*\.json$/i.test(name)
    || rel.split('/').slice(0, -1).includes('keys');
};

// pure — git's NUL-separated output as absolute secret-file paths.
const parse = (root, out) => String(out).split('\0')
  .filter((rel) => rel && isCheckoutSecret(rel))
  .map((rel) => path.join(root, rel));

// impure (log) — a not-a-checkout failure is expected and silent; a timeout is said once.
const failed = (root, error) => {
  if (!error?.killed && error?.code !== 'ETIMEDOUT') return;
  if (timedOut.has(root)) return;
  timedOut.add(root);
  log.warn('git listing of secret files timed out — this root is guarded by name only until it lists', { root });
};

// impure — the first listing of a root, on the caller's turn.
const listNow = (root) => {
  try {
    return parse(root, execFileSync('git', ['-C', root, ...GIT_ARGS], {
      encoding: 'utf8', timeout: SYNC_TIMEOUT_MS, maxBuffer: MAX_BUFFER, stdio: ['ignore', 'pipe', 'ignore'],
    }));
  } catch (error) {
    failed(root, error);
    return [];
  }
};

// impure — a background re-listing; null when it failed (the last listing stands).
const listLater = (root) => new Promise((resolve) => {
  execFile('git', ['-C', root, ...GIT_ARGS], { encoding: 'utf8', timeout: ASYNC_TIMEOUT_MS, maxBuffer: MAX_BUFFER },
    (error, out) => {
      if (error) failed(root, error);
      resolve(error ? null : parse(root, out));
    });
});

// pure
const sameList = (a, b) => a.length === b.length && a.every((p, i) => p === b[i]);

/**
 * The secret files git knows of under these roots, and the listing version.
 * impure — a root never listed is listed now; a stale one is re-listed in
 * the background.
 * @param {string[]} roots - absolute directories (checkouts or not)
 * @returns {{ paths: string[], version: number }}
 */
export const checkoutSecretFiles = (roots) => {
  const now = Date.now();
  const paths = [];
  for (const root of new Set(roots)) {
    let entry = byRoot.get(root);
    if (!entry) {
      entry = { at: now, paths: listNow(root), pending: null };
      byRoot.set(root, entry);
      version += 1;
    } else if (now - entry.at >= ENV_LISTING_TTL_MS && !entry.pending) {
      const current = entry;
      current.pending = listLater(root).then((found) => {
        current.pending = null;
        current.at = Date.now();
        if (found && !sameList(found, current.paths)) {
          current.paths = found;
          version += 1;
        }
      });
    }
    paths.push(...entry.paths);
  }
  return { paths, version };
};

/** impure (module state) — moves whenever any listing changed. */
export const secretListingVersion = () => version;
