// SettingsApiTab — Settings → API: every outward credential, read as a map
// before it is read as forms, so it is navigated by state rather than by
// scrolling. The boards are read once (use-api-credentials.js)
// and handed to the map and to every section; a state on the map filters the
// rows below, a tile opens its row, and only one row stands open at a time.
// A deep link to one account (`channel-keys/<platform>/<account>`, the house
// social check's KEYS and CONNECT doors) opens its platform's row and brings
// the account's own row into view, marked.

import { useEffect, useState } from 'react';
import { uiSound } from '../../services/ui-sound.js';
import { useApiCredentials } from './use-api-credentials.js';
import { credentialItems } from './credential-view.js';
import { CredentialMap } from './CredentialMap.jsx';
import { ChannelKeysSection } from './ChannelKeysSection.jsx';
import { EmailSection } from './EmailSection.jsx';
import { WebSection } from './WebSection.jsx';
import { VisionSection } from './VisionSection.jsx';
import { ServiceKeysSection } from './ServiceKeysSection.jsx';
import { revealCard } from './waiting/waiting-jump.js';

// pure — the platform and account a deep link names, or null.
const accountFocus = (focus) => {
  const [section, channelId, accountId] = String(focus ?? '').split('/');
  return section === 'channel-keys' && channelId ? { channelId, accountId: accountId || null } : null;
};

export const ApiTab = ({ focus = null }) => {
  const board = useApiCredentials();
  const [stateFilter, setStateFilter] = useState('');
  const [openKey, setOpenKey] = useState(null);
  const onOpen = (key) => { uiSound(key ? 'open' : 'close'); setOpenKey(key); };
  const onState = (s) => { uiSound('open'); setStateFilter(s); };
  // A tile opens its row even when the filter would hide it: the filter steps aside.
  const openFromMap = (key) => {
    const item = credentialItems(board).find((i) => i.key === key);
    if (stateFilter && item?.state !== stateFilter) setStateFilter('');
    onOpen(key);
  };
  const shared = { stateFilter, openKey, onOpen };
  useEffect(() => {
    const to = accountFocus(focus);
    if (!to) return;
    setStateFilter('');
    setOpenKey(`channel:${to.channelId}`);
    if (to.accountId) revealCard(`.account-row[data-account="${to.accountId.replace(/["\\]/g, '')}"]`);
  }, [focus]);

  return (
    <>
      <CredentialMap items={credentialItems(board)} stateFilter={stateFilter} onState={onState} onOpen={openFromMap} />
      <ChannelKeysSection channels={board.channels} tests={board.tests} error={board.errors.channels}
        onChanged={board.refreshChannels} onRetest={board.retestChannels} {...shared} />
      <EmailSection account={board.email} error={board.errors.email} onChanged={board.refreshEmail} {...shared} />
      {stateFilter ? null : <WebSection />}
      {stateFilter ? null : <VisionSection />}
      <ServiceKeysSection services={board.services} error={board.errors.services}
        onChanged={board.refreshServices} {...shared} />
    </>
  );
};
