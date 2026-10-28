// Two chat windows, each the production composer under the production
// providers, each with a line of a being's prose — DEFINE's ASK IN CHAT must
// draft into the window the word was read in, and never send.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { StreamInput } from '../../frontend/app/RelinkShell/StreamInput.jsx';
import { ConsciousnessProvider } from '../../frontend/app/RelinkShell/consciousness-context.js';
import { ProjectContext } from '../../frontend/app/RelinkShell/projects/project-context.js';
import { WindowManager } from '../../frontend/app/windowing/WindowManager.jsx';

const Chat = ({ id, prose }) => {
  const [sent, setSent] = useState('');
  return (
    <section data-window-id={id} style={{ width: 480, padding: 12 }}>
      <p className="prose">{prose}</p>
      <StreamInput connected neumaId={`being-${id}`} draftScope={id} onSend={(text) => setSent(text)} />
      <output className="sent">{sent}</output>
    </section>
  );
};

createRoot(document.getElementById('root')).render(
  <ConsciousnessProvider value={{}}>
    <ProjectContext.Provider value={{ projects: [] }}>
      <WindowManager registry={{}}>
        <div style={{ display: 'flex', gap: 24 }}>
          <Chat id="w1" prose="The first window speaks of something else entirely." />
          <Chat id="w2" prose="That's where it lives. And that's not a pedantic point — it's the whole thing! Next." />
        </div>
      </WindowManager>
    </ProjectContext.Provider>
  </ConsciousnessProvider>,
);
