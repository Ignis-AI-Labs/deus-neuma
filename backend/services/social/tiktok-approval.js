// tiktok-approval.js — the backend half of a TikTok post's card: what the
// card renders from (the account's creator info read NOW, and the author's
// suggestions from its settings lines), and the approval that turns the
// person's choices on that card into the consent the post carries.
//
// TikTok's Content Sharing Guidelines require creator info […] and a choice the person makes themself; the law
// both judge by is frontend/utils/tiktok-consent.js, the same the card uses.
// A draft for the TikTok inbox (`send: drafts`) has no choices to make here:
// it is finished in the TikTok app.

import { parseTikTokDraft } from './tiktok-metadata.js';
import { readTikTokCreator } from './tiktok-poster.js';
import { entryAccountId } from './account-shape.js';
import { readChoice, choiceBlockers, consentRecord } from '../../../frontend/utils/tiktok-consent.js';

/**
 * What a TikTok post's card renders from. impure — store + network.
 * @param {string} house - the caller's house wallet
 * @param {{text: string, channelId?: string, accountId?: string}} entry - read as the account it speaks as
 * @returns {Promise<{ok: true, mode: 'drafts'}|{ok: true, mode: 'post', creator: object, suggested: object}
 *   |{ok: false, detail: string}>}
 */
export const tiktokCardView = async (house, entry) => {
  const parsed = parseTikTokDraft(entry.text);
  if (!parsed.ok) return { ok: false, detail: parsed.detail };
  if (parsed.meta.mode === 'drafts') return { ok: true, mode: 'drafts' };
  const read = await readTikTokCreator(house, { accountId: entryAccountId(entry) });
  if (!read.ok) return { ok: false, detail: read.detail };
  return { ok: true, mode: 'post', creator: read.creator, suggested: parsed.meta.suggested };
};

/**
 * The approval of a TikTok post: the person's choices, judged against the
 * account's creator info read at this moment, become the consent the store
 * records and the scheduler sends. impure — store + network.
 * @param {string} house
 * @param {{text: string, channelId?: string, accountId?: string}} entry - read as the account it speaks as
 * @param {object} rawChoice - the card's choices, off the wire
 * @returns {Promise<{ok: true, consent: object|null}|{ok: false, detail: string}>}
 */
export const tiktokApproval = async (house, entry, rawChoice) => {
  const parsed = parseTikTokDraft(entry.text);
  if (!parsed.ok) return { ok: false, detail: parsed.detail };
  if (parsed.meta.mode === 'drafts') return { ok: true, consent: null };
  const read = await readTikTokCreator(house, { accountId: entryAccountId(entry) });
  if (!read.ok) return { ok: false, detail: `${read.detail}; nothing was approved` };
  const choice = readChoice(rawChoice);
  const [blocked] = choiceBlockers(choice, read.creator);
  if (blocked) return { ok: false, detail: `${blocked}; nothing was approved` };
  return { ok: true, consent: consentRecord(choice, read.creator, new Date()) };
};
