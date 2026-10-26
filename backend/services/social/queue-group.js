// queue-group — ONE asset fanned out to several accounts, decided with one
// press (campaign plan §3.2, slice 6). A group is the house's own posts that
// carry the same `groupId`: one post per account, every account inside ONE
// company tree (a group never spans two trees). Each post keeps its own
// campaign — a subsidiary's account runs its own company's campaign.
//
// APPROVE GROUP approves every draft of the group in one atom, all or nothing
// — each copy SEEN as it stands, each through the outbound-secret check. A
// platform that asks its own consent per post (TikTok's card: who can watch,
// interactions, disclosure) keeps it: its post is approved in the group only
// with its own choices given, and otherwise stays a draft, named, for its card.
//
// Pure — entries in, entries changed in place (the caller holds the store's
// lock and saves), or a refusal that changes nothing.

import { queuedSecretRefusal } from './queue-rules.js';
import { tiktokApproveRefusal } from './tiktok-metadata.js';

const LIVE = Object.freeze(['draft', 'approved', 'sending', 'sent']);

/** The members of a group among (already the house's) entries. */
export const groupMembers = (entries, groupId) => (entries || []).filter((e) => groupId && e.groupId === groupId);

// The root company of an account, or null for an account with no company.
const rootOf = (accountId, accounts, companies) => {
  const companyId = accounts.find((a) => a.id === accountId)?.companyId;
  if (!companyId) return null;
  return companies.find((c) => c.id === companyId)?.rootId || companyId;
};

/**
 * Why this draft cannot join its group, in words — or null.
 * @param {{groupId: string, accountId: string}} draft
 * @param {{members: object[], accounts: object[], companies: object[]}} house - the group's members in this house
 */
export const groupJoinRefusal = (draft, { members, accounts, companies }) => {
  const root = rootOf(draft.accountId, accounts, companies);
  if (!root) return `${draft.accountId} has no company yet — a group fans out within one company tree, so its account needs its company first`;
  const taken = members.find((m) => m.accountId === draft.accountId && LIVE.includes(m.status));
  if (taken) return `${draft.accountId} already carries group "${draft.groupId}" (post ${taken.id}) — one post per account; a new asset takes a new group name`;
  const other = members.find((m) => rootOf(m.accountId, accounts, companies) !== root);
  return other ? `group "${draft.groupId}" already speaks for another company tree (${other.accountId}) — a group never spans two trees` : null;
};

/**
 * Approve every draft of the group, all or nothing. A TikTok draft rides the
 * decision only with its own choices (`consents[id]`); without them it stays
 * a draft and is named in `ownCard`.
 * @param {object[]} entries - the whole store (mutated on success)
 * @param {string} groupId
 * @param {{ids: ReadonlySet<string>, decidedBy: string, textsSeen: Record<string, string>,
 *   consents?: Record<string, object|null>, now: Date}} decision - ids: the house's own members
 * @returns {{approved: object[], ownCard: string[]} | {error: string}}
 */
export const approveGroupIn = (entries, groupId, { ids, decidedBy, textsSeen = {}, consents = {}, now }) => {
  const members = groupMembers(entries, groupId).filter((e) => ids.has(e.id));
  if (!members.length) return { error: 'no such group' };
  const drafts = members.filter((e) => e.status === 'draft' && !e.placeholder);
  const ownCard = drafts.filter((e) => e.channelId === 'tiktok' && !(e.id in consents)).map((e) => e.id);
  const deciding = drafts.filter((e) => !ownCard.includes(e.id));
  if (!deciding.length) {
    return { error: ownCard.length ? 'every waiting post of this group asks its own card (TikTok) — approve each from its card' : 'nothing in this group awaits approval' };
  }
  for (const e of deciding) {
    if (textsSeen[e.id] !== e.text) return { error: `the post on ${e.accountId} changed since you read it — nothing in the group was approved; read it again` };
    const secret = queuedSecretRefusal(e, 'nothing in the group was approved');
    if (secret) return { error: `${e.accountId}: ${secret}` };
    const tiktok = tiktokApproveRefusal(e, { consent: consents[e.id], textSeen: textsSeen[e.id] });
    if (tiktok) return { error: `${e.accountId}: ${tiktok}` };
  }
  for (const e of deciding) {
    if (e.channelId === 'tiktok') e.tiktokConsent = consents[e.id] ?? null;
    e.status = 'approved';
    e.decidedBy = String(decidedBy || '');
    e.decidedAt = now.toISOString();
  }
  return { approved: deciding, ownCard };
};
