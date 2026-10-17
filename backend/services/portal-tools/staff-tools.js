/**
 * Staff desk tool family — the Optio office's instrument: `house_state`, the
 * ONE call that answers […] (the seated Optio's own
 * 2026-09-15 report named its absence). The computation lives in
 * house-state.js (the pipeline-state precedent); this family is the tool
 * surface — advertisement, gate, and answer — the crew-desk pattern.
 *
 * OFFICE-ONLY by advertisement: cross-seat charge and unread state is the
 * office's instrument, not every peer's (the CMO-briefing precedent). The
 * desk's /api/v1/staff/board stays the operator's window.
 *
 * Leaf module — the catalog/dispatch wiring imports it; it never imports
 * portal-stream (direction law).
 */
import { gateAct } from '../act-gate.js';
import { cosDesignation } from '../staff/cos-designation.js';
import { loadHouseWorkspace } from '../house-workspace.js';
import { houseSeatFor } from '../house-titles.js';
import { computeHouseState, formatHouseStateForBeing } from '../staff/house-state.js';
import { listEntries, BOARD_STALE_MS } from '../staff/board-store.js';
import { sendToolEvent as _sendToolEvent } from './tool-events.js';

export const HOUSE_STATE_TOOL = Object.freeze({
  name: 'house_state',
  server: 'staff',
  description: 'Read the WHOLE HOUSE in one call — no args. Who holds each seat and what they owe (open charges, unread post, live task counts), your dispatch drawer with ages, the standing plan of record, recent team runs, and the posting/leads posture. THE OPTIO OFFICE\'S instrument — you see it because you hold the office; work moves through the seats, never around them.',
  inputSchema: Object.freeze({ type: 'object', properties: Object.freeze({}) }),
});

export const BOARD_LIST_TOOL = Object.freeze({
  name: 'board_list',
  server: 'staff',
  description: 'Read the HOUSE BOARD — no args. Every task a seat has authored to the shared board: owner, status (open/working/done/blocked/withdrawn), what blocks it, and staleness. The board is shared house state — every seated housemate reads it; keep YOUR entries honest with board/add and board/update.',
  inputSchema: Object.freeze({ type: 'object', properties: Object.freeze({}) }),
});

// impure — the family's advertisement: `house_state` for the seated office
// alone; `board_list` for every sealed seat (the board is shared house state
// — the house ground's own law). Fail-closed on every store read.
const _staffToolsFor = async (connection) => {
  const neumaId = connection.companion?.neumaId;
  const wallet = connection.walletAddress;
  if (!neumaId) return [];
  const tools = [];
  const officer = await cosDesignation.getOfficer(connection.walletAddress).catch(() => null);
  if (officer?.laneId === neumaId) tools.push(HOUSE_STATE_TOOL);
  const seat = await houseSeatFor(wallet, neumaId).catch(() => null);
  const ground = seat ? await loadHouseWorkspace(wallet).catch(() => null) : null;
  if (seat && ground?.root) tools.push(BOARD_LIST_TOOL);
  return tools;
};

const _isStaffTool = (match) =>
  match.toolName === 'house_state' || match.tool === 'staff/house_state'
  || match.toolName === 'board_list' || match.tool === 'staff/board_list';

// impure — the same ACTS gate every governed tool passes, then the real
// answer. house_state's office gate is re-verified HERE, not just at
// advertisement — a stray call from a non-office lane is refused, never
// answered (the security-acts idiom: advertise narrow, re-verify at execute).
const _handleStaffTool = async (ws, connection, neumaPolicy, toolMode, match, args) => {
  const toolName = match.toolName === 'board_list' || match.tool === 'staff/board_list'
    ? 'board_list' : 'house_state';
  const tool = `staff/${toolName}`;
  const { companion } = connection;

  const gate = await gateAct(connection, {
    server: 'staff', tool: toolName, cardArgs: {},
    lanePolicy: neumaPolicy, mode: toolMode,
    emit: (event) => _sendToolEvent(ws, companion, event),
  });
  if (!gate.ok) return gate.result;

  if (toolName === 'board_list') {
    try {
      const wallet = connection.walletAddress;
      const [{ root }, seat] = await Promise.all([
        loadHouseWorkspace(wallet),
        houseSeatFor(wallet, companion?.neumaId),
      ]);
      if (!root || !seat) throw new Error('the house board is not open here — it needs a sealed seat and the house\'s shared ground');
      const entries = await listEntries(root);
      const now = Date.now();
      const lines = ['## HOUSE BOARD'];
      if (!entries.length) {
        lines.push('No entries — board/add posts a task the whole house can see.');
      } else {
        for (const e of entries) {
          const stale = (e.status === 'open' || e.status === 'working')
            && now - Date.parse(e.updatedAt) > BOARD_STALE_MS ? ' · STALE' : '';
          const blocked = e.blockedBy ? ` · blocked by [${e.blockedBy}]` : '';
          const note = e.note ? ` · ${e.note}` : '';
          lines.push(`- [${e.id}] "${e.title}" → ${e.owner} · ${e.status}${blocked}${stale}${note}`);
        }
      }
      _sendToolEvent(ws, companion, { tool, status: 'ok', summary: `${entries.length} board entr${entries.length === 1 ? 'y' : 'ies'}` });
      return { tool, status: 'ok', content: lines.join('\n') };
    } catch (err) {
      _sendToolEvent(ws, companion, { tool, status: 'error', summary: `${toolName} — failed`, detail: err.message });
      return { tool, status: 'error', error: err.message };
    }
  }

  const officer = await cosDesignation.getOfficer(connection.walletAddress).catch(() => null);
  if (officer?.laneId !== companion?.neumaId) {
    const error = 'house_state is the Optio office\'s instrument — only the seated chief of staff reads the whole house.';
    _sendToolEvent(ws, companion, { tool, status: 'denied', summary: `${toolName} — not the office`, detail: error });
    return { tool, status: 'denied', error };
  }

  try {
    const state = await computeHouseState({
      laneId: companion?.neumaId || null,
      wallet: connection.walletAddress || null,
    });
    _sendToolEvent(ws, companion, { tool, status: 'ok', summary: `house posture — ${state.roster.length} seat(s), ${state.dispatches.open} open charge(s)` });
    return { tool, status: 'ok', content: formatHouseStateForBeing(state) };
  } catch (err) {
    _sendToolEvent(ws, companion, { tool, status: 'error', summary: `${toolName} — failed`, detail: err.message });
    return { tool, status: 'error', error: err.message };
  }
};

export {
  _staffToolsFor as staffToolsFor,
  _isStaffTool as isStaffTool,
  _handleStaffTool as handleStaffTool,
};
