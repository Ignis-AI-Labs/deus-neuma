/**
 * queue_retract — the being takes back something the house already SAID
 * (Design note, 2026-11-12: […]).
 *
 * The post is deleted from X and stays in the record as RETRACTED
 * (social/queue-retract.js). X has no edit, so a correction is this, then
 * the corrected words staged fresh — a retracted answer no longer stands, so
 * the reply it answered may be answered again. Deleting public speech cannot
 * be undone, so the act carries the ACTS card like every outward act (an
 * ALWAYS on it is the operator's to give). Crew and house law as editing.
 */
import { postQueue } from '../social/post-queue.js';
import { laneHouseEntries } from '../social/queue-house.js';
import { houseOfLane } from '../social/house-positions.js';
import { channelBindings } from '../social/channel-bindings.js';
import { entryAccountId } from '../social/account-shape.js';
import { resolveAccountCredential } from '../social/account-store.js';
import { deleteFromX } from '../social/x-poster.js';
import { retractRefusal } from '../social/queue-retract.js';
import { sectorCrew, canStageForSector } from '../sector-crew.js';
import { gateAct } from '../act-gate.js';
import { sendToolEvent as _sendToolEvent } from './tool-events.js';

export const QUEUE_RETRACT_TOOL = Object.freeze({
  name: 'queue_retract',
  server: 'social',
  description: 'Take back a post or reply the house already SENT on X — args {id, reason}. Use the FULL id from queue_list (status:\'sent\'). It is deleted from X and stays in the record as RETRACTED; your operator approves the deletion on a card. X has no edit: to correct a live post, retract it, then stage the corrected words (queue_reply_to_x for an answer — the reply is answerable again — or social/queue for a post). An unsent post is pulled with queue_cancel instead.',
  inputSchema: Object.freeze({
    type: 'object',
    properties: Object.freeze({
      id: Object.freeze({ type: 'string', description: 'The full queue entry id of the SENT post' }),
      reason: Object.freeze({ type: 'string', description: 'Why it is being taken back — your operator reads it on the card' }),
    }),
    required: Object.freeze(['id', 'reason']),
  }),
});

const refuse = (ws, companion, tool, status, summary, error) => {
  _sendToolEvent(ws, companion, { tool, status, summary: `queue_retract — ${summary}`, detail: error });
  return { tool, status, error };
};

/**
 * Retract one sent post. impure — the queue, the house's keys, X.
 * @returns {Promise<{tool: string, status: string, content?: string, error?: string}>}
 */
export const handleQueueRetract = async (ws, connection, neumaPolicy, toolMode, args) => {
  const tool = 'social/queue_retract';
  const { companion } = connection;
  const id = typeof args?.id === 'string' ? args.id.trim() : '';
  const reason = typeof args?.reason === 'string' ? args.reason.replace(/\s+/g, ' ').trim().slice(0, 200) : '';
  if (!id || !reason) return refuse(ws, companion, tool, 'error', 'invalid args', 'queue_retract needs {id, reason} — the full id from queue_list and why it is taken back');

  const entries = await laneHouseEntries(companion?.neumaId).catch(() => null);
  if (!entries) return refuse(ws, companion, tool, 'error', 'queue unreadable', 'the queue is unreadable — nothing was retracted');
  const entry = entries.find((e) => e.id === id) || null;
  const refusal = retractRefusal(entry);
  if (refusal) return refuse(ws, companion, tool, 'error', 'not retractable', `Could not retract ${id}: ${refusal}.`);

  const house = await houseOfLane(companion?.neumaId);
  const accountId = entryAccountId(entry);
  const [bindings, crewStore] = await Promise.all([
    channelBindings.load(house).catch(() => ({})),
    sectorCrew.load(house).catch(() => ({})),
  ]);
  if (!canStageForSector(crewStore, bindings, accountId, companion?.neumaId || null)) {
    return refuse(ws, companion, tool, 'denied', 'not on the crew', `you are not on the crew of X account ${accountId} — ask your operator to add you before retracting for it`);
  }

  const gate = await gateAct(connection, {
    server: 'social', tool: 'queue_retract', toolLabel: tool,
    cardArgs: {
      id, account: accountId, sent: entry.sentAt || '—',
      ...(entry.kind === 'reply' ? { answering: `@${entry.reply?.toUsername || 'unknown'}` } : {}),
      words: String(entry.text || '').replace(/\s+/g, ' ').trim().slice(0, 240),
      reason,
    },
    lanePolicy: neumaPolicy, mode: toolMode,
    emit: (event) => _sendToolEvent(ws, companion, event),
  });
  if (!gate.ok) return gate.result;

  _sendToolEvent(ws, companion, { tool, status: 'executing' });
  const credentials = await resolveAccountCredential(house, accountId).catch(() => null);
  const out = await deleteFromX(credentials, entry.postId, { signal: connection.activeTurn?.signal });
  if (!out.ok) return refuse(ws, companion, tool, 'error', 'X refused', `X did not delete ${entry.postId}: ${out.detail}${out.status ? ` (HTTP ${out.status})` : ''}. Nothing in the record changed — check read_x {what:'recent'} for whether it is still live, and tell your operator what is true.`);
  const marked = await postQueue.retract(id, { by: companion?.name || 'being', reason });
  if (!marked.ok) return refuse(ws, companion, tool, 'error', 'record not updated', `X deleted post ${entry.postId}, but the record could not mark it: ${marked.error}.`);
  const content = `Retracted ${id}: post ${entry.postId} is deleted from X. It stays in the record as RETRACTED (${reason}).${entry.kind === 'reply' ? ' The reply it answered can be answered again — stage the corrected words with queue_reply_to_x.' : ' To put corrected words out, stage them with social/queue.'}`;
  _sendToolEvent(ws, companion, { tool, status: 'ok', summary: `retracted ${id.slice(0, 8)} from X`, detail: content });
  return { tool, status: 'ok', content };
};
