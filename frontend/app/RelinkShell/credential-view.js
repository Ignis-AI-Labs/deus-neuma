// credential-view.js — Settings → API as one map: every credential the house
// holds or lacks, in one state vocabulary, grouped by what it unlocks, so
// the tab is navigated by state rather than read as a column of forms.
//
// pure — states are read from the boards' masked truth and nothing else: a
// channel is PROVEN only when its flight test answered; a service has no
// test, so SET is the most it can be; a value is never seen here.

/** The states, in the order the operator should look at them. */
export const CREDENTIAL_STATES = Object.freeze(['failing', 'missing', 'set', 'proven', 'keyless']);

export const STATE_LABEL = Object.freeze({
  failing: 'FAILING', missing: 'NOT SET', set: 'SET', proven: 'PROVEN', keyless: 'NO KEY NEEDED',
});

/** pure — a channel: proven or failing by its flight test, else set or not. */
export const channelItem = (channel, test) => {
  const state = !channel.configured ? 'missing'
    : test?.ok === true ? 'proven'
      : test?.ok === false ? 'failing'
        : 'set';
  const detail = state === 'proven' ? (test.account?.name ? `@${test.account.name}` : 'answered')
    : state === 'failing' ? test.detail
      : state === 'set' ? 'not yet tested' : null;
  return Object.freeze({ key: `channel:${channel.id}`, id: channel.id, name: channel.name, group: 'CHANNELS', state, detail });
};

/** pure — a keyed service: set (here or in the env file), not set, or needing none. */
export const serviceItem = (service) => {
  const state = service.hasKey ? 'set' : service.requiresKey === false ? 'keyless' : 'missing';
  const detail = service.source === 'stored' ? 'saved here' : service.source === 'env' ? 'from the env file' : null;
  return Object.freeze({
    key: `service:${service.id}`, id: service.id, name: service.name,
    group: String(service.group || 'Services').toUpperCase(), state, detail,
  });
};

/** pure — the house mailbox: set when its account is connected; who holds it is the detail. */
export const emailItem = (account) => (account ? Object.freeze({
  key: 'email', id: 'email', name: account.name || 'MAILBOX', group: 'EMAIL',
  state: account.configured ? 'set' : 'missing',
  detail: account.configured ? (account.binding ? 'held by a being' : 'no being holds it') : null,
}) : null);

/** pure — every credential on the tab, one vocabulary. */
export const credentialItems = ({ channels, tests, services, email } = {}) => [
  ...(channels ?? []).map((c) => channelItem(c, tests?.[c.id])),
  ...(services ?? []).map(serviceItem),
  ...[emailItem(email)].filter(Boolean),
];

/** pure — how many credentials stand in each state. */
export const stateCounts = (items) => Object.fromEntries(
  CREDENTIAL_STATES.map((s) => [s, items.filter((i) => i.state === s).length]),
);

/** pure — the credentials under what they unlock, groups in first-seen order. */
export const groupItems = (items) => {
  const groups = new Map();
  for (const i of items) groups.set(i.group, [...(groups.get(i.group) ?? []), i]);
  return [...groups.entries()].map(([group, list]) => ({ group, items: list }));
};

/** pure — does a credential pass the map's state filter (empty = all)? */
export const passesState = (item, state) => !state || item?.state === state;
