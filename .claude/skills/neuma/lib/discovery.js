// Discover the neuma resident on this machine through the honest residency
// snapshot (the same endpoint the desk reads), and resolve a name or id to one.
// Discovery never touches private sovereign data — only the public RECORD of
// who is present and whether their conduit is awake.

/**
 * Fetch the residency snapshot: { conduit, neuma: [{ neumaId, name, ... }], ... }.
 * impure (network)
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
 * Resolve a neuma from the residency list by exact id, else case-insensitive
 * name. Pure.
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
