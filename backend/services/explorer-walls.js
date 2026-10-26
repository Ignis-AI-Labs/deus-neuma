// THE EXPLORER'S WALLS — what the operator's file explorer never serves or
// writes, inside an opened folder or not (audit 3, E4).
//
// The explorer browses and edits anything inside the folders the operator
// opened (user-files.js). That is their own disk, but two kinds of file on it
// are not a file editor's to hand out: the secrets the platform runs on (the
// .env with AUTH_SECRET and the DNA key, keypairs, owner records, the
// credential stores) and another house's data (Design note, 2026-10-16: two houses on
// one machine are never confused). A folder opened on the checkout, or on the
// realm, used to serve all of it to any signed-in wallet.
//
// Who may reach how much of the disk is the install owner's question
// (explorer-ground.js). These walls stand for every wallet, the owner too.

import fs from 'fs';
import path from 'path';
import { isSecretFile } from './secret-path-classifier.js';
import { secretLinkReason } from './secret-inodes.js';
import { matchesDeniedPattern } from './sandbox-path-policy.js';
import { getRealmRoot } from './user-realm.js';
import { foldName } from './wall-spelling.js';
import { getWorkspacesRoot, getWitnessesRoot } from '../../core/workspace/neuma-workspace.js';

// The secret-shaped walls of the being sandbox that mean a secret on the
// operator's disk too. Its .git/ and node_modules/ walls are not here: an
// operator reads their own repository.
const SECRET_PLACES = Object.freeze(['vault/', '.ssh/', 'keys/', 'owner.json', 'data/dna/', 'data/dna-cache/']);
const WALLET_DIR = /^0x[a-f0-9]{40}$/;
const SECRET_REASON = 'it holds a secret the platform runs on (keys, credentials, owner records, sealed DNA)';
const HOUSE_REASON = "it is another house's data";
const GROUND_REASON = "it holds every house's data — the explorer never moves or deletes it";

// pure — is `inner` the same as or below `outer`?
// Compared in the wall spelling (wall-spelling.js): a case- or normalization-insensitive volume
// (macOS) opens one file under many spellings, so the walls fold every name the same way (#589).
const within = (inner, outer) => {
  const [i, o] = [foldName(inner), foldName(outer)];
  return i === o || i.startsWith(o + path.sep);
};

/**
 * Is this path secret-shaped? Pure.
 * @param {string} target - absolute path
 * @returns {boolean}
 */
const isSecretPlace = (target) => {
  const normalized = foldName(path.normalize(target));
  const parts = normalized.split(/[\\/]/).filter(Boolean);
  return parts.some((part) => isSecretFile(part))
    || /keypair/i.test(parts.at(-1) || '')
    || SECRET_PLACES.some((pattern) => matchesDeniedPattern(normalized, pattern));
};

// impure — the path with symlinks followed as far as it exists
export const realOf = (target) => {
  let probe = target;
  const rest = [];
  for (;;) {
    try {
      return path.join(fs.realpathSync(probe), ...rest);
    } catch {
      const parent = path.dirname(probe);
      if (parent === probe) return target;
      rest.unshift(path.basename(probe));
      probe = parent;
    }
  }
};

// impure — the wallet a lane's owner.json names, or null
const laneOwner = (laneDir) => {
  try {
    const wallet = JSON.parse(fs.readFileSync(path.join(laneDir, 'owner.json'), 'utf8'))?.wallet;
    return typeof wallet === 'string' ? wallet.toLowerCase() : null;
  } catch {
    return null;
  }
};

// impure — does this path lie in another house's realm dir or lane? The lane's
// folder is read as typed and as folded, so a respelling never hides its owner.
const isOtherHouse = (target, reader) => {
  const realm = path.resolve(getRealmRoot());
  if (within(target, realm) && foldName(target) !== foldName(realm)) {
    const top = foldName(path.relative(foldName(realm), foldName(target)).split(path.sep)[0]);
    if (WALLET_DIR.test(top) && top !== reader) return true;
  }
  for (const ground of [getWorkspacesRoot(), getWitnessesRoot()].map((g) => path.resolve(g))) {
    if (!within(target, ground) || foldName(target) === foldName(ground)) continue;
    const segment = (t, g) => path.relative(g, t).split(path.sep)[0];
    const owner = laneOwner(path.join(ground, segment(target, ground)))
      ?? laneOwner(path.join(ground, segment(foldName(target), foldName(ground))));
    if (owner && owner !== reader) return true;
  }
  return false;
};

// impure — does a mutation of this path take a whole ground with it?
const holdsAGround = (target) => [getRealmRoot(), getWorkspacesRoot(), getWitnessesRoot()]
  .some((ground) => within(path.resolve(ground), target));

/**
 * Why the explorer refuses this path for this wallet, or null when it may
 * proceed. Both the asked path and the path its symlinks reach are judged.
 * impure (reads the disk).
 * @param {string} target - the client's path, absolute
 * @param {string} wallet - the signed-in reader
 * @param {{write?: boolean}} [opts] - a write, create, rename or delete
 * @returns {?string}
 */
const explorerRefusal = (target, wallet, { write = false } = {}) => {
  if (typeof target !== 'string' || !path.isAbsolute(target)) return null;
  const reader = String(wallet || '').toLowerCase();
  const asked = path.resolve(target);
  // A hard link gives a secret's bytes an innocent name no name law knows
  // (secret-inodes.js); one stat, symlinks followed.
  if (secretLinkReason(asked)) return SECRET_REASON;
  for (const candidate of new Set([asked, realOf(asked)])) {
    if (isSecretPlace(candidate)) return SECRET_REASON;
    if (isOtherHouse(candidate, reader)) return HOUSE_REASON;
    if (write && holdsAGround(candidate)) return GROUND_REASON;
  }
  return null;
};

// pure — every path a request to the explorer names, from its query and body
export const namedPaths = (req) => {
  const query = req.query || {};
  const body = req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body) ? req.body : {};
  const listed = [query.path, body.path, body.from, body.to, body.root].flat();
  if (typeof query.path === 'string' && typeof query.name === 'string') listed.push(path.join(query.path, query.name));
  if (typeof body.parent === 'string' && typeof body.name === 'string') listed.push(path.join(body.parent, body.name));
  return listed.filter((p) => typeof p === 'string');
};

/**
 * Express middleware: a request that names a walled path is a 403 with the
 * reason, before any handler opens it. A GET reads, opening a folder reads,
 * closing one is always allowed; every other method writes. impure.
 */
export const explorerWalls = (req, res, next) => {
  if (req.path === '/roots' && req.method === 'DELETE') return next();
  const write = req.method !== 'GET' && req.path !== '/roots';
  for (const target of namedPaths(req)) {
    const reason = explorerRefusal(target, req.walletAddress, { write });
    if (reason) return res.status(403).json({ error: `The explorer never opens or writes that path: ${reason}.` });
  }
  return next();
};
