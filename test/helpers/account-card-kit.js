/**
 * One platform's card in SETTINGS → API → CHANNEL KEYS, rendered for real
 * (react-dom/server): the PRODUCTION AccountsList — the app once, then the
 * platform's first account — from a store entry masked by the REAL registry,
 * in the shapes the accounts route answers (listApps / listAccounts mask the
 * same way). No mocks: real components, real i18n catalog, real masking.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AccountsList } from '../../frontend/app/RelinkShell/accounts/AccountsList.jsx';
import { getChannel, maskChannelCredentials } from '../../backend/services/social/channel-registry.js';

/**
 * @param {string} channelId
 * @param {Record<string, string>|undefined} store - the platform's stored fields (app + first account)
 * @param {object|null} [test] - the first account's flight test
 * @returns {string} the card's markup
 */
export const renderAccountCard = (channelId, store, test = null) => {
  const channel = getChannel(channelId);
  const masked = maskChannelCredentials(channel, store, {});
  const appFields = channel.fields.filter((f) => f.app);
  const accountId = `${channelId}-1`;
  const house = {
    apps: appFields.length ? [maskChannelCredentials({ ...channel, fields: appFields }, store, {})] : [],
    accounts: [{
      id: accountId, channelId, channelName: channel.name, companyId: null, label: '', expectedHandle: null,
      platformUserId: null, appId: channelId, recorded: true, configured: masked.configured, fields: masked.fields,
    }],
    companies: [],
  };
  return renderToStaticMarkup(createElement(AccountsList, {
    channel: masked, house, tests: test ? { [accountId]: test } : {}, onChanged: async () => {}, onRetest: () => {},
  }));
};
