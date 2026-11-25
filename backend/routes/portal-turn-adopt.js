// portal-turn-adopt.js — the portal's half of THE TURN KEPT AS IT GOES (services/turn-keep.js):
// a desk that comes back to a chat whose turn is still running takes that turn over, and a take a
// quit or a crash cut short is picked up again on CONTINUE.
//
// Design note, 2026-11-16: […]
//
// TAKING OVER. A window closed to the tray leaves the backend running, and the turn with it,
// writing to a socket nobody reads. The desk that opens that chat again is sent the turn so far,
// then every live frame; for as long as it runs, this desk is busy the way its own turn would make
// it: a word sent now is held and goes after it (from here), "now" and STOP cut it, and opening
// another chat only stops watching it — the turn runs on and lands on the record.
//
// CONTINUE. The cut take is on the record, marked where it stopped. The press runs a turn whose
// words are the platform's (origin 'resume' — drawn as a line, never the operator's bubble) and
// tell the being where it stopped; its own cut take is in its transcript, so it picks up there.

import { createLogger } from '../services/logger.js';
import { announceTakenThought } from '../services/held-thoughts.js';
import { takeOverTurn, releaseTakenTurn } from '../services/turn-keep.js';
import { resumeThought } from '../services/turn-keep-record.js';
import { neumaWorkspace } from '../../core/index.js';
import { runTurnAndDrain } from './portal-context.js';

const log = createLogger('Portal');
const OPEN = 1; // WebSocket.OPEN
const TURN_ID = /^[a-zA-Z0-9-]{1,80}$/;

// impure — busy while the closed desk's chat has a turn running (its held words run on there, one
// after another); then the words held HERE go, in order, from this desk.
const follow = async (heir, from) => {
  while (heir.adoptedFrom === from && from.turnPromise && heir.ws?.readyState === OPEN) {
    const running = from.turnPromise;
    heir.turnPromise = running;
    heir.adoptedPromise = running;
    await running.catch(() => {});
    if (heir.turnPromise === running) heir.turnPromise = null;
    await new Promise((resolve) => { setImmediate(resolve); }); // the closed desk's drain names its next turn first
  }
  if (heir.adoptedFrom !== from) return; // released: this desk opened another chat
  releaseTakenTurn(heir);
  const next = heir.pendingThoughts?.shift();
  if (next && heir.ws?.readyState === OPEN && !heir.turnPromise) {
    announceTakenThought(heir, next);
    await runTurnAndDrain(heir, next);
  }
};

/**
 * impure — the desk just opened this chat: if a closed desk's turn is still running in it, draw the
 * turn so far here (before anything else can reach this socket) and follow it live.
 * @returns {boolean} whether a turn was taken over
 */
export const adoptKeptTurn = (heir, neumaId, sessionId) => {
  const taken = takeOverTurn(heir, neumaId, sessionId);
  if (!taken) return false;
  for (const frame of taken.frames) heir.ws.send(JSON.stringify(frame));
  heir.adoptedFrom = taken.from;
  log.info('a desk took over a chat whose turn ran on after its desk closed', { neumaId, sessionId, frames: taken.frames.length });
  follow(heir, taken.from).catch((err) => log.warn('a taken-over turn could not be followed', { neumaId, error: err.message }));
  return true;
};

// pure — when the cut happened, on the operator's wall.
const cutWhen = (at, zone) => {
  const when = new Date(at);
  if (!at || Number.isNaN(when.getTime())) return null;
  try {
    return when.toLocaleString('en-US', { timeZone: zone || undefined, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  } catch {
    return when.toISOString();
  }
};

/**
 * impure — CONTINUE on a take the app's close cut short: the being picks it up where it stopped.
 * Only on an idle chat, only for a take the record marks as cut.
 * @param {Object} connection
 * @param {{ turnId?: string }} message
 */
export const continueCutTurn = async (connection, message) => {
  const neumaId = connection.companion?.neumaId;
  const { sessionId } = connection;
  const turnId = TURN_ID.test(String(message?.turnId ?? '')) ? message.turnId : null;
  if (!neumaId || !sessionId || !turnId || connection.turnPromise) return false;
  const rows = await neumaWorkspace.readSession(neumaId, sessionId);
  const cut = rows.findLast((row) => row?.role === 'assistant' && row.turnId === turnId);
  if (!cut?.cutOff) {
    log.warn('CONTINUE named a take the record does not mark as cut — nothing ran', { neumaId, turnId });
    return false;
  }
  if (connection.turnPromise) return false; // a turn began while the record was read
  const thought = resumeThought(cutWhen(cut.cutOff.at, connection.clientTimeZone));
  // frame, origin and turn with NO await between: a message landing in a gap would start a second turn
  connection.ws.send(JSON.stringify({ type: 'turn:continued', turnId, text: thought, at: Date.now() }));
  connection._turnOrigin = 'resume';
  log.info('a cut take is picked up again', { neumaId, sessionId, turnId });
  await runTurnAndDrain(connection, { thought });
  return true;
};
