// campaign-upgrade — a house's campaigns from the first shape (brand, ONE
// optional channelId, bare-string pillars) to shape v2 (campaign plan §3.1).
// Pure: the disk half (the kept v1 copy, the write, the log) is
// campaign-store.js.
//
// NO DATA LOSS. Pillars become angles with the same names, in order. A
// single-channel campaign becomes one sub on that platform's first account
// (`<channel>-1`, the account the house's keys became in slice 2). The brand
// text names the company when it is one of the house's kits; when it is not,
// the campaign stands UNSORTED (companyId null) with its brand kept, and the
// log says so. Every other key rides across verbatim, and `migratedFrom`
// keeps the old channel and pillars word for word.

import { CAMPAIGN_VERSION, settleAngles } from './campaign-shape.js';
import { getChannel } from '../social/channel-registry.js';
import { firstAccountId } from '../social/account-shape.js';

/** Is this record already shape v2? Pure. */
export const isCampaignV2 = (record) => record?.v === CAMPAIGN_VERSION;

/**
 * The company a v1 brand names: a kit id equal to it, else equal ignoring
 * case, else null (UNSORTED). Pure.
 * @param {string} brand
 * @param {string[]} companyIds
 */
export const companyForBrand = (brand, companyIds) => {
  const b = String(brand || '').trim();
  if (!b) return null;
  return companyIds.find((id) => id === b) || companyIds.find((id) => id.toLowerCase() === b.toLowerCase()) || null;
};

/**
 * One v1 campaign as shape v2. Pure.
 * @param {object} v1
 * @param {{companyIds?: string[], at?: string}} [opts]
 */
export const upgradeCampaign = (v1, { companyIds = [], at = new Date().toISOString() } = {}) => {
  if (isCampaignV2(v1)) return v1;
  const { pillars, channelId, ...rest } = v1 || {};
  const names = Array.isArray(pillars) ? pillars.filter((p) => typeof p === 'string' && p.trim()) : [];
  const angles = settleAngles(names);
  const channel = channelId ? getChannel(channelId) : null;
  const subs = channel
    ? [{ accountId: firstAccountId(channel.id), role: '', cadence: String(rest.cadence || ''), angleIds: angles.map((a) => a.id) }]
    : [];
  const companyId = companyForBrand(rest.brand, companyIds);
  const what = [
    'moved to campaign shape v2',
    names.length ? `${names.length} pillar(s) became angles` : null,
    subs.length ? `its ${channel.name} campaign became the sub on ${subs[0].accountId}` : null,
    channelId && !channel ? `its unknown channel "${channelId}" is kept in migratedFrom` : null,
    companyId ? `company ${companyId}` : `no company of this house is named "${rest.brand || ''}": UNSORTED until one is set`,
  ].filter(Boolean).join('; ');
  return {
    ...rest,
    v: CAMPAIGN_VERSION,
    companyId,
    brand: String(rest.brand || ''),
    goal: null,
    kpi: null,
    window: null,
    budget: null,
    angles,
    subs,
    asks: Array.isArray(rest.asks) ? rest.asks : [],
    log: [...(Array.isArray(rest.log) ? rest.log : []), { at, by: 'system', what }],
    migratedFrom: { v: 1, at, channelId: channelId ?? null, pillars: Array.isArray(pillars) ? pillars : [] },
  };
};
