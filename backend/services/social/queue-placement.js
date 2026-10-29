// queue-placement — where a draft stands in the house's marketing before it
// is staged (campaign plan slice 6): its campaign (the house's own, still
// running), the sub it serves (its account), the angle it argues, and the
// group it joins. Read fresh from THIS house only, so a draft can never name
// another house's campaign or join another house's group.
//
// impure — reads the house's campaigns, accounts, companies and queue.

import { campaignStoreFor } from '../marketing/campaign-store.js';
import { listCompanies } from '../marketing/companies.js';
import { listAccounts } from './account-store.js';
import { houseEntries } from './queue-house.js';
import { placeInCampaign } from './queue-campaign.js';
import { groupMembers, groupJoinRefusal } from './queue-group.js';

/**
 * @param {string} house - the wallet of the house the draft is staged in
 * @param {{accountId: string, campaignId?: ?string, angle?: string, pillar?: string, group?: string}} draft
 * @returns {Promise<{campaignId: ?string, angleId: ?string, pillar: string, groupId: ?string} | {error: string}>}
 */
export const placeDraft = async (house, { accountId, campaignId, angle, pillar, group }) => {
  const wantsCampaign = Boolean(String(campaignId || '').trim() || angle);
  const [campaigns, accounts] = await Promise.all([
    wantsCampaign ? campaignStoreFor(house).then((bench) => bench.load()) : [],
    listAccounts(house),
  ]);
  const placed = placeInCampaign({ campaigns, accounts, campaignId, accountId, angle, pillar });
  if (placed.error) return placed;
  const groupId = String(group || '').trim() || null;
  if (groupId) {
    const [entries, companies] = await Promise.all([houseEntries(house), listCompanies(house)]);
    const refusal = groupJoinRefusal({ groupId, accountId }, {
      members: groupMembers(entries, groupId), accounts, companies,
    });
    if (refusal) return { error: refusal };
  }
  return { ...placed, groupId };
};
