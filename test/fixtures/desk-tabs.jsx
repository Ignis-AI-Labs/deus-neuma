import { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { chatsApp } from '../../frontend/app/RelinkShell/ChatsApp.jsx';
import { contextMapApp } from '../../frontend/app/RelinkShell/ContextMapApp.jsx';
import { mapApp } from '../../frontend/app/RelinkShell/MapApp.jsx';
import { CouncilContext } from '../../frontend/app/RelinkShell/council-context.js';
import { ConsciousnessProvider } from '../../frontend/app/RelinkShell/consciousness-context.js';
import { WindowContext } from '../../frontend/app/windowing/WindowManager.jsx';
import { useCouncilStream } from '../../frontend/app/RelinkShell/use-council-stream.js';
import { WebSocketService } from '../../frontend/services/WebSocketService.js';
import { FocusContext } from '../../frontend/app/RelinkShell/use-desk-focus.js';
import '../../frontend/styles/tokens.css';
const service = new WebSocketService({ quiet: true });
// The folder in focus, handed in by the test (the map indexes it).
const focus = { focus: window.__FOCUS_FOLDER ? { kind: 'folder', path: window.__FOCUS_FOLDER } : null, setFocus: () => {} };
const Page = () => {
  const council = useCouncilStream(service);
  useEffect(() => { service.connect(); return () => service.disconnect(); }, []);
  return <FocusContext.Provider value={focus}>
    <WindowContext.Provider value={{}}>
      <ConsciousnessProvider value={{ state: { messages: [] } }}>
        <CouncilContext.Provider value={council}>
          <section id="chats-a"><chatsApp.Body /></section>
          <section id="chats-b"><chatsApp.Body /></section>
          <section id="context-map"><contextMapApp.Body /></section>
          <section id="map"><mapApp.Body /></section>
        </CouncilContext.Provider>
      </ConsciousnessProvider>
    </WindowContext.Provider>
  </FocusContext.Provider>;
};
createRoot(document.getElementById('root')).render(<Page />);
