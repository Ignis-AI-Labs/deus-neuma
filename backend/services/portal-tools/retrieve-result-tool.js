/**
 * Retrieve-result tool — a neuma's own retrieval of its compressed tool
 * results (CCR-lite): the conditional card, the matcher, and the handler
 * that resolves a tr_… ref through the ACTS gate and the session's
 * tool-results store.
 *
 * Extracted VERBATIM from portal-stream.js (size-law breakdown 2026-08-26,
 * docs/work/size-law-breakdown.md Part 1 step 7 / #278). Leaf module —
 * portal-stream imports it, never the reverse (direction law).
 */
import { neumaWorkspace } from '../../../core/index.js';
import { retrieveFromRecord } from '../../../core/runtime/tool-result-retrieval.js';
import { TOOL_RESULT_REF_PATTERN } from '../../../core/workspace/neuma-workspace.js';
import { TOOL_RESULT_MAX_CHARS } from '../tool-exchange.js';
import { pageRoom } from '../read-room.js';
import { gateAct } from '../act-gate.js';
import { sendToolEvent as _sendToolEvent } from './tool-events.js';

// A bound session can retrieve its first cut immediately, including after a
// reconnect before sequence counters are restored. Native schemas remain lazy.
// No GLOBAL_DEFAULTS entry:
// like skill_use it carries no policy row, so checkToolAccess answers the
// fail-closed approval_required default — ask mode prompts (an ALWAYS grant
// persists, so the friction is once per lifetime), auto runs promptless,
// deny always holds (FR-4: no new bypass lane).
const RETRIEVE_RESULT_TOOL = Object.freeze({
  name: 'retrieve_result',
  server: 'record',
  description: 'Recover a stored result from THIS session — args {ref, query?} for keyword search, or {ref, offset: 0, pageChars?} for exact pages (default 3000 chars; larger pages up to the room left in this conversation — a too-large page is refused with the size that fits). Follow next_offset until end to read the entire result, including multi-file output. Do not combine query with paging. With only ref, returns a capped overview. Use a ref actually returned by a tool; never invent one.',
  inputSchema: Object.freeze({
    type: 'object',
    properties: Object.freeze({
      ref: Object.freeze({ type: 'string', description: 'The exact ref from a [ccr:…] marker, e.g. tr_1a2b3c4d_0_9e8f7a6b' }),
      query: Object.freeze({ type: 'string', description: 'Optional keywords to search for within that one result' }),
      offset: Object.freeze({ type: 'integer', minimum: 0, description: 'Character offset; start at 0, then use next_offset' }),
      pageChars: Object.freeze({ type: 'integer', minimum: 2, description: 'Page size in characters, default 3000, up to the room left; cannot combine with query' }),
    }),
    required: Object.freeze(['ref']),
  }),
});

// Does this parsed call target the retrieve tool? (accepts both dialects)
const _isRetrieveTool = (match) =>
  match.toolName === 'retrieve_result' ||
  match.tool === 'record/retrieve_result';

// pure — the real session, rather than volatile mint counters, owns retrieval.
const _retrieveToolsFor = (connection) =>
  connection?.sessionId && connection?.companion?.neumaId ? [RETRIEVE_RESULT_TOOL] : [];

