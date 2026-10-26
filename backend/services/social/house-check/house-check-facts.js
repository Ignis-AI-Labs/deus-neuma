// house-check-facts — what the HOUSE SOCIAL CHECK stands on, read from the
// house's real stores, and the one call that turns them into the report
// (house-check.js). Read-only: nothing here writes a store. The live identity
// probes (flight-test.js) are the only thing that leaves the machine, and
// only when asked for.
//
// THE HOUSE, NEVER ANOTHER. Every store is opened for this house's wallet.
// The one look past it is check 9 ([…]):
// another house's accounts are compared by platform user id and by a
// fingerprint of their keys inside this process, and the answer names no
// house and no value — only that another house on this machine connects the
// same account.
//
// impure — disk, clock, and (when asked) the platforms' identity endpoints.

import fs from 'fs/promises';
import { dirname } from 'path';
import { createHash } from 'crypto';
import { CHANNEL_CATALOG, getChannel } from '../channel-registry.js';
import {
  loadAccountStore, peekAccountStore, listAccounts, resolveAccountCredential, channelCredentialsPath,
} from '../account-store.js';
import { storedFieldsOf, entryAccountId, firstAccountId } from '../account-shape.js';
import { channelBindings } from '../channel-bindings.js';
import { sectorCrew, crewOf } from '../../sector-crew.js';
import { houseOfLane, housesWith } from '../house-positions.js';
import { postQueue } from '../post-queue.js';
import { ofHouse } from '../queue-house.js';
import { readServed } from '../../house-served.js';
import { runAccountFlightTests } from '../flight-test.js';
import { listCompanies } from '../../marketing/companies.js';
import { campaignStoreFor } from '../../marketing/campaign-store.js';
import { cmoDesignation } from '../../marketing/cmo-designation.js';
import { isWitnessLaneId } from '../../witness-lane.js';
import { houseKey } from '../../staff/cos-designation.js';
import { neumaWorkspace } from '../../../../core/index.js';
import { plannedByDay, quotaFor } from './app-quota.js';
import { buildHouseCheck } from './house-check.js';

const CREDENTIAL_FILE = 'social-channel-credentials.json';
const WAITING = new Set(['draft', 'approved']);

// The house's own stores, as the running backend opens them. The read-only
// readers (scripts) pass their own: the account store peeked, never migrated.
const BACKEND_READS = Object.freeze({
  store: loadAccountStore,
  campaigns: async (wallet) => (await campaignStoreFor(wallet)).load(),
});

// pure — a fingerprint of an account's own secret keys (never the keys).
const keyPrint = (store, accountId, channel) => {
  const fields = storedFieldsOf(store, accountId);
  const secrets = channel.fields.filter((f) => f.secret && !f.app).map((f) => fields[f.key] || '');
  return secrets.some(Boolean) ? createHash('sha256').update(secrets.join('\u0000')).digest('hex') : null;
};

// impure — a lane as the check needs it: its house, whether it is an
// external, and (for a lane of the house) the name it goes by, so a fix
// handed to it names it.
const laneOf = async (neumaId, kind) => {
  const external = kind === 'witness' || isWitnessLaneId(neumaId);
  return {
    neumaId,
    external,
    house: await houseOfLane(neumaId).catch(() => null),
    name: external ? null : (await neumaWorkspace.readTrueName(neumaId).catch(() => null))?.chosenName || null,
  };
};

// impure — the mode of the house's keys file and its folder.
const fileFacts = async (wallet) => {
  const path = channelCredentialsPath(wallet);
  const [file, dir] = await Promise.all([fs.stat(path).catch(() => null), fs.stat(dirname(path)).catch(() => null)]);
  return file ? { exists: true, path, mode: file.mode & 0o777, dirMode: dir ? dir.mode & 0o777 : null } : { exists: false, path };
};

// impure — every other house's accounts, as (channel, platform user, key print).
const otherHouseMarks = async (wallet) => {
  const me = houseKey(wallet);
  const marks = [];
  for (const house of await housesWith(CREDENTIAL_FILE)) {
    if (house === me) continue;
    const { store } = await peekAccountStore(house).catch(() => ({ store: { accounts: {} } }));
    for (const [id, a] of Object.entries(store.accounts || {})) {
      const channel = getChannel(a.channelId);
      if (!channel) continue;
      marks.push({ channelId: a.channelId, platformUserId: a.platformUserId || null, print: keyPrint(store, id, channel) });
    }
  }
  return marks;
};

// impure — only the two non-secret facts the checks read from a credential.
const metaOf = async (wallet, accountId, store) => {
  const c = await resolveAccountCredential(wallet, accountId, store).catch(() => null);
  return { grantedScope: c?.grantedScope || '', tokenExpiresAt: c?.tokenExpiresAt || '' };
};

