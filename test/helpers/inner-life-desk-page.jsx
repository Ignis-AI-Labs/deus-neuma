// impure — production launcher/window/panel over real authenticated routes.
import { createRoot } from 'react-dom/client';
import { ConsciousnessProvider } from '../../frontend/app/RelinkShell/consciousness-context.js';
import { innerLifeApp } from '../../frontend/app/RelinkShell/InnerLifeApp.jsx';
import { WindowManager } from '../../frontend/app/windowing/WindowManager.jsx';
import { WindowLayer } from '../../frontend/app/windowing/WindowLayer.jsx';
import { Dock } from '../../frontend/app/windowing/Dock.jsx';
import '../../frontend/styles/main.css';
// The desk's language, as main.jsx boots it — labels are translated.
import '../../frontend/i18n/index.js';
import '../../frontend/app/RelinkShell/RelinkShell.css';
const binding = { activeCompanion: { neumaId: 'inner-life-proof', name: 'Storage fixture' } };
createRoot(document.getElementById('root')).render(
  <ConsciousnessProvider value={binding}>
    <WindowManager registry={{ innerlife: innerLifeApp }}>
      <WindowLayer /><Dock />
    </WindowManager>
  </ConsciousnessProvider>,
);
