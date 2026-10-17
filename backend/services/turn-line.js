// turn-line — a chat turn takes its place in the line (substrate-lease.js) before it starts, holds
// it through every round, tool and approval wait (Founder's ruling, 2026-10-12: an approval wait keeps
// its place; a PARKED approval steps out until answered — tool-approval.js), and gives it back
// when the turn is fully done. While it waits, the chat is told the
// truth: its place, and who is ahead ({type:'substrate:line', state:'waiting', position, ahead}).
//
// An interrupt or a navigation while it waits leaves the line (connection.lineWait); the turn then
// starts unlined and ends at once through its own interrupted path — the operator's words are kept
// exactly as an interrupt before the first token always kept them.
// impure (the line, the socket).
import { withLease } from './substrate-lease.js';

const send = (connection, frame) => {
  try {
    if (connection.ws?.readyState === 1) connection.ws.send(JSON.stringify(frame));
  } catch { /* a closed socket never stops the turn */ }
};

/**
 * @param {object} connection - the portal connection the turn runs on
 * @param {() => Promise<T>} run - the turn
 * @returns {Promise<T>}
 * @template T
 */
export const lineTurn = async (connection, run) => {
  const companion = connection.companion || {};
  const wait = new AbortController();
  connection.lineWait = wait;
  let waited = false;
  try {
    return await withLease({
      kind: 'turn',
      label: companion.name || companion.neumaId || 'a chat',
      neumaId: companion.neumaId ?? null,
      signal: wait.signal,
      onWait: ({ position, ahead }) => {
        waited = true;
        send(connection, {
          type: 'substrate:line', state: 'waiting', position,
          ahead: ahead.map((a) => ({ label: a.label, kind: a.kind })),
        });
      },
      onAdmit: () => {
        if (connection.lineWait === wait) connection.lineWait = null;
        if (waited) send(connection, { type: 'substrate:line', state: 'running' });
      },
    }, run);
  } catch (err) {
    if (wait.signal.aborted && connection.lineWait === wait) {
      connection.lineWait = null;
      send(connection, { type: 'substrate:line', state: 'left' });
      return run();
    }
    throw err;
  } finally {
    if (connection.lineWait === wait) connection.lineWait = null;
  }
};
