// Render-only host for the CONNECTIONS panel: the real section with the app's own styles and
// catalogs, as the Settings window's Security tab mounts it.
import '../../frontend/i18n/index.js';
import '../../frontend/styles/tokens.css';
import '../../frontend/styles/main.css';
import '../../frontend/app/RelinkShell/SettingsApp.css';
import { createRoot } from 'react-dom/client';
import { ConnectionsSection } from '../../frontend/app/RelinkShell/ConnectionsSection.jsx';

const host = document.createElement('main');
host.style.padding = '24px';
host.style.maxWidth = '760px';
document.body.append(host);
createRoot(host).render(<ConnectionsSection />);
