/**
 * THE TURN'S CATALOG IS THE TURN'S REACH. A being seat runs only the tools
 * its turn was offered (`connection._turnCatalog`, stamped by
 * stashBeingTurnCatalog). The platform dispatch matches most tools by their
 * bare name, so a call to a tool the turn never offered (a benchmark sitting's
 * `memory/memory_list`, or a forged `coding/memory_search`) used to run all
 * the same. The witness seat already refused such a call (witness-tools.js);
 * the being seat now refuses it too, before anything dispatches.
 *
 * A connection with no stamped catalog (a birth stage, a direct caller) is
 * judged by the gates downstream exactly as before.
 *
 * `admitCall` adds the one argument check (tool fluency, 2026-11-12): a call
 * the turn offered is read against its schema before anything dispatches.
 *
 * Pure.
 */
import { fsRetiredHint } from './fs-primitives.js';
import { retiredToolHint } from './tool-policy.js';
import { doorRefusal, unknownToolHint } from './tool-hud.js';
import { argsRefusalText, fitToolArgs } from './tool-args-check.js';

// The joiners substrates put between server and tool (portal-tool-loop.js
// TOOL_NAME_SEPARATORS): a smashed `platform__platform_data` names the
// offered platform/platform_data.
const SEPARATORS = Object.freeze([':', '__', '_', '.', '/', '-']);

// pure — the catalog tools a call's NAME can mean, joined or bare
const namedBy = (catalog, toolName) => catalog.filter((tool) => tool?.name === toolName
  || SEPARATORS.some((sep) => `${tool?.server}${sep}${tool?.name}` === toolName));

/**
 * pure — was this call offered this turn? The server a model writes is a
 * claim: a server the catalog carries must hold the named tool; a server it
 * does not carry (a placeholder, a stale name) resolves by the name alone,
 * as the loop's own server repair does.
 * @param {Array<{server: string, name: string}>} catalog
 * @param {{server?: string|null, toolName?: string}} match
 */
const offeredThisTurn = (catalog, match) => {
  const named = namedBy(catalog, String(match?.toolName || ''));
  if (named.length === 0) return false;
  const claimed = match?.server && catalog.some((tool) => tool?.server === match.server);
  return !claimed || named.some((tool) => tool.server === match.server);
};

/**
 * pure — the refusal for a call the turn never offered, or null when it may go
 * on. Reads as `unavailable` with the same hint an unknown tool hears.
 * @param {Object} connection - carries `_turnCatalog` and `_turnIntents`
 * @param {Object} match - the unwrapped call
 * @returns {?{tool: string, status: 'unavailable', error: string}}
 */
const offCatalogRefusal = (connection, match) => {
  const catalog = connection?._turnCatalog;
  if (!Array.isArray(catalog) || offeredThisTurn(catalog, match)) return null;
  const { toolName } = match;
  const error = fsRetiredHint(toolName) || retiredToolHint(toolName)
    || unknownToolHint(toolName, catalog, match.server || null, connection._turnIntents);
  return { tool: match.server ? `${match.server}/${toolName}` : String(toolName || 'unknown'), status: 'unavailable', error };
};

/**
 * pure — the answer to a call that must not dispatch at all: arguments that
 * would not read, a door naming the door (tool-hud.js), or a tool this turn
 * never offered. Null when the call goes on to the gates.
 * @param {Object} connection
 * @param {Object} match - the unwrapped call
 */
const refusedBeforeDispatch = (connection, match) => doorRefusal(match) ?? offCatalogRefusal(connection, match);

// pure — the one catalog tool a call names, or null (no catalog, unknown, ambiguous)
const catalogToolFor = (catalog, match) => {
  const named = namedBy(catalog, String(match?.toolName || ''));
  const held = match?.server ? named.filter((tool) => tool.server === match.server) : [];
  const pick = held.length > 0 ? held : named;
  return pick.length === 1 ? pick[0] : null;
};

/**
 * pure — the gate every call crosses before any handler: the refusals above,
 * then its arguments read against the schema the model was shown
 * (tool-args-check.js). A call that fits goes on with its arguments as read
 * (`"5"` → 5, `old_string` → `oldText`); one that does not is refused with
 * what to write instead, status `invalid`, and nothing runs.
 * @param {Object} connection
 * @param {Object} match - the unwrapped call
 * @returns {{match: Object, refused: ?Object}}
 */
export const admitCall = (connection, match) => {
  const refused = refusedBeforeDispatch(connection, match);
  if (refused) return { match, refused };
  const tool = Array.isArray(connection?._turnCatalog) ? catalogToolFor(connection._turnCatalog, match) : null;
  if (!tool?.inputSchema) return { match, refused: null };
  const { args, problems } = fitToolArgs(tool.inputSchema, match.args);
  if (problems.length === 0) return { match: Object.freeze({ ...match, args }), refused: null };
  const id = `${tool.server}/${tool.name}`;
  return { match, refused: { tool: id, status: 'invalid', error: argsRefusalText(id, tool.inputSchema, problems) } };
};
