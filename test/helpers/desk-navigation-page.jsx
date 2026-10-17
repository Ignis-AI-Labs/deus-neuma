// impure - browser fixture mounts production hooks/hosts, never a fake portal.
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { WebSocketService } from '../../frontend/services/WebSocketService.js';
import { useConsciousnessStream } from '../../frontend/app/RelinkShell/use-consciousness-stream.js';
import { ConsciousnessProvider, useConsciousness } from '../../frontend/app/RelinkShell/consciousness-context.js';
import { StreamWindowHost } from '../../frontend/app/RelinkShell/StreamWindowHost.jsx';
import { TabPortalHost } from '../../frontend/app/RelinkShell/TabPortalHost.jsx';
import { StreamTabs } from '../../frontend/app/RelinkShell/StreamTabs.jsx';
import { FocusContext } from '../../frontend/app/RelinkShell/use-desk-focus.js';
import { useTabs } from '../../frontend/app/RelinkShell/tabs-context.js';
import { sittingGround } from '../../frontend/app/RelinkShell/desk-focus.js';
import { loadTabs } from '../../frontend/app/windowing/window-storage.js';
import { WindowManager } from '../../frontend/app/windowing/WindowManager.jsx';
import { useWindows } from '../../frontend/app/windowing/use-windows.js';

const config = window.deskFixture;
const fallback = { kind: 'folder', path: config.folderB };

const Inspect = () => {
  const stream = useConsciousness();
  const tabs = useTabs();
  useEffect(() => {
    window.desk = { stream, tabs, persisted: () => loadTabs('chat#2') };
  });
  return <>
    <button onClick={() => stream.sendThought('fresh wire thought')}>Send</button>
    <button onClick={() => stream.newSession()}>New</button>
    <pre id="transcript">{JSON.stringify(stream.state)}</pre>
    <pre id="tabs">{JSON.stringify(tabs?.state ?? null)}</pre>
    <output id="explorer-ground">{sittingGround(tabs?.focusedGround, fallback)?.path}</output>
  </>;
};

const Navigation = () => {
  const [ws] = useState(() => new WebSocketService({ quiet: true }));
  const stream = useConsciousnessStream(ws, { focus: fallback, house: false });
  useEffect(() => { ws.connect(); return () => ws.disconnect(); }, [ws]);
  return <ConsciousnessProvider value={stream}><Inspect /></ConsciousnessProvider>;
};

const TransferWindow = () => {
  const windows = useWindows();
  useEffect(() => {
    if (!windows.state.windows.some((w) => w.id === 'chat#2')) {
      windows.dispatch({ type: 'OPEN_NEW', appId: 'chat', payload: config.payload });
    }
  }, []);
  const transfer = windows.state.windows.find((w) => w.id === 'chat#2');
  return transfer ? <StreamWindowHost windowId="chat#2" instance={2} payload={transfer.payload}>
    <TabPortalHost><StreamTabs /><Inspect /></TabPortalHost>
  </StreamWindowHost> : null;
};

const root = createRoot(document.getElementById('root'));
window.unmountDesk = () => root.unmount();
root.render(config.payload
  ? <FocusContext.Provider value={{ windowFocus: fallback, focus: fallback }}>
    <WindowManager registry={{ chat: { multiInstance: true } }} defaultOpen={['chat']}><TransferWindow /></WindowManager>
  </FocusContext.Provider>
  : <Navigation />);
