// queue-links — a draft's links become tracked links as it is staged
// (campaign plan §4.1, slice 7): each trackable link is replaced by
// https://deusneuma.ai/go/<code>, the codes are published to the site counter
// FIRST, and only then does the draft carry them — so a posted /go/ link
// always resolves. When the house has no site counter set up, or the counter
// does not take the codes, the links are left exactly as written and the
// caller is told why: an untracked link is honest, a dead one is not.
//
// The operator approves the copy WITH its counted links — the card shows the
// text that will go out.
//
// impure — crypto, the credential store, the network, the house's link map.

import crypto from 'crypto';
import { planLinks, codeFromBytes } from '../marketing/link-codes.js';
import { siteCounterRoot, siteCounterStatus, publishCodes } from '../marketing/site-counter.js';
import { appendLinks, bindLinks } from '../marketing/link-store.js';
import { listAccounts } from './account-store.js';

/**
 * @param {string} house
 * @param {{channelId: string, accountId: string, text: string, campaignId?: ?string, angleId?: ?string}} draft
 * @returns {Promise<{text: string, codes: string[], note: ?string}>}
 */
export const trackLinks = async (house, { channelId, accountId, text, campaignId = null, angleId = null }) => {
  const planned = planLinks(text, { channelId, base: siteCounterRoot(), mint: () => codeFromBytes(crypto.randomBytes(6)) });
  if (!planned.links.length) return { text, codes: [], note: null };
  if (!(await siteCounterStatus(house)).configured) {
    return { text, codes: [], note: 'its links are left as written and not counted: the site counter is not set up for this house' };
  }
  const companyId = (await listAccounts(house)).find((a) => a.id === accountId)?.companyId ?? null;
  const createdAt = new Date().toISOString();
  const records = planned.links.map((l) => ({ ...l, channelId, accountId, campaignId, angleId, companyId, createdAt }));
  const published = await publishCodes(house, records);
  const states = new Map((published.results || []).map((r) => [r.code, r.state]));
  if (!published.ok || records.some((r) => !['published', 'already'].includes(states.get(r.code)))) {
    return { text, codes: [], note: `its links are left as written and not counted: ${published.ok ? 'the site counter refused a code' : published.detail}` };
  }
  await appendLinks(house, records.map((r) => ({ ...r, published: { state: states.get(r.code), at: createdAt } })));
  return { text: planned.text, codes: records.map((r) => r.code), note: `${records.length} link(s) now count clicks through the site counter` };
};

/** Tie the codes to the staged post. impure. */
export const bindTrackedLinks = (house, codes, entryId) => (codes.length ? bindLinks(house, codes, entryId) : null);
