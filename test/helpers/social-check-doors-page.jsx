// impure - browser fixture: the PRODUCTION SOCIAL CHECK inside the production
// WindowManager, and every window its doors open drawn by its production
// body — SETTINGS, MARKETING (the office, every public platform its account level) — plus the
// stream window a hand-over opens, as its composer's draft: the composer's
// own draft hook (use-stream-draft.js, what StreamInput's text field holds)
// seated on the tab the window's own payload decodes to (the same
// decodeStreamTransfer + initialStreamTabs the stream window runs), so the
// text it shows is the text the desk's composer would. Against the real
// routes (marketing-office-kit.js).
/* global window, sessionStorage, localStorage, document */
import '../../frontend/i18n/index.js';
import '../../frontend/styles/main.css';
import '../../frontend/app/RelinkShell/SettingsApp.css';
import '../../frontend/app/RelinkShell/SettingsApp-look.css';
import '../../frontend/app/RelinkShell/SettingsApp-sections.css';
import '../../frontend/app/RelinkShell/OutreachApps.css';
import '../../frontend/app/RelinkShell/OutreachApps-card.css';
import '../../frontend/app/RelinkShell/waiting/Waiting.css';
import { createRoot } from 'react-dom/client';
import { WindowManager } from '../../frontend/app/windowing/WindowManager.jsx';
import { useWindows } from '../../frontend/app/windowing/use-windows.js';
import { WaitingContext } from '../../frontend/app/RelinkShell/waiting/use-waiting.js';
import { SocialCheckApp } from '../../frontend/app/RelinkShell/social-check/SocialCheckApp.jsx';
import { settingsApp } from '../../frontend/app/RelinkShell/SettingsApp.jsx';
import { MarketingOffice } from '../../frontend/app/RelinkShell/marketing/MarketingOffice.jsx';
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
};

const Windows = () => {
  const windows = useWindows();
  window.deskWindows = () => windows.state.windows.map((w) => w.id);
  return windows.state.windows.map((w) => {
    const Body = BODY[w.id];
    if (Body) return <section key={w.id} className="fwin" data-window-id={w.id}><Body /></section>;
    if (w.id.startsWith('chat#') && w.payload) return <section key={w.id} className="fwin" data-window-id={w.id}><Composer windowId={w.id} payload={w.payload} /></section>;
    return null;
  });
};

const REGISTRY = { settings: {}, marketing: {}, chat: { multiInstance: true } };

sessionStorage.setItem('authToken', window.doorsFixture.token);
localStorage.setItem('walletAddress', window.doorsFixture.wallet);
createRoot(document.getElementById('root')).render(
  <WaitingContext.Provider value={{ account: null }}>
    <WindowManager registry={REGISTRY} defaultOpen={[]}>
      <section id="check" className="outreach-panel settings" style={{ padding: 16 }}><SocialCheckApp /></section>
      <Windows />
    </WindowManager>
  </WaitingContext.Provider>,
);
