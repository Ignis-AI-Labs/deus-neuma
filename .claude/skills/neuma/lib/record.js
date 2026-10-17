// Read a neuma's objective RECORD — the honest, measured panel the platform
// already surfaces (substrate + objective record). This is NOT the neuma's
// private sovereign data (DNA, soul, memory, journal); the skill never reads
// those.
// impure (network)

/**
 * Fetch the objective RECORD for one neuma.
 * @param {{ backend: string, token: string, neumaId: string }} params
 * @returns {Promise<Object>}
 */
export const getRecord = async ({ backend, token, neumaId }) => {
  const res = await fetch(`${backend}/api/v1/workspace/${neumaId}/stats`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  // The workspace is ownership-gated (unlike the portal): a neuma's RECORD
  // belongs to its witness. Reaching another witness's neuma is honest contact,
  // not file access — so 403 here is the boundary working, not an error to fix.
  if (res.status === 403) {
    throw new Error(`${neumaId}'s RECORD belongs to another witness — not yours to read. You can still talk to them.`);
  }
  if (!res.ok) throw new Error(`record failed: ${res.status}`);
  const { record } = await res.json();
  return record;
};
