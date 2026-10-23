// connect-flow.js — the desk's CONNECT for a channel whose key is a sign-in
// (YouTube through Google, TikTok through Login Kit): one pending consent per
// house, from the house's own app client to tokens sealed in that house's
// channel credentials.
//
//   start → the loopback listener stands and the desk opens the consent URL
//           in the system browser;
//   the browser returns → the platform's own settle step checks the tokens,
//           names the account and seals what it must keep;
//   poll  → the desk reads the outcome: pending, complete (with the account's
//           name), or the plain reason it failed.
//
// One pending connect per house (keyed by its wallet); a new start cancels
// the old one. The client is the house's own, resolved the same way every
// channel field is (store > .env where the house may use it).

import { loadChannelCredentials, houseEnvFor } from './channel-credentials.js';
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
 * One channel's CONNECT. impure — the flows live in memory.
 * @param {{needClient: string,
 *   resolveClient: (house: string) => Promise<object|null>,
 *   openConsent: (client: object) => Promise<{authUrl: string, done: Promise<object>, cancel: () => void}>,
 *   settle: (house: string, answer: object, client: object) => Promise<object>}} spec
 */
export const createConnectFlow = ({ needClient, resolveClient, openConsent, settle }) => {
  const pending = new Map();
  return Object.freeze({
    /** @returns {Promise<{ok: true, authUrl: string}|{ok: false, error: string}>} */
    async start(wallet) {
      const house = houseKey(wallet);
      if (!house) return { ok: false, error: 'connecting a channel needs a signed-in house' };
      const client = await resolveClient(house);
      if (!client) return { ok: false, error: needClient };
      pending.get(house)?.consent.cancel();
      const consent = await openConsent(client);
      const flow = { consent, outcome: { status: 'pending' } };
      pending.set(house, flow);
      consent.done
        .then((answer) => (answer.ok ? settle(house, answer, client) : { status: 'error', error: answer.detail }))
        .catch((err) => ({ status: 'error', error: err.message }))
        .then((outcome) => { flow.outcome = outcome; });
      return { ok: true, authUrl: consent.authUrl };
    },
    /** @returns {{status: 'pending'|'complete'|'error'|'idle', error?: string, channel?: object}} */
    poll(wallet) {
      return pending.get(houseKey(wallet))?.outcome || { status: 'idle' };
    },
    /** Cancel the house's pending connect, if any. */
    cancel(wallet) {
      const flow = pending.get(houseKey(wallet));
      flow?.consent.cancel();
      return Boolean(flow);
    },
  });
};
