// failed-post-door — a FAILED post's fix, by why it failed (send-failure.js;
// show-dont-tell-audit.md finding 29): the keys refused → that account's
// Channel keys row; the house's own law held it → the platform's STANDING;
// the platform stumbled → TRY AGAIN; the words or media refused → REVISE,
// and, where the member who wrote it is this house's, HAND TO them.
//
// `failedPostDoor` is the descriptor any surface that shows a failed post
// draws (the post card, the BOARD's post row): a door and its press. Pure.

import { sendFailureCause } from '../../../../backend/services/social/send-failure.js';

/** The card's own door for a post, when the fix happens on its card (TRY AGAIN, REVISE). */
const cardDoor = (entry) => ({ kind: 'queue', channelId: entry.channelId, entryId: entry.id });

/**
 * A failed post's door and its press (≤3 words), or null when the post did
 * not fail, or failed for a reason no door fixes (its card says why). Pure.
 * @param {?{id: string, status: string, channelId: string, accountId?: string, error?: string, errorStatus?: number}} entry
 * @returns {?{cause: string, door: {kind: string}, label: string}}
 */
export const failedPostDoor = (entry) => {
  const cause = sendFailureCause(entry);
  if (cause === 'keys') return { cause, door: { kind: 'keys', channelId: entry.channelId, accountId: entry.accountId || null }, label: 'FIX KEYS' };
  if (cause === 'standing') return { cause, door: { kind: 'standing', channelId: entry.channelId, drawer: 'holder' }, label: 'HOLDER' };
  if (cause === 'retry') return { cause, door: cardDoor(entry), label: 'TRY AGAIN' };
  if (cause === 'content') return { cause, door: cardDoor(entry), label: 'REVISE' };
  return null;
};

/**
 * The hand-over for a post the platform refused for its words: the member of
 * this house who wrote it revises it with the acts it already has (queue_get,
 * social/queue); the new card is the operator's. Null for any other failure,
 * or when its author is not in this house's roster. Pure.
 * @param {object} entry
 * @param {ReadonlyArray<{neumaId: string, name?: string, participantKind?: string}>} roster - this house's members
 * @returns {?{neumaId: string, name: string, prompt: string}}
 */
export const failedPostHandTo = (entry, roster) => {
  if (sendFailureCause(entry) !== 'content' || !entry.authorNeumaId) return null;
  const member = (roster || []).find((m) => m.neumaId === entry.authorNeumaId && m.participantKind !== 'witness');
  if (!member) return null;
  return {
    neumaId: member.neumaId,
    name: member.name || member.neumaId,
    prompt: [
      `Your post ${entry.id} on ${entry.accountId || entry.channelId} did not send: the platform said "${String(entry.error || '').slice(0, 200)}".`,
      `Read it with queue_get ${entry.id}, then stage a revised version with social/queue on the same account${entry.campaignId ? ' and campaign' : ''}, changing what the platform refused.`,
      'I will decide the new card.',
    ].join(' '),
  };
};