// pure — the campaigns an account plays a part in while they run: the
// campaign's one platform (its first account), or a part named by account.
const campaignsOf = (campaigns, accountId) => campaigns
  .filter((c) => c.status === 'active')
  .filter((c) => (c.channelId && firstAccountId(c.channelId) === accountId)
    || (Array.isArray(c.subs) && c.subs.some((s) => s?.accountId === accountId)))
  .map((c) => c.id);

/**
 * The house's social check, from its real stores. impure.
 * @param {string} wallet - the house
 * @param {{probes?: boolean, fresh?: boolean, now?: number,
 *   reads?: {store: Function, campaigns: Function}}} [opts]
 *   probes — prove each keyed account live (flight-test.js, cached 60 s unless fresh)
 */
export const runHouseCheck = async (wallet, { probes = true, fresh = false, now = Date.now(), reads = BACKEND_READS } = {}) => {
  const house = houseKey(wallet);
  const store = await reads.store(wallet);
  const [accounts, bindings, crewStore, companies, served, queue, campaigns, others, file, officer] = await Promise.all([
    listAccounts(wallet, store), channelBindings.load(wallet), sectorCrew.load(wallet), listCompanies(wallet),
    readServed(), postQueue.load(), reads.campaigns(wallet).catch(() => []), otherHouseMarks(wallet), fileFacts(wallet),
    cmoDesignation.getOfficer(wallet).catch(() => null),
  ]);
  // The house's seated CMO: a link gap of a company is its to propose (marketing/company-links).
  const cmo = officer?.laneId ? await laneOf(officer.laneId, 'neuma') : null;
  const entries = ofHouse(served, queue, wallet).map((e) => ({ ...e, accountId: entryAccountId(e) }));
  const plan = plannedByDay(entries, now);
  const keyed = accounts.filter((a) => a.configured).map((a) => a.id);
  const tests = probes ? await runAccountFlightTests({ wallet, accountIds: keyed, fresh }) : {};
  const prints = new Map(accounts.map((a) => [a.id, keyPrint(store, a.id, getChannel(a.channelId))]));
  const userOf = (a) => a.platformUserId || (tests[a.id]?.ok === true ? String(tests[a.id].account?.id || '') : '') || null;
  const rootOf = (companyId) => companies.find((c) => c.id === companyId)?.rootId ?? null;

  const facts = await Promise.all(accounts.map(async (account) => {
    const channel = getChannel(account.channelId);
    const binding = bindings[account.id] || null;
    const twins = (match) => accounts.filter((o) => o.id !== account.id && o.channelId === account.channelId && match(o));
    const user = userOf(account);
    const sameUser = user ? twins((o) => userOf(o) === user) : [];
    const sameKeys = prints.get(account.id) ? twins((o) => prints.get(o.id) === prints.get(account.id)) : [];
    const envOthers = channel.fields.some((f) => process.env[f.env]) && !account.fields.some((f) => f.source === 'store')
      ? (await channelBindings.holdersBesides(wallet, account.channelId)).length > 0 : false;
    return {
      account,
      house,
      now,
      envNames: Object.fromEntries(channel.fields.map((f) => [f.key, f.env])),
      probe: probes ? tests[account.id] || null : null,
      holder: binding?.neumaId ? await laneOf(binding.neumaId, 'neuma') : null,
      crew: await Promise.all(crewOf(crewStore, account.id).map((m) => laneOf(m.neumaId, m.kind))),
      meta: await metaOf(wallet, account.id, store),
      shared: {
        channelName: account.channelName,
        sameUser: sameUser.map((o) => o.id),
        sameKeys: sameKeys.map((o) => o.id),
        otherTree: [...sameUser, ...sameKeys].some((o) => rootOf(o.companyId) !== rootOf(account.companyId)),
        otherHouse: others.some((m) => m.channelId === account.channelId
          && ((user && m.platformUserId === user) || (prints.get(account.id) && m.print === prints.get(account.id)))),
        envOtherHouse: envOthers,
      },
      file,
      live: entries.filter((e) => e.accountId === account.id && WAITING.has(e.status) && !e.placeholder),
      company: companies.find((c) => c.id === account.companyId) || null,
      cmo,
      campaigns: campaignsOf(campaigns, account.id),
      quota: quotaFor(account.id, account.channelId, accounts.filter((o) => o.appId === account.appId).map((o) => o.id), plan),
    };
  }));
  return buildHouseCheck({
    accounts: facts,
    companies,
    channels: CHANNEL_CATALOG.map((c) => ({ id: c.id, name: c.name })),
    checkedAt: new Date(now).toISOString(),
    probed: probes,
  });
};