// impure — resolve a neuma's own compressed-result ref through the ACTS gate,
// then the session's tool-results store, and return the recovered slice as a
// normal capped tool result. Identity comes ONLY from the connection (the
// same source _persistOverCapResult minted under) — a ref from any other
// session or being resolves against THIS session's file and misses (NFR-2:
// IDOR-proof by construction, the foreign file is never opened).
const _handleRetrieveResult = async (ws, connection, neumaPolicy, toolMode, args) => {
  const tool = 'record/retrieve_result';
  const { companion } = connection;
  const ref = typeof args?.ref === 'string' ? args.ref.trim() : '';
  const query = typeof args?.query === 'string' ? args.query.trim() : '';

  if (!TOOL_RESULT_REF_PATTERN.test(ref)) {
    const shown = ref ? ref.slice(0, 40) : '(none given)';
    const error = `'${shown}' is not a result ref — pass the exact tr_… ref from the [ccr:…] marker`;
    _sendToolEvent(ws, companion, { tool, status: 'error', summary: 'retrieve_result — invalid ref', detail: error });
    return { tool, status: 'error', error };
  }

  // Same gate every governed tool passes (FR-4, act-gate.js) — an ALWAYS
  // grant holds, ask mode pauses on the chip, observe holds the action, deny
  // survives all, and an interrupt while the card waited stops the read (#200).
  const gate = await gateAct(connection, {
    server: 'record', tool: 'retrieve_result',
    cardArgs: { ref, ...(query ? { query } : {}),
      ...(args.offset !== undefined ? { offset: args.offset } : {}),
      ...(args.pageChars !== undefined ? { pageChars: args.pageChars } : {}) },
    lanePolicy: neumaPolicy, mode: toolMode,
    emit: (event) => _sendToolEvent(ws, companion, event),
  });
  if (!gate.ok) return gate.result;

  const neumaId = companion?.neumaId;
  const sessionId = connection.sessionId;
  if (!neumaId || !sessionId) {
    const error = 'no session record exists to retrieve from';
    _sendToolEvent(ws, companion, { tool, status: 'error', summary: 'retrieve_result — no session', detail: error });
    return { tool, status: 'error', error };
  }

  const record = await neumaWorkspace.readToolResult(neumaId, sessionId, ref);
  if (!record) {
    const error = `no such result this session — ${ref} was not minted here; refs only resolve within the session that minted them`;
    _sendToolEvent(ws, companion, { tool, status: 'error', summary: 'retrieve_result — unknown ref', detail: error });
    return { tool, status: 'error', error };
  }

  let retrieved;
  try {
    retrieved = retrieveFromRecord(record, {
      ...(query ? { query } : {}),
      ...(args.offset !== undefined ? { offset: args.offset } : {}),
      ...(args.pageChars !== undefined ? { pageChars: args.pageChars } : {}),
      // Asked-for pages may run up to the room left (read-room.js); search and the overview keep the standing cap.
      ...(!query && (args.offset !== undefined || args.pageChars !== undefined) ? pageRoom(connection._turnRoom) : { cap: TOOL_RESULT_MAX_CHARS }),
    });
  } catch (err) {
    const error = `the stored record for ${ref} could not be read back: ${err.message}`;
    _sendToolEvent(ws, companion, { tool, status: 'error', summary: 'retrieve_result — failed', detail: error });
    return { tool, status: 'error', error };
  }

  // The chip says WHOSE result came back and which part, never the bare ref (Design note, 2026-11-14: a
  // chip reading […] said nothing); the text itself opens under
  // it (sendResultDetail, tool-events.js).
  const part = retrieved.mode === 'page'
    ? `page ${retrieved.start}-${retrieved.end} of ${retrieved.totalChars} chars`
    : `${retrieved.mode} — ${retrieved.chunksReturned}/${retrieved.totalChunks} chunks, ${retrieved.response.length} chars`;
  _sendToolEvent(ws, companion, {
    tool,
    status: 'ok',
    summary: `retrieved ${record.tool || 'an earlier result'}${query ? ' (searched)' : ''} · ${part}`,
  });
  // Sub-cap by retrieveFromRecord's hard invariant — re-enters the round as a
  // normal <tool_response> with no re-compression and, because this branch
  // skips _persistOverCapResult, no re-mint (FR-6: a retrieve of a retrieve
  // cannot exist).
  // A room-sized page carries its own cap, or the round's standing cap would cut it again.
  return { tool, status: 'ok', content: retrieved.response, cap: Math.max(TOOL_RESULT_MAX_CHARS, retrieved.response.length) };
};

// The family's card, matcher, conditional advertisement, and handler —
// portal-stream re-imports the private names under their old spellings for
// the catalog, the dispatch fan, and the `__test` proof set.
export {
  RETRIEVE_RESULT_TOOL,
  _isRetrieveTool as isRetrieveTool,
  _retrieveToolsFor as retrieveToolsFor,
  _handleRetrieveResult as handleRetrieveResult,
};
