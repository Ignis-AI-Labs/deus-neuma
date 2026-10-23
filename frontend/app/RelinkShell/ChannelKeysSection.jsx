// ChannelKeysSection — the API keys for every platform the house speaks
// through, gathered under SETTINGS → API (Founder's law, 2026-07-23: keys are
// linked in Settings, not scattered through the operational boards).
//
// Keys are sealed on this machine and never echoed back — a set field shows
// only THAT it is set and where it came from (store or env). Each platform
// card holds its developer APP once and its ACCOUNTS (several per platform,
// each under a company — campaign plan §2.6). WHO may post is a different
// decision entirely: each account's single holder is chosen in the
// platform's own OUTREACH window, because keys alone never let a being speak.

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getAccountFlights } from '../../services/social-accounts-client.js';
import { KeyLink } from './KeyLink.jsx';
import { CredentialRow } from './CredentialMap.jsx';
import { channelItem, passesState } from './credential-view.js';
import { AccountsList } from './accounts/AccountsList.jsx';
import { useHouseAccounts } from './accounts/use-house-accounts.js';

// One platform: its app once, then its accounts (accounts/AccountsList.jsx).
const ChannelKeysCard = ({ channel, item, open, onToggle, house, tests, onChanged, onRetest }) => (
  <CredentialRow item={item} open={open} onToggle={onToggle}>
    <KeyLink family="channel" id={channel.id} lead="GET THE KEYS" />
    <AccountsList channel={channel} house={house} tests={tests} onChanged={onChanged} onRetest={onRetest} />
  </CredentialRow>
);

// impure — every account's live proof, read once and again on RE-TEST.
const useAccountFlights = () => {
  const [tests, setTests] = useState({});
  const read = useCallback((fresh) => getAccountFlights({ fresh })
    .then((r) => setTests(r.tests || {}), () => null), []);
  useEffect(() => { read(false); }, [read]);
  return { tests, retest: () => read(true) };
};

/**
 * The platform keys, one row each, from the boards the API tab read once
 * (use-api-credentials.js). Under a state filter only matching rows stand,
 * and a section with none steps aside.
 */
export const ChannelKeysSection = ({ channels, tests, error, onChanged, onRetest, stateFilter, openKey, onOpen }) => {
  const { t } = useTranslation('settingsApi');
  const house = useHouseAccounts();
  const flights = useAccountFlights();
  // A change re-reads the board, the accounts, and every account's proof.
  const changed = async () => {
    await Promise.all([onChanged(), house.refresh()]);
    flights.retest();
  };
  const rows = (channels ?? []).map((channel) => ({ channel, item: channelItem(channel, tests?.[channel.id]) }))
    .filter(({ item }) => passesState(item, stateFilter));
  if (stateFilter && rows.length === 0) return null;

  return (
    <section className="settings-sec">
      <div className="label-data settings-h">{t('channelKeys.heading')}</div>
      <p className="settings-note">{t('channelKeys.note')}</p>

      {error ? <p className="settings-err">{error}</p> : null}
      {!channels && !error ? <p className="settings-note">{t('channelKeys.reading')}</p> : null}

      {rows.map(({ channel, item }) => (
        <ChannelKeysCard key={channel.id} channel={channel} item={item} house={house} tests={flights.tests}
          open={openKey === item.key} onToggle={() => onOpen(openKey === item.key ? null : item.key)}
          onRetest={() => { onRetest({ fresh: true }); flights.retest(); }} onChanged={changed} />
      ))}
    </section>
  );
};
