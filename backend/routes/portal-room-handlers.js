// portal-room-handlers.js — THE COUNCIL's wire: convening the room, speaking
// into it, the gavel, and the dispersal. Extracted from portal-routes.js (P8
// decomposition, SIZE-033 plan) — bodies byte-identical but for
// case→function conversion.
import {
  openCouncil, councilSay, councilInterrupt, councilOrder, closeCouncil, councilResume, councilList,
} from '../services/council-session.js';
import { checkWsRateLimit } from '../services/rate-limiter.js';
import { updateToolWorkspace, ownsNeumaLane } from './portal-context.js';

export const councilOpen = async (connection, message) => {
  // The operator convenes several of her beings into one room. Every
  // member passes the same ownership gate as companion:manifest; the
  // chat link's single bind is untouched — the council is its own
  // speaker-tagged lane on this socket.
  // THE FOCUS GROUND rides the convene frame — the room works on the
  // folder the operator has open, so the ground the room NAMES is the
  // ground its tools actually reach.
  updateToolWorkspace(connection, message.toolWorkspace);
  await openCouncil(connection, message, { ownsNeumaLane });
};

export const councilSpeak = async (connection, message) => {
  const { ws } = connection;
  // The operator speaks into the room. Urgency is the traffic light:
  // 'now' interjects at the next floor boundary, 'hold' waits its turn.
  if (checkWsRateLimit(connection)) {
    ws.send(JSON.stringify({
      type: 'council:error', code: 'HELD', message: 'Too many messages. Please wait a moment.',
    }));
    return;
  }
  // Focus can move between sittings' turns — the ground follows it.
  updateToolWorkspace(connection, message.toolWorkspace);
  await councilSay(connection, message);
};

export const councilResumeFrame = async (connection, message) => {
  // Reopen a dissolved council from the operator's realm record — same
  // members, same lanes, the exchange restored. Every seat re-passes
  // the ownership and identity gates.
  await councilResume(connection, message, { ownsNeumaLane });
};

export const councilListFrame = async (connection) => {
  // The shelf of this wallet's past councils.
  await councilList(connection);
};

export const councilInterruptFrame = (connection) => {
  // The operator cuts the floor holder mid-word — the same cancel seam
  // as chat's consciousness:interrupt, scoped to the council's turn.
  councilInterrupt(connection);
};

export const councilOrderFrame = (connection) => {
  // THE GAVEL — the operator calls the room to order: floor cut, hand
  // round cut, every hand down, carry silenced. The Escape ladder's
  // fourth rung speaks it.
  councilOrder(connection);
};

export const councilCloseFrame = async (connection) => {
  await closeCouncil(connection);
};
