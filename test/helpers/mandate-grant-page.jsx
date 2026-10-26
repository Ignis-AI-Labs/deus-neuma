// impure - browser fixture: the PRODUCTION mandate surfaces — the MARKETING
// window's MandatePanel (with its grant screen) and the tray's mandate mark
// beside the bell — against the real routes, with the desk's one WAITING ON
// YOU account read from the real /api/v1/waiting.
/* global window, sessionStorage, localStorage, document */
import '../../frontend/styles/main.css';
import '../../frontend/app/RelinkShell/SettingsApp.css';
import '../../frontend/app/RelinkShell/NotificationTray/NotificationTray.css';
import { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { getWaiting } from '../../frontend/services/waiting-client.js';
import { WaitingContext } from '../../frontend/app/RelinkShell/waiting/use-waiting.js';
import { MandatePanel } from '../../frontend/app/RelinkShell/mandate/MandatePanel.jsx';
import { MandateMark } from '../../frontend/app/RelinkShell/NotificationTray/TrayWaiting.jsx';
import { bellMandate } from '../../frontend/app/RelinkShell/mandate/mandate-view.js';

const Page = () => {
  const [account, setAccount] = useState(null);
  const refresh = useCallback(() => getWaiting().then(setAccount).catch(() => {}), []);
  useEffect(() => { refresh(); }, [refresh]);
  window.mandateFixture = { refresh };
  return (
    <WaitingContext.Provider value={{ account, refresh }}>
      <div className="ntray-bell-row" data-tray><MandateMark mandate={bellMandate(account?.mandate, Date.now())} /></div>
      <div className="settings" style={{ padding: 16 }}><MandatePanel /></div>
    </WaitingContext.Provider>
  );
};

sessionStorage.setItem('authToken', window.mandateFixtureSeed.token);
localStorage.setItem('walletAddress', window.mandateFixtureSeed.wallet);
createRoot(document.getElementById('root')).render(<Page />);
