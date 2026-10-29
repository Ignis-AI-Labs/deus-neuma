/**
 * THE CLOSED-BOOK SITTING. A benchmark that measures what the model KNOWS
 * (SimpleQA: closed-book factuality) must not be answered by looking it up.
 * Design note, 2026-10-01: SimpleQA runs closed-book for every arm. On the open run
 * the HARNESS arm answered 12 of 20 from the web (11 right) and 8 from memory
 * (1 right), so its 0.60 measured retrieval, not knowledge.
 *
 * Design note, 2026-10-01: […] Closed-book is
 * the DEFAULT for every benchmark cell; a cell must declare (with its reason)
 * that its task needs the network.
 *
 * Declared per sitting (`neuma agent --closed-book`, benchmark-gated). The
 * turn's catalog keeps only LOCAL servers: an allowlist, so a network-reaching
 * capability added tomorrow can never leak into a closed-book measurement by
 * being forgotten here. A call that names anything else is refused on the
 * spot, the shell runs offline whatever the lane's standing grant says, and
 * intents (which fetch, post and send) never settle.
 *
 * Pure, except where noted.
 */

/** The servers a closed-book sitting keeps: its hands, its own reasoning aids, and the sender's tools. */
export const CLOSED_BOOK_SERVERS = Object.freeze(['fs', 'coding', 'system', 'caller', 'operator', 'skill', 'map']);

/** The refusal a closed-book call receives. */
// Design note, 2026-10-01: […]
export const CLOSED_BOOK_REFUSAL = 'This is a closed-book sitting: nothing reaches the network, and only local tools are open. '
  + 'Looking an answer up during a benchmark is cheating. Work it out from what you know.';

/** pure — is this sitting closed-book? */
export const isClosedBook = (connection) => connection?._closedBook === true;

/**
 * pure — the turn catalog a closed-book sitting keeps (unchanged otherwise).
 * Any BENCHMARK sitting, open-book or not, also loses the memory server: a
 * model answering from what it stored is measuring memory, not knowledge —
 * memory benchmarking is its own infrastructure (Design note, 2026-10-06.
 */
export const closedBookCatalog = (connection, tools) => {
  const kept = isClosedBook(connection) ? tools.filter((tool) => CLOSED_BOOK_SERVERS.includes(tool?.server)) : tools;
  return connection?._benchmarkControls ? kept.filter((tool) => tool?.server !== 'memory') : kept;
};

// pure — the catalog entry an act names. The server a model writes is a
// CLAIM, never trusted alone: `fs__web_search` names the fs server but no
// tool this sitting opened (benchmarks-51, 2026-10-02). Only a (server, name)
// pair the turn catalog carries resolves; a bare name resolves by name.
//
// A JOINED name resolves too — `caller__get_all_hotels_in_city`, the native
// function form, and the other joins turn-catalog-gate.js accepts. Without it a
// closed-book sitting refused the sender's own tools whenever the being wrote
// the joined form (AgentDojo dojofix replay, 2026-10-25: the full being's travel
// lookups denied, 4 tasks lost). A joined name still resolves only to a tool the
// catalog carries, and the server allow-list below still decides.
const JOINS = Object.freeze([':', '__', '_', '.', '/', '-']);
const namesTool = (tool, toolName) => tool.name === toolName
  || JOINS.some((sep) => `${tool.server}${sep}${tool.name}` === toolName);
export const catalogEntryOf = (connection, act) => (connection?._turnCatalog ?? []).find((tool) => namesTool(tool, act?.toolName)
  && (!act?.server || tool.server === act.server)) ?? null;

/**
 * pure — split a round's acts into those a closed-book sitting runs and those
 * it refuses (with the refusal result each refused act settles as). Outside a
 * closed-book sitting every act is allowed and nothing is refused.
 * @returns {{allowed: Array, refused: Array<{act: object, result: object}>}}
 */
export const closedBookSplit = (connection, acts) => {
  if (!isClosedBook(connection)) return { allowed: acts, refused: [] };
  const allowed = [];
  const refused = [];
  for (const act of acts) {
    const entry = catalogEntryOf(connection, act);
    if (entry && CLOSED_BOOK_SERVERS.includes(entry.server)) allowed.push(act);
    else {
      refused.push({
        act,
        result: { tool: `${act?.server ?? 'unknown'}/${act?.toolName ?? 'unknown'}`, status: 'denied', error: CLOSED_BOOK_REFUSAL },
      });
    }
  }
  return { allowed, refused };
};
