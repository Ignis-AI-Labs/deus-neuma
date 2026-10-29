/**
 * board_read — the CMO seat's read of the operator's MARKETING board
 * (marketing-panel-plan.md §4, slice 5): one level's board as the operator
 * sees it (the saved board, or the desk's default), one panel per line, and
 * what that level may hold — so the seat can lay it out with the
 * marketing/board-arrange act (intents/marketing-board-arrange.js).
 *
 * The CMO office's instrument: advertised to the house's seated CMO alone and
 * re-verified on every call (advertise narrow, re-verify at execute). A local
 * read of the house's own board file, so it opens without a card (the
 * `marketing` policy row). Reached through tool_search (load on demand).
 * Wired into the marketing family (crew-desk-tools.js), never the reverse.
 */
import { cmoDesignation } from '../marketing/cmo-designation.js';
import { boardStoreFor } from '../marketing/board-store.js';
import { settleBoard } from '../marketing/board-shape.js';
import { BOARD_LEVEL, boardHouseOf, levelRefusal } from '../marketing/board-house.js';
import { boardLines } from '../marketing/board-lines.js';

export const BOARD_READ_TOOL = Object.freeze({
  name: 'board_read',
  server: 'marketing',
  description: 'Read your operator\'s MARKETING board at one level — args {level?}: "house" (default) or a company id. One line per panel in its place (id, kind, width of 12, scope, what it shows, PINNED, who set it), then what that level may hold: the panel kinds with their choices, the metrics each platform here reports, and the campaigns, companies and accounts a panel may name. Lay it out with the marketing/board-arrange act. Reading only.',
  inputSchema: Object.freeze({
    type: 'object',
    properties: Object.freeze({
      level: Object.freeze({ type: 'string', description: '"house", or one of the house\'s company ids' }),
    }),
  }),
});

/** board_read rides with the house's seated CMO alone. impure. */
export const boardToolsFor = async (connection) => {
  const laneId = connection?.companion?.neumaId;
  if (!laneId) return [];
  return (await cmoDesignation.holds(connection.walletAddress, laneId).catch(() => false)) ? [BOARD_READ_TOOL] : [];
};

/**
 * Run board_read for a lane, after its own gate has passed. impure — the
 * house's stores, its own house's alone (the connection's wallet).
 * @param {object} connection
 * @param {{level?: string}} args
 * @returns {Promise<{ok: true, content: string, summary: string}|{ok: false, error: string}>}
 */
export const runBoardRead = async (connection, args) => {
  const wallet = connection.walletAddress;
  if (!(await cmoDesignation.holds(wallet, connection.companion?.neumaId || null).catch(() => false))) {
    return { ok: false, error: 'board_read is the CMO office\'s — only the house\'s seated CMO lays out the operator\'s marketing board' };
  }
  const level = String(args?.level ?? 'house').trim() || 'house';
  if (!BOARD_LEVEL.test(level)) return { ok: false, error: 'level is "house" or one of the house\'s company ids' };
  const ctx = await boardHouseOf(wallet, level);
  const refused = levelRefusal(ctx);
  if (refused) return { ok: false, error: refused };
  const stored = await (await boardStoreFor(wallet)).load(level);
  const settled = stored ? settleBoard(stored, ctx) : { panels: null, dropped: [] };
  return { ok: true, content: boardLines({ ctx, saved: settled.panels, dropped: settled.dropped }), summary: `board ${level} — ${stored ? 'saved' : 'default'}` };
};
