// impure - browser fixture: the PRODUCTION holders and image-engine panels with
// their real stylesheets, drawn from a map read off this machine by the real
// reader and a lens built by the real parsers (the test hands both in).
/* global window, document */
import '../../frontend/styles/main.css';
import '../../frontend/app/RelinkShell/SubstrateApp.css';
import '../../frontend/app/RelinkShell/SubstrateApp-legible.css';
import '../../frontend/app/RelinkShell/SecurityApp.css';
import { createRoot } from 'react-dom/client';
import { EngineView, HoldersView } from '../../frontend/app/RelinkShell/HoldersPanels.jsx';

const { map, lens } = window.holdersFixture;
createRoot(document.getElementById('root')).render(
  <div className="sub-body" style={{ width: 1400, background: 'var(--color-surface)', padding: 12 }}>
    <div className="sub-grid">
      <HoldersView map={map} />
      <EngineView lens={lens} act={() => { window.acted = (window.acted || 0) + 1; }} acting={null} said="" />
    </div>
  </div>,
);
