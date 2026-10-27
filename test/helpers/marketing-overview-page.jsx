// impure - browser fixture: the PRODUCTION MARKETING window (its title and its
// body: the office zoomed down the company tree, the overview, the campaign
// page, SEAT) — or one post's card, or one platform's window — with the
// desk's i18n and styles, and the desk's one WAITING ON YOU account read from
// the real /api/v1/waiting — against the real routes.
// The chat's focus is a real ConsciousnessProvider the page can switch, so a
// test proves the title never follows it.
/* global window, sessionStorage, localStorage, document */
import '../../frontend/i18n/index.js';
import '../../frontend/styles/main.css';
import '../../frontend/app/RelinkShell/SettingsApp.css';
import '../../frontend/app/RelinkShell/SettingsApp-look.css';
import '../../frontend/app/RelinkShell/SettingsApp-sections.css';
import '../../frontend/app/RelinkShell/OutreachApps.css';
import '../../frontend/app/RelinkShell/OutreachApps-card.css';
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { getWaiting } from '../../frontend/services/waiting-client.js';
import { WaitingContext } from '../../frontend/app/RelinkShell/waiting/use-waiting.js';
import { ConsciousnessProvider } from '../../frontend/app/RelinkShell/consciousness-context.js';
import { MarketingOffice } from '../../frontend/app/RelinkShell/marketing/MarketingOffice.jsx';
import { MarketingTitle } from '../../frontend/app/RelinkShell/marketing/MarketingTitle.jsx';
import { requestCardLanding } from '../../frontend/app/RelinkShell/card-landing.js';
import { announceBoardArrangement } from '../../frontend/app/RelinkShell/marketing/board-change.js';
import { QueueEntry } from '../../frontend/app/RelinkShell/QueueEntry.jsx';
import { PlatformSpace } from '../../frontend/app/RelinkShell/PlatformSpace.jsx';
import { WindowManager } from '../../frontend/app/windowing/WindowManager.jsx';
import { getChannelBoard, getPostQueue } from '../../frontend/services/social-channels-client.js';

// One queue card as a platform window shows it (the group's decision lives on it), with the channel board it reads.
const OneCard = ({ entryId }) => {
  const [queue, setQueue] = useState(null);
  const [channels, setChannels] = useState(null);
  const read = () => getPostQueue().then((r) => setQueue(r.queue));
  useEffect(() => { read(); getChannelBoard().then((b) => setChannels(b.channels)); }, []);
  const entry = queue?.find((e) => e.id === entryId);
  if (!entry || !channels) return <p>reading…</p>;
  return (
    <QueueEntry entry={entry} byId={new Map(queue.map((e) => [e.id, e]))} roster={[]} channels={channels} campaigns={[]}
      onChanged={read} onRevise={() => {}} onEdit={() => {}} onNotice={() => {}} folded={false} startOpen now={Date.now()} />
  );
};

const FOCUS = ['Halden', 'Marrow'];

const Page = () => {
  const [account, setAccount] = useState(null);
  const [focus, setFocus] = useState(0);
  // The desk's account and its refresh, as the desk hands them down (use-waiting.js).
  const refresh = () => getWaiting().then(setAccount).catch(() => {});
  useEffect(() => { refresh(); }, []);
  // The test's hands: switch the chat's focus, fire a card landing as the tray does, and hand the page
  // a settled act's chip as the chat stream does (stream-message-handlers.js).
  window.marketingFixture = {
    focus: () => setFocus((n) => (n + 1) % FOCUS.length), land: (item) => requestCardLanding('marketing', item),
    actFrame: (frame) => announceBoardArrangement(frame),
  };
  return (
    <ConsciousnessProvider value={{ activeCompanion: { name: FOCUS[focus] } }}>
      <WaitingContext.Provider value={{ account, refresh }}>
        <div className="fwin-title" data-title><MarketingTitle /></div>
        <div className="outreach-panel settings" style={{ padding: 16 }}>
          {window.overviewFixture.card ? <OneCard entryId={window.overviewFixture.card} />
            : window.overviewFixture.platform
              ? <WindowManager registry={{}}><PlatformSpace channelId={window.overviewFixture.platform} /></WindowManager>
              : <MarketingOffice />}
        </div>
      </WaitingContext.Provider>
    </ConsciousnessProvider>
  );
};

sessionStorage.setItem('authToken', window.overviewFixture.token);
localStorage.setItem('walletAddress', window.overviewFixture.wallet);
if (window.overviewFixture.landing) requestCardLanding('marketing', window.overviewFixture.landing);
createRoot(document.getElementById('root')).render(<Page />);
