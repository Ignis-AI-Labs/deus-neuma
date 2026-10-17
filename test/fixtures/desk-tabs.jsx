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
import { ProjectContext } from '../../frontend/app/RelinkShell/projects/project-context.js';
import { useProjectsState } from '../../frontend/app/RelinkShell/projects/use-projects.js';
import '../../frontend/styles/tokens.css';
const service = new WebSocketService({ quiet: true });
const Page = () => {
  const council = useCouncilStream(service);
  const projects = useProjectsState();
  useEffect(() => { service.connect(); return () => service.disconnect(); }, []);
  return <ProjectContext.Provider value={projects}>
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
  </ProjectContext.Provider>;
};
createRoot(document.getElementById('root')).render(<Page />);
