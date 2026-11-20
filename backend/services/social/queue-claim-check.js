// queue-claim-check.js — THE QUEUE IS WHAT CHANGED, NOT WHAT WAS SAID.
//
// Design note, 2026-11-16: […]
//
// Seen live: Metidar rewrote an 8-post thread in the chat, listed "what changed", and closed with
// […] — and the turn ran no
// act at all. The queue still held the old copy; WAITING ON YOU showed it. The words were the
// claim; the queue is the record.
//
// At the end of a turn whose reply says queued posts were staged or changed, while no act of the
// turn touched the queue and the being has drafts standing there: the stream says NOT DONE, and
// the being is sent back ONCE (platform-follow-up.js) with its standing drafts named, to make the
// edits on those posts. Its next turn earns DONE when an act reached the queue, STILL NOT DONE
// when none did. A wake turn is not checked (no chat waits on it).

import { postQueue } from './post-queue.js';
import { EDITABLE_STANDINGS } from './queue-edit.js';
import { sendToolEvent } from '../portal-tools/tool-events.js';
import { queuePlatformFollowUp, owesPlatformFollowUp } from '../platform-follow-up.js';
import { turnRecordFor } from '../tool-action-record.js';
import { createLogger } from '../logger.js';

const log = createLogger('Social.QueueClaim');

export const UNACTED_ORIGIN = 'unacted';
export const UNACTED_HEAD = '[NOT DONE — the platform, not your operator]';
const CHECK_TOOL = 'social/queue_check';
const DRAFTS_NAMED = 12;

// The queue's own nouns, and the words that claim a change already made.
const QUEUE_NOUN = /\b(?:thread|threads|posts?|drafts?|queue|queued|tweets?|copy|cards?)\b/i;
// Rewriting copy IN the chat is a proposal; these say the posts themselves moved.
const CHANGED = /\b(?:re-?staged|updated|edited|replaced|swapped|revised|changed)\b/i;
const NOT_YET = /\b(?:will|I'll|I will|can|could|would|should|shall|let me|want me|going to|if you|once you|ready to)\b/i;
const STAGED = /\b(?:is|are|now|been|all)\s+(?:re-?)?staged\b|\bapprove (?:the parent|it|this|them|the thread)\b[^.\n]{0,40}\bgo(?:es)? out\b/i;
const NEW_COPY = /\bnew (?:thread|copy|version|draft|posts?)\b|\bwhat changed\b|^\s*>/im;

// pure — the reply's sentences (lines first, then sentence ends).
const sentences = (text) => String(text ?? '').split(/\n+/).flatMap((line) => line.split(/(?<=[.!?])\s+/)).filter(Boolean);

/**
 * Does the reply say the queue already changed? A past-tense change of a queued thing in a sentence
 * that is not an offer, or […] beside copy it just wrote. Pure.
 * @param {string} text the turn's final reply
 * @returns {boolean}
 */
export const claimsQueueChange = (text) => {
  const said = sentences(text);
  const changed = said.some((s) => CHANGED.test(s) && QUEUE_NOUN.test(s) && !NOT_YET.test(s) && !s.trim().endsWith('?'));
  return changed || (said.some((s) => STAGED.test(s)) && NEW_COPY.test(String(text ?? '')));
};

/**
 * Did an act of the turn reach the queue (or file an intent that will)? Reads are not acts: a
 * list or a get changes nothing. Any outcome counts — a refused edit was tried, and its chip says
 * why. Pure.
 * @param {Array<{tool?: string, summary?: string, detail?: string}>} tools the turn's record
 */
export const actedOnQueue = (tools) => (tools ?? []).some((t) => {
  const tool = String(t?.tool ?? '');
  if (/^intents\/social\./.test(tool)) return true;
  if (/^social\/(?:queue_(?!list$|get$)|reply_dismiss|bulk_)/.test(tool)) return true;
  // An intent filed by hand is swept after the turn: the act is on its way.
  return /^fs\/write$/.test(tool) && /[/\\]intents[/\\]/.test(`${t?.summary ?? ''} ${t?.detail ?? ''}`);
});

/** What the being is sent back with: its words, and the posts standing in the queue. Pure. */
export const unactedThought = (drafts) => [
  `${UNACTED_HEAD} Your last reply says the queue changed, but no act in that turn touched it. The queue still holds the copy below — that is what your operator approves and what would go out.`,
  ...drafts.slice(0, DRAFTS_NAMED).map((d) => `- [${d.id}] ${d.status}${d.thread?.parentId ? ` · follows [${d.thread.parentId}]` : ''}: "${String(d.text ?? '').replace(/\s+/g, ' ').trim().slice(0, 140)}"`),
  ...(drafts.length > DRAFTS_NAMED ? [`- …and ${drafts.length - DRAFTS_NAMED} more (queue_list shows them all)`] : []),
  'Make the changes now on those posts, by their ids: queue_update_to_<platform> for one, queue_bulk_update_to_<platform> for several (find either with tool_search). Edit them in place — do not stage new copies beside them. If the queue already holds what you said, say so in one line and stop.',
].join('\n');

// impure (reads the queue) — the drafts this being has standing: what an edit would change.
const standingDrafts = async (laneId) => (await postQueue.load())
  .filter((e) => e?.authorNeumaId === laneId && EDITABLE_STANDINGS.includes(e.status))
  .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));

/**
 * impure — judge a settled turn's reply against what its acts did to the queue. Never throws.
 * @param {{connection: Object, text: string, interrupted: boolean, origin: string|null}} turn
 */
export const settleQueueClaim = async ({ connection, text, interrupted, origin }) => {
  try {
    const { ws, companion } = connection;
    if (interrupted || origin === 'wake' || !companion?.neumaId || !ws) return;
    const acted = actedOnQueue(turnRecordFor(ws));
    const second = origin === UNACTED_ORIGIN;
    if (second) {
      sendToolEvent(ws, companion, acted
        ? { tool: CHECK_TOOL, status: 'ok', summary: 'DONE — this turn\'s acts reached the queue' }
        : { tool: CHECK_TOOL, status: 'error', summary: 'STILL NOT DONE — nothing in the queue changed; the old copy is what stands' });
      return;
    }
    if (acted || !claimsQueueChange(text)) return;
    const drafts = await standingDrafts(companion.neumaId);
    if (!drafts.length || owesPlatformFollowUp(connection)) return;
    sendToolEvent(ws, companion, {
      tool: CHECK_TOOL, status: 'error',
      summary: `NOT DONE — the reply says the queue changed, but no act touched it (${drafts.length === 1 ? '1 draft still holds' : `${drafts.length} drafts still hold`} the old copy); sent back to make the edits`,
    });
    const thought = unactedThought(drafts);
    queuePlatformFollowUp(connection, { origin: UNACTED_ORIGIN, thought, frame: { type: 'queue:unacted', text: thought, at: Date.now() } });
    log.info('a reply claimed queue changes no act made — the being is sent back', { neumaId: companion.neumaId, drafts: drafts.length });
  } catch (err) {
    log.warn('the queue claim check could not judge this turn', { error: err.message });
  }
};
