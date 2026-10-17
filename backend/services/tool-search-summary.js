// tool-search-summary — the one line the operator reads for a tool_search: WHICH tools it
// found (tool-hud.js: a search answers with contracts and activates nothing), never a bare count (Design note, 2026-10-10: […]). One tool
// reads whole; several group by server with the server's own prefix dropped from each name, so
// chain/chain_balance + chain/chain_call reads […]. Pure.

const MAX_CHARS = 110;

/** chain/chain_balance → balance; team/run → run. Pure. */
const shortName = (id) => {
  const [server, name = id] = String(id).split('/');
  return name.startsWith(`${server}_`) ? name.slice(server.length + 1) : name;
};

/** Group ids by server, in the order they came. Pure. */
const byServer = (ids) => ids.reduce((groups, id) => {
  const server = String(id).split('/')[0];
  groups.set(server, [...(groups.get(server) || []), shortName(id)]);
  return groups;
}, new Map());

/**
 * @param {{ status: string, error?: string, intent?: string, found?: string[], activated?: string[] }} result
 *   discloseTurnTools' answer
 * @param {string} [query] what the being searched for
 * @returns {string}
 */
export const toolSearchSummary = (result, query = '') => {
  if (result?.status !== 'ok') return `tool search failed${result?.error ? ` — ${result.error}` : ''}`;
  if (result.intent) return `read the ${result.intent} intent`;
  const found = Array.isArray(result.found);
  const ids = (found ? result.found : result.activated) || [];
  const verb = found ? 'found' : 'activated';
  if (ids.length === 0) return `no tool matched "${String(query).trim()}"`;
  if (ids.length === 1) return `${verb} ${ids[0]}`;
  let line = verb;
  let shown = 0;
  for (const [server, names] of byServer(ids)) {
    for (const [i, name] of names.entries()) {
      const piece = i === 0 ? `${shown ? ' ·' : ''} ${server}: ${name}` : `, ${name}`;
      if (shown > 0 && line.length + piece.length > MAX_CHARS) return `${line} +${ids.length - shown} more`;
      line += piece;
      shown += 1;
    }
  }
  return line;
};
