/**
 * Which house ACCOUNT a being's social/post or social/queue speaks as
 * (campaign plan §2.4, slice 4). The being names `account` (`x-2`) or a
 * `company`; with neither, the one account it may use on that platform is
 * taken; with several, the act is refused in words that list them, before
 * any card. The card then says who will speak: […].
 *
 * MODE: 'hold' — the accounts the lane HOLDS (an instant post is custody);
 * 'stage' — the accounts whose crew it is on, or holds (staging is work).
 * Either way the account must have working keys.
 */
import { getChannel } from '../social/channel-registry.js';
import { channelBindings, canNeumaPost } from '../social/channel-bindings.js';
import { sectorCrew, canStageForSector } from '../sector-crew.js';
import { loadAccountStore, listAccounts, resolveAccountCredential } from '../social/account-store.js';
import { channelOfAccountId } from '../social/account-shape.js';
import { listCompanies } from '../marketing/companies.js';

/**
 * The accounts of the lane's house it may use on a platform (or on every
 * platform), each with its facts. An account it holds (or crews) counts even
 * before its keys are set — the act then answers "not configured" honestly —
 * unless `needKeys` (what a contract offers needs working keys). impure.
 * @param {{house: ?string, laneId: ?string, mode: 'hold'|'stage', channelId?: string, needKeys?: boolean}} who
 * @returns {Promise<Array<{id: string, channelId: string, companyId: ?string, label: string, expectedHandle: ?string}>>}
 */
export const usableAccounts = async ({ house, laneId, mode, channelId = null, needKeys = false }) => {
  if (!house || !laneId) return [];
  const [store, bindings, crew] = await Promise.all([
    loadAccountStore(house).catch(() => null),
    channelBindings.load(house).catch(() => ({})),
    mode === 'stage' ? sectorCrew.load(house).catch(() => ({})) : Promise.resolve({}),
  ]);
  if (!store) return [];
  const known = await listAccounts(house, store);
  const ids = [...new Set([...known.map((a) => a.id), ...Object.keys(bindings), ...Object.keys(crew)])]
    .filter((id) => channelOfAccountId(id) && (!channelId || channelOfAccountId(id) === channelId))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const out = [];
  for (const id of ids) {
    const may = mode === 'hold' ? canNeumaPost(bindings, id, laneId) : canStageForSector(crew, bindings, id, laneId);
    if (!may || (needKeys && !(await resolveAccountCredential(house, id, store).catch(() => null)))) continue;
    out.push(known.find((a) => a.id === id) || { id, channelId: channelOfAccountId(id), companyId: null, label: '', expectedHandle: null });
  }
  return out;
};

// pure — how a being and a card name one account.
const nameOf = (a) => `${a.id}${a.expectedHandle ? ` @${a.expectedHandle}` : a.label ? ` "${a.label}"` : ''}${a.companyId ? ` (${a.companyId})` : ''}`;

/**
 * The account this act speaks as, or the refusal in words (pure).
 * @param {ReadonlyArray<object>} usable - usableAccounts for one platform
 * @param {{account?: unknown, company?: unknown}} asked - what the being named
 * @param {{name: string}} channel
 * @returns {{ok: true, account: object}|{ok: false, reason: string}}
 */
export const chooseAccount = (usable, { account, company } = {}, channel) => {
  const list = usable.map(nameOf).join(', ');
  if (typeof account === 'string' && account.trim()) {
    const found = usable.find((a) => a.id === account.trim());
    return found ? { ok: true, account: found } : { ok: false, reason: `${account.trim()} is not a ${channel.name} account you may use — yours: ${list || 'none'}` };
  }
  const named = typeof company === 'string' && company.trim() ? company.trim() : null;
  const pool = named ? usable.filter((a) => a.companyId === named) : usable;
  if (pool.length === 1) return { ok: true, account: pool[0] };
  if (!pool.length) {
    return { ok: false, reason: named ? `you may use no ${channel.name} account of ${named} — yours: ${list || 'none'}` : `you may use no ${channel.name} account` };
  }
  return { ok: false, reason: `you may use ${pool.length} ${channel.name} accounts${named ? ` of ${named}` : ''} (${pool.map(nameOf).join(', ')}) — name the one with account` };
};

/**
 * The words the card stakes the decision on: who will speak. `live` is the
 * handle the platform itself named just now, when the act read it. impure.
 * @param {string} house
 * @param {object} account
 * @param {?string} [live]
 */
export const postsAsWords = async (house, account, live = null) => {
  const company = account.companyId
    ? (await listCompanies(house).catch(() => [])).find((c) => c.id === account.companyId)?.name || account.companyId
    : 'no company yet';
  const handle = live || account.expectedHandle || account.label || null;
  return `${getChannel(account.channelId)?.name || account.channelId} ${account.id}${handle ? ` @${String(handle).replace(/^@/, '')}` : ''} (${company})`;
};

/**
 * The account guidance a contract carries when the lane may use more than
 * one account on a platform — '' otherwise, so a one-account house reads
 * exactly the words it always did (pure).
 * @param {ReadonlyArray<object>} usable - every usable account, all platforms
 */
export const accountGuide = (usable) => {
  const byChannel = new Map();
  for (const a of usable) byChannel.set(a.channelId, [...(byChannel.get(a.channelId) || []), a]);
  const many = [...byChannel.entries()].filter(([, list]) => list.length > 1);
  if (!many.length) return '';
  return `ACCOUNTS: name which one speaks with account (or company, when that company has one account there) — ${many.map(([ch, list]) => `${getChannel(ch)?.name || ch}: ${list.map(nameOf).join(', ')}`).join('; ')}.`;
};
