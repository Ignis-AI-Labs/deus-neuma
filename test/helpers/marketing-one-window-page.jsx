// impure - browser fixture for MARKETING slice 6 (one window): the PRODUCTION
// desk pieces the old windows are reached from — the production registry's
// outreach entries (OutreachApps.jsx: MARKETING, and COMMUNITY's TELEGRAM and
// DISCORD), the production WindowManager (the redirect of every retired id and
// the saved-layout fold), its taskbar and launcher (Dock), and the waiting
// jumper — each open window drawn by its production Body. Against the real
// routes (marketing-office-kit.js). A saved layout handed in by the test is
// written through the desk's own store before the desk mounts.
/* global window, sessionStorage, localStorage, document */
import '../../frontend/i18n/index.js';
import '../../frontend/styles/main.css';
import '../../frontend/app/RelinkShell/SettingsApp.css';
import '../../frontend/app/RelinkShell/SettingsApp-look.css';
import '../../frontend/app/RelinkShell/SettingsApp-sections.css';
import '../../frontend/app/RelinkShell/waiting/Waiting.css';
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { WindowManager } from '../../frontend/app/windowing/WindowManager.jsx';
import { useWindows } from '../../frontend/app/windowing/use-windows.js';
import { saveDesk } from '../../frontend/app/windowing/window-storage.js';
import { Dock } from '../../frontend/app/windowing/Dock.jsx';
import { outreachApps } from '../../frontend/app/RelinkShell/OutreachApps.jsx';
import { getWaiting } from '../../frontend/services/waiting-client.js';
import { WaitingContext } from '../../frontend/app/RelinkShell/waiting/use-waiting.js';
import { ConsciousnessProvider } from '../../frontend/app/RelinkShell/consciousness-context.js';
import { WaitingJumps } from '../../frontend/app/RelinkShell/waiting/WaitingJumps.jsx';
import { requestWaitingJump } from '../../frontend/app/RelinkShell/waiting/waiting-jump.js';
import { openDoor } from '../../frontend/app/RelinkShell/doors/open-door.js';
import { doorPlan } from '../../frontend/app/RelinkShell/doors/door-plan.js';

const REGISTRY = { ...outreachApps };

const Windows = () => {
  const windows = useWindows();
  // The test's hands: what is open, an OPEN by id (a palette command, a card, a saved pin), a door, a waiting jump.
  window.desk = {
    windows: () => windows.state.windows.map((w) => w.id),
    open: (id) => windows.dispatch({ type: 'OPEN', id }),
    door: (door) => openDoor(door, windows),
    jump: (where) => requestWaitingJump({ where }),
    queueJump: (door) => requestWaitingJump(doorPlan(door).jump),
  };
  return windows.state.windows.map((w) => {
    const app = REGISTRY[w.id];
    if (!app) return <section key={w.id} className="fwin is-blank" data-window-id={w.id} />;
    return <section key={w.id} className="fwin" data-window-id={w.id}><app.Body /></section>;
  });
};

const Desk = () => {
  const [account, setAccount] = useState(null);
  const refresh = () => getWaiting().then(setAccount).catch(() => {});
  useEffect(() => { refresh(); }, []);
  return (
    <ConsciousnessProvider value={{ activeCompanion: { name: 'Halden' } }}>
      <WaitingContext.Provider value={{ account, refresh }}>
        <WindowManager registry={REGISTRY} defaultOpen={[]}>
          <WaitingJumps />
          <div id="desk"><Windows /></div>
          <Dock />
        </WindowManager>
      </WaitingContext.Provider>
    </ConsciousnessProvider>
  );
};

sessionStorage.setItem('authToken', window.oneWindowFixture.token);
localStorage.setItem('walletAddress', window.oneWindowFixture.wallet);
if (window.oneWindowFixture.saved) saveDesk(window.oneWindowFixture.saved);
createRoot(document.getElementById('root')).render(<Desk />);
