/** Pure branch topology checks; actor authorization stays with repository protection. */

/**
 * Check a PR against the repository's declared integration and production branches.
 * This cannot infer whether a personal branch belongs to a human or authorize a merge.
 * @param {{head: string, base: string}} refs
 * @param {{integration: string, production: string[]}} topology
 * @returns {boolean}
 */
export const isPermittedPullRequest = (refs, topology) => {
  if (!refs || !topology || typeof refs.head !== 'string' || typeof refs.base !== 'string'
    || typeof topology.integration !== 'string' || !topology.integration
    || !Array.isArray(topology.production) || !topology.production.length
    || topology.production.some((branch) => typeof branch !== 'string' || !branch)) return false;
  if (topology.production.includes(refs.base)) return refs.head === topology.integration;
  if (refs.base !== topology.integration || topology.production.includes(refs.head)) return false;
  const parts = refs.head.split('/');
  return parts.length === 2 && /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(parts[0])
    && parts[1] === topology.integration;
};
