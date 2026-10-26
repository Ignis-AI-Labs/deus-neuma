// queue-campaign — a staged post's place in a campaign (campaign plan §3.1,
// slice 6): the campaign it serves, the ANGLE it argues, and the GROUP it
// belongs to when one asset fans out to several accounts. A post's
// (campaignId, accountId) names its sub-campaign.
//
// Pure. The house's campaigns and accounts arrive as arguments
// (queue-placement.js reads them); queue entries are never rewritten — an
// old entry's `pillar` is read as its angle's name.

import { angleNamed } from '../marketing/campaign-shape.js';

const GROUP_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const ANGLE_ID = /^[a-z0-9][a-z0-9-]{0,47}$/;

/**
 * What is wrong with a draft's campaign fields (their form only), or null.
 * @param {{angleId?: string, groupId?: string, kind?: string}} draft
 */
export const campaignFieldsRefusal = (draft) => {
  if (draft?.angleId != null && !ANGLE_ID.test(String(draft.angleId))) return 'angleId is one of the campaign\'s angle ids (lowercase, digits, hyphens)';
  if (draft?.groupId == null) return null;
  if (!GROUP_ID.test(String(draft.groupId))) return 'a group is a short name: lowercase letters, digits and hyphens, at most 40';
  return draft.kind === 'reply' || draft.kind === 'self-reply'
    ? 'a reply or a follow-up is never part of a group — a group fans ONE post out to several accounts'
    : null;
};

/** The campaign fields an entry keeps — copied only when set, so other entries never change shape. */
export const campaignFieldsOf = (draft) => ({
  ...(draft?.angleId ? { angleId: String(draft.angleId) } : {}),
  ...(draft?.groupId ? { groupId: String(draft.groupId) } : {}),
});

/** A campaign of the house by its id or a unique prefix of it (8+ characters), or null. */
export const campaignNamed = (campaigns, given) => {
  const g = String(given || '').trim();
  if (!g) return null;
  const exact = campaigns.find((c) => c.id === g);
  if (exact) return exact;
  const prefixed = g.length >= 8 ? campaigns.filter((c) => c.id.startsWith(g)) : [];
  return prefixed.length === 1 ? prefixed[0] : null;
};

/** The angle an entry argues, as the campaign names it: its angleId, else its pillar by name. */
export const entryAngle = (entry, campaign) => angleNamed(campaign?.angles, entry?.angleId)
  || angleNamed(campaign?.angles, entry?.pillar) || null;

/**
 * Place a draft in its campaign: the campaign must be the house's and still
 * running, the account one of its subs (or, for a campaign with no subs yet,
 * an account of its company), the angle one of its angles.
 * @param {{campaigns: object[], accounts: object[], campaignId?: string, accountId: string,
 *   angle?: string, pillar?: string}} input
 * @returns {{campaignId: ?string, angleId: ?string, pillar: string} | {error: string}}
 */
export const placeInCampaign = ({ campaigns, accounts, campaignId, accountId, angle, pillar }) => {
  const words = String(pillar || '').trim();
  if (!String(campaignId || '').trim()) {
    return angle ? { error: 'an angle belongs to a campaign — name the campaign (campaignId) it argues for' } : { campaignId: null, angleId: null, pillar: words };
  }
  const campaign = campaignNamed(campaigns, campaignId);
  if (!campaign) return { error: `there is no campaign "${campaignId}" in this house (campaign_list shows them)` };
  if (campaign.status === 'done') return { error: `the campaign "${campaign.name}" is done — nothing more is staged under it` };
  const subs = campaign.subs || [];
  if (subs.length && !subs.some((s) => s.accountId === accountId)) {
    return { error: `${accountId} has no part in "${campaign.name}" — its sub-campaigns run on ${subs.map((s) => s.accountId).join(', ')}` };
  }
  const account = accounts.find((a) => a.id === accountId);
  if (!subs.length && campaign.companyId && account?.companyId !== campaign.companyId) {
    return { error: `${accountId} is not an account of ${campaign.companyId}, the company "${campaign.name}" speaks for` };
  }
  const named = angle ? angleNamed(campaign.angles, angle) : angleNamed(campaign.angles, words);
  if (angle && !named) {
    const known = (campaign.angles || []).map((a) => a.name);
    return { error: `"${campaign.name}" has no angle "${angle}"${known.length ? ` — its angles: ${known.join(', ')}` : ' — it names no angles yet'}` };
  }
  return { campaignId: campaign.id, angleId: named?.id ?? null, pillar: named?.name ?? words };
};
