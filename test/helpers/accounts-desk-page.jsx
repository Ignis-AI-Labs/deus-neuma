// impure - browser fixture: the PRODUCTION Settings → API channel keys (the
// app once, the accounts list), a platform window's account strip and the
// queue's account chips, with the desk's own i18n and styles, against the
// real routes (board, accounts, connect, companies).
/* global window, sessionStorage, document */
import '../../frontend/i18n/index.js';
import '../../frontend/styles/main.css';
import '../../frontend/app/RelinkShell/SettingsApp.css';
import '../../frontend/app/RelinkShell/SettingsApp-look.css';
import '../../frontend/app/RelinkShell/SettingsApp-sections.css';
import { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { getChannelBoard } from '../../frontend/services/social-channels-client.js';
import { ChannelKeysSection } from '../../frontend/app/RelinkShell/ChannelKeysSection.jsx';
import { AccountStrip } from '../../frontend/app/RelinkShell/accounts/AccountStrip.jsx';
import { AccountChip } from '../../frontend/app/RelinkShell/accounts/AccountChip.jsx';

const { token, open, roster, entries } = window.accountsFixture;

const Page = () => {
  const [channels, setChannels] = useState(null);
  const [openKey, setOpenKey] = useState(null);
  const [companyId, setCompanyId] = useState('');
  const refresh = useCallback(() => getChannelBoard().then((r) => {
    setChannels(r.channels);
    setOpenKey((k) => k ?? `channel:${open}`);
  }), []);
  useEffect(() => { refresh(); }, [refresh]);
  return (
    <div className="settings" style={{ padding: 16 }}>
      <section id="strip"><AccountStrip channelId={open} companyId={companyId} onCompany={setCompanyId} roster={roster} /></section>
      <section id="chips">{entries.map((e) => <div key={e.id} data-entry={e.id}><AccountChip entry={e} /></div>)}</section>
      <section id="keys">
        <ChannelKeysSection channels={channels} tests={{}} error={null} onChanged={refresh} onRetest={() => {}}
          stateFilter="" openKey={openKey} onOpen={setOpenKey} />
      </section>
    </div>
  );
};

sessionStorage.setItem('authToken', token);
createRoot(document.getElementById('root')).render(<Page />);
