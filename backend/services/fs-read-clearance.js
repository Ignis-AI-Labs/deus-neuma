// THE DENY LAW AT READ TIME — the sandbox judges a read's path, then the
// filesystem organ resolves it again and opens it. Between the two, a symlink
// inside the being's own roots can be swapped onto a secret (.env, a keypair):
// the sandbox cleared the old target, the organ followed the new one. So the
// organ's read handlers re-judge the path as they resolve it, by the same
// checkPathAccess the sandbox crossed, honouring the same sensitive grants the
// sandbox honoured (sensitive-grants.js). The grants ride the call's async
// context, set by the sandbox around its dispatch, so no tool argument can
// carry one. A read outside a sandboxed call — the platform's own — is judged
// as before. The same scope carries the connection's house, so a search walk
// over a ground that spans the house never lists another house's data.
import { AsyncLocalStorage } from 'async_hooks';
import { validatePath } from '@modelcontextprotocol/server-filesystem/dist/lib.js';
import { checkPathAccess, isWithinRoots } from './sandbox-path-policy.js';
import { houseRoots, isOtherHouse } from './explorer-walls.js';
import { requestablePattern, sensitiveGrantCovers } from './sensitive-grants.js';

const sandboxed = new AsyncLocalStorage();

/**
 * impure — run the sandbox's dispatch with the connection's sensitive grants and house in scope.
 * @param {unknown} grants - the connection's `_sensitiveGrants`
 * @param {Function} dispatch
 * @param {{reader?: string, lanes?: string[]}} [house] - the connection's wallet and its own lane's spellings
 */
export const withReadGrants = (grants, dispatch, { reader = '', lanes = [] } = {}) => sandboxed.run(
  { grants, house: { reader: String(reader).toLowerCase(), lanes, roots: houseRoots() } }, dispatch,
);

/**
 * impure (owner reads) — does a sandboxed walk's entry lie in another house (explorer-walls.js)?
 * The being's own lane is always its own. False outside a sandboxed call.
 * @param {string} entry
 * @returns {boolean}
 */
export const otherHouseInWalk = (entry) => {
  const house = sandboxed.getStore()?.house;
  if (!house || isWithinRoots(entry, house.lanes)) return false;
  return isOtherHouse(entry, house.reader, house.roots);
};

/**
 * impure (one stat) — why a sandboxed read of this resolved path is refused, or
 * null. Null outside a sandboxed call.
 * @param {string} realPath
 * @returns {?string}
 */
export const readTimeRefusal = (realPath) => {
  const scope = sandboxed.getStore();
  if (!scope) return null;
  const verdict = checkPathAccess(realPath);
  if (verdict.allowed) return null;
  const granted = verdict.deniedPattern && requestablePattern(verdict.deniedPattern)
    && sensitiveGrantCovers(scope.grants, 'read', realPath);
  return granted ? null : verdict.reason;
};

/**
 * impure — the organ's validatePath for a read, then the deny law on the path it resolved.
 * @param {string} requested
 * @returns {Promise<string>} the resolved path, cleared to read
 */
export const readablePath = async (requested) => {
  const real = await validatePath(requested);
  const refusal = readTimeRefusal(real);
  if (refusal) throw new Error(`${refusal} (judged again as the file was opened)`);
  return real;
};
