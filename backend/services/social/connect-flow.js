// connect-flow.js — the desk's CONNECT for a channel whose key is a sign-in
// (YouTube through Google, TikTok through Login Kit): one pending consent per
// ACCOUNT of a house (several may wait at once), from the house's own app
// client to tokens sealed in that account's credentials.
//
//   start → the loopback listener stands and the desk opens the consent URL
//           in the system browser;
//   the browser returns → the platform's own settle step checks the tokens,
//           names the account and seals what it must keep;
//   poll  → the desk reads the outcome: pending, complete (with the account's
//           name), or the plain reason it failed.
//
// One pending connect per house ACCOUNT (keyed `wallet|accountId`); a new
// start for the same account cancels its old one, never another account's.
// The client is the house's one app for the platform, resolved the same way
// every channel field is (store > .env where the house may use it).

import { loadChannelCredentials, houseEnvFor } from './channel-credentials.js';
import { loadAccountStore, setAccountFields, setAccountMeta } from './account-store.js';
import { channelOfAccountId, firstAccountId } from './account-shape.js';
import { getChannel } from './channel-registry.js';
import { houseKey } from '../staff/cos-designation.js';

/**
 * The house's own app client for a channel, or null when a field is missing.
 * impure — credential store.
 * @param {string} wallet
 * @param {string} channelId
 * @param {Record<string, string>} keys - client field key → its .env name
 * @returns {Promise<Record<string, string>|null>}
 */
export const houseClientFor = async (wallet, channelId, keys) => {
  const channel = getChannel(channelId);
  const stored = (await loadChannelCredentials(wallet))?.[channelId] || {};
  const env = await houseEnvFor(wallet, channel);
  const client = Object.fromEntries(Object.entries(keys).map(([key, envName]) => [key, stored[key] || env[envName] || '']));
  return Object.values(client).every(Boolean) ? client : null;
};

/**
 * Seal what a consent proved onto ITS account: the tokens, and the platform's
 * own id for the person who signed in. The same platform user connected as a
 * second account of this house is refused — one person, one account. impure.
 * @param {string} house
 * @param {string} accountId
 * @param {Record<string, string>} fields - the tokens to seal
 * @param {{id: string, name?: string}} who - the account the platform named
 * @returns {Promise<?string>} the refusal, or null once sealed
 */
export const sealConnection = async (house, accountId, fields, who) => {
  const store = await loadAccountStore(house);
  const twin = Object.entries(store.accounts || {})
    .find(([id, a]) => id !== accountId && a.channelId === channelOfAccountId(accountId) && a.platformUserId === String(who.id));
  if (twin) return `that account is already connected here as ${twin[0]} — remove ${twin[0]} first, or CONNECT ${accountId} with a different account`;
  await setAccountFields(house, accountId, fields);
  const label = store.accounts?.[accountId]?.label;
  await setAccountMeta(house, accountId, { platformUserId: String(who.id), ...(label ? {} : { label: String(who.name || '').slice(0, 120) }) }, []);
  return null;
};

/**
 * One channel's CONNECT. impure — the flows live in memory.
 * @param {{needClient: string,
 *   resolveClient: (house: string) => Promise<object|null>,
 *   openConsent: (client: object) => Promise<{authUrl: string, done: Promise<object>, cancel: () => void}>,
 *   settle: (house: string, answer: object, accountId: string) => Promise<object>}} spec
 */
export const createConnectFlow = ({ needClient, resolveClient, openConsent, settle }) => {
  const pending = new Map();
  const keyOf = (wallet, accountId) => `${houseKey(wallet)}|${accountId}`;
  return Object.freeze({
    /**
     * @param {string} wallet
     * @param {string} accountId - the house account the consent seals into
     * @returns {Promise<{ok: true, authUrl: string}|{ok: false, error: string}>}
     */
    async start(wallet, accountId) {
      const house = houseKey(wallet);
      if (!house) return { ok: false, error: 'connecting a channel needs a signed-in house' };
      const store = await loadAccountStore(house);
      if (!store.accounts?.[accountId] && accountId !== firstAccountId(channelOfAccountId(accountId))) {
        return { ok: false, error: `there is no account ${accountId} in this house — ADD ACCOUNT first` };
      }
      const client = await resolveClient(house);
      if (!client) return { ok: false, error: needClient };
      pending.get(keyOf(house, accountId))?.consent.cancel();
      const consent = await openConsent(client);
      const flow = { consent, outcome: { status: 'pending' } };
      pending.set(keyOf(house, accountId), flow);
      consent.done
        .then((answer) => (answer.ok ? settle(house, answer, accountId) : { status: 'error', error: answer.detail }))
        .catch((err) => ({ status: 'error', error: err.message }))
        .then((outcome) => { flow.outcome = outcome; });
      return { ok: true, authUrl: consent.authUrl };
    },
    /** @returns {{status: 'pending'|'complete'|'error'|'idle', error?: string, channel?: object}} */
    poll(wallet, accountId) {
      return pending.get(keyOf(wallet, accountId))?.outcome || { status: 'idle' };
    },
    /** Cancel the account's pending connect, if any. */
    cancel(wallet, accountId) {
      const flow = pending.get(keyOf(wallet, accountId));
      flow?.consent.cancel();
      return Boolean(flow);
    },
  });
};
