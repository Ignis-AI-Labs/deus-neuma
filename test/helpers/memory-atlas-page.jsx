// impure - browser fixture: the PRODUCTION memory view (MemoryAtlas, its own
// reads and stylesheets) inside the CONTEXT MAP's pane, pointed at the being
// the test names. Everything it shows comes over the real REST routes.
/* global window, document */
import '../../frontend/styles/main.css';
import '../../frontend/app/RelinkShell/ContextMapApp.css';
import { createRoot } from 'react-dom/client';
import { ConsciousnessProvider } from '../../frontend/app/RelinkShell/consciousness-context.js';
import { MemoryAtlas } from '../../frontend/app/RelinkShell/memory-atlas/MemoryAtlas.jsx';

const { neumaId, width, height } = window.atlasFixture;
createRoot(document.getElementById('root')).render(
  <ConsciousnessProvider value={{ activeCompanion: { name: 'Atlas', neumaId } }}>
    <div className="ctx" style={{ width, height, background: 'var(--color-surface)' }}>
      <div className="ctx-scroll is-memory"><MemoryAtlas /></div>
    </div>
  </ConsciousnessProvider>,
);
