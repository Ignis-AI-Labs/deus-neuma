// impure - browser fixture for SDT-2 (doors): the PRODUCTION desk pieces a
// door starts from, inside the production WindowManager — the MARKETING
// window's title (MarketingTitle), the notification tray's WAITING ON YOU
// section (TrayWaiting's WaitingSection, the real /api/v1/waiting account),
// and the window manager's own jumper (WaitingJumps) — and every window a
// door opens drawn by its production body: SETTINGS, MARKETING (the office),
// with every public platform as its account level (slice 6), COMMUNITY's Telegram
// window, and the stream window a chat
// door or a hand-over opens, as its composer's draft (the composer's own
// draft hook on the tab the window's payload decodes to, as in
// social-check-doors-page.jsx). Against the real routes (marketing-office-kit.js).
/* global window, sessionStorage, localStorage, document */
import '../../frontend/i18n/index.js';
import '../../frontend/styles/main.css';
import '../../frontend/app/RelinkShell/SettingsApp.css';
import '../../frontend/app/RelinkShell/SettingsApp-look.css';
import '../../frontend/app/RelinkShell/SettingsApp-sections.css';
import '../../frontend/app/RelinkShell/OutreachApps.css';
import '../../frontend/app/RelinkShell/OutreachApps-card.css';
import '../../frontend/app/RelinkShell/waiting/Waiting.css';
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { WindowManager } from '../../frontend/app/windowing/WindowManager.jsx';
import { useWindows } from '../../frontend/app/windowing/use-windows.js';
import { getWaiting } from '../../frontend/services/waiting-client.js';
import { WaitingContext } from '../../frontend/app/RelinkShell/waiting/use-waiting.js';
import { indicatorLine } from '../../frontend/app/RelinkShell/waiting/waiting-view.js';
import { requestWaitingJump } from '../../frontend/app/RelinkShell/waiting/waiting-jump.js';
import { WaitingJumps } from '../../frontend/app/RelinkShell/waiting/WaitingJumps.jsx';
import { WaitingSection } from '../../frontend/app/RelinkShell/NotificationTray/TrayWaiting.jsx';
import { settingsApp } from '../../frontend/app/RelinkShell/SettingsApp.jsx';
import { MarketingOffice } from '../../frontend/app/RelinkShell/marketing/MarketingOffice.jsx';
import { MarketingTitle } from '../../frontend/app/RelinkShell/marketing/MarketingTitle.jsx';
import { PlatformSpace } from '../../frontend/app/RelinkShell/PlatformSpace.jsx';
import { useStreamDraft } from '../../frontend/app/RelinkShell/use-stream-draft.js';
import { decodeStreamTransfer } from '../../frontend/app/RelinkShell/stream-tab-transfer.js';
import { initialStreamTabs } from '../../frontend/app/RelinkShell/initial-stream-tabs.js';

const Composer = ({ windowId, payload }) => {
  const sitting = decodeStreamTransfer(payload);
  const tabs = initialStreamTabs(null, sitting, 'unminted');
  const tab = tabs.tabs.find((t) => t.id === tabs.focusedId);
  const { value, setValue } = useStreamDraft({ wsService: null, neumaId: tab.neumaId, draftScope: tab.id });
  return (
    <div data-composer={windowId} data-neuma={tab.neumaId} data-session={tab.sessionId || ''}>
      <textarea aria-label={`message ${tab.name}`} value={value} onChange={(e) => setValue(e.target.value)} />
    </div>
  );
};

const BODY = {
  settings: () => <settingsApp.Body />,
  marketing: () => <div className="outreach-panel settings"><MarketingOffice /></div>,
  telegram: () => <PlatformSpace channelId="telegram" />,
};

const Windows = () => {
  const windows = useWindows();
  window.deskWindows = () => windows.state.windows.map((w) => w.id);
  window.deskOpen = (id) => windows.dispatch({ type: 'OPEN', id });
  return windows.state.windows.map((w) => {
    const Body = BODY[w.id];
    if (Body) return <section key={w.id} className="fwin outreach-panel settings" data-window-id={w.id}><Body /></section>;
    if (w.id.startsWith('chat#') && w.payload) return <section key={w.id} className="fwin" data-window-id={w.id}><Composer windowId={w.id} payload={w.payload} /></section>;
    return null;
  });
};

const Tray = ({ account }) => (
  <section id="tray" className="outreach-panel settings">
    {account ? <WaitingSection account={account} line={indicatorLine(account, Date.now())} error={null} now={Date.now()} onJump={requestWaitingJump} /> : null}
  </section>
);

const REGISTRY = { settings: {}, marketing: {}, telegram: {}, chat: { multiInstance: true } };

const Desk = () => {
  const [account, setAccount] = useState(null);
  const read = () => getWaiting().then(setAccount).catch(() => {});
  useEffect(() => { read(); }, []);
  window.rereadWaiting = read;
  return (
    <WaitingContext.Provider value={{ account, refresh: read }}>
      <WindowManager registry={REGISTRY} defaultOpen={[]}>
        <div id="title" className="fwin-bar-title"><MarketingTitle /></div>
        <Tray account={account} />
        <WaitingJumps />
        <Windows />
      </WindowManager>
    </WaitingContext.Provider>
  );
};

sessionStorage.setItem('authToken', window.doorsFixture.token);
localStorage.setItem('walletAddress', window.doorsFixture.wallet);
createRoot(document.getElementById('root')).render(<Desk />);
