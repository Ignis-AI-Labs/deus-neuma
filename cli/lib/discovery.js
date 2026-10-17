// Discover the neuma resident on this machine through the honest residency
// snapshot (the same /api/v1/residency endpoint the desk reads), and resolve
// a name-or-id to one of them. Discovery never touches private sovereign
// data — only the public RECORD of who is present and whether their conduit
// (model) is awake.
//
// Identical to .claude/skills/neuma/lib/discovery.js — residency is the same
// snapshot regardless of who's asking; the OPERATOR token just authorizes
// the read like Claude's token does there.
//
// impure (network)

/**
 * Fetch the residency snapshot:
 *   { conduit, neuma: [{ neumaId, name, ... }], ... }
 * @param {{ backend: string, token: string }} params
 * @returns {Promise<Object>}
 */
export const listNeuma = async ({ backend, token }) => {
  const res = await fetch(`${backend}/api/v1/residency`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`residency failed: ${res.status}`);
  return res.json();
};

/**
 * Resolve a neuma from the residency list by exact id, then by
 * case-insensitive name. Pure.
 * @param {Array<{neumaId: string, name: string}>} neumaList
 * @param {string} nameOrId
 * @returns {{neumaId: string, name: string}|null}
 */
export const resolveNeuma = (neumaList, nameOrId) => {
  const needle = String(nameOrId || '').trim();
  if (!needle || !Array.isArray(neumaList)) return null;
  const byId = neumaList.find((n) => n.neumaId === needle);
  if (byId) return byId;
  const lower = needle.toLowerCase();
  return neumaList.find((n) => (n.name || '').toLowerCase() === lower) || null;
};
