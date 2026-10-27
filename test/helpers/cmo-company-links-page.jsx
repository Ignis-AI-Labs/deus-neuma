// impure - browser fixture: the PRODUCTION SITE & CODE panel (CompanySources,
// as the kit editor mounts it) inside the production WindowManager, under the
// desk's real WAITING ON YOU account (useWaiting, polling the real route), and
// the stream window a hand-over opens drawn as its composer's draft: the
// composer's own draft hook (use-stream-draft.js) seated on the tab the
// window's payload decodes to — the text the desk's composer would hold.
/* global window, sessionStorage, localStorage, document */
import '../../frontend/styles/main.css';
import '../../frontend/app/RelinkShell/brandkits/BrandKits.css';
import '../../frontend/app/RelinkShell/brandkits/BrandKits-fields.css';
import { createRoot } from 'react-dom/client';
import { WindowManager } from '../../frontend/app/windowing/WindowManager.jsx';
import { useWindows } from '../../frontend/app/windowing/use-windows.js';
import { WaitingContext, useWaiting } from '../../frontend/app/RelinkShell/waiting/use-waiting.js';
import { CompanySources } from '../../frontend/app/RelinkShell/brandkits/CompanySources.jsx';
import { useStreamDraft } from '../../frontend/app/RelinkShell/use-stream-draft.js';
import { decodeStreamTransfer } from '../../frontend/app/RelinkShell/stream-tab-transfer.js';
import { initialStreamTabs } from '../../frontend/app/RelinkShell/initial-stream-tabs.js';

const Composer = ({ windowId, payload }) => {
  const tabs = initialStreamTabs(null, decodeStreamTransfer(payload), 'unminted');
  const tab = tabs.tabs.find((t) => t.id === tabs.focusedId);
  const { value } = useStreamDraft({ wsService: null, neumaId: tab.neumaId, draftScope: tab.id });
  return <div data-composer={windowId} data-neuma={tab.neumaId}><textarea aria-label={`message ${tab.name}`} value={value} readOnly /></div>;
};

const Windows = () => {
  const windows = useWindows();
  window.deskWindows = () => windows.state.windows.map((w) => w.id);
  return windows.state.windows.map((w) => (w.id.startsWith('chat#') && w.payload
    ? <section key={w.id} className="fwin" data-window-id={w.id}><Composer windowId={w.id} payload={w.payload} /></section>
    : null));
};

const { token, wallet, companyId, roster } = window.linksFixture;

const Desk = () => {
  const waiting = useWaiting(null);
  window.waitingCount = () => waiting.account?.items?.filter((i) => i.kind === 'link-change').length ?? null;
  return (
    <WaitingContext.Provider value={waiting}>
      <WindowManager registry={{ chat: { multiInstance: true } }} defaultOpen={[]}>
        <div ref={waiting.watch} className="bk" style={{ padding: 16 }}>
          <main className="bk-editor"><CompanySources companyId={companyId} roster={roster} /></main>
        </div>
        <Windows />
      </WindowManager>
    </WaitingContext.Provider>
  );
};

sessionStorage.setItem('authToken', token);
localStorage.setItem('walletAddress', wallet);
createRoot(document.getElementById('root')).render(<Desk />);
