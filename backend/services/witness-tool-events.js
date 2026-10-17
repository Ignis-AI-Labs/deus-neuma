/**
 * Witness tool events — the witness seat's tool-chip event sink.
 *
 * Extracted VERBATIM from witness-tools.js (size law, SIZE breakdown
 * 2026-08-26) so witness-path-grants.js and witness-coding-tools.js can emit
 * chips without importing the file they were cut from (direction law). The
 * local `safeSend` duplicate was retired for the shared ws-send.js export
 * (SIZE-006 — identical body).
 */
import { safeSend } from './ws-send.js';
import { collectToolAction } from './tool-action-record.js';

// The witness's tool-chip choke point: the frame goes to the screen and the
// same event lands on the turn's record, so a resumed chat rebuilds the chips
// the witness actually raised — with their summaries (tool-action-record.js).
export const sendToolEvent = (ws, companion, event) => {
  safeSend(ws, {
    type: 'tool:usage',
    companion: companion?.name || 'witness',
    neumaId: companion?.neumaId || null,
    ...event,
  });
  collectToolAction(ws, event);
};
