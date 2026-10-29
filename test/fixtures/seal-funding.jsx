// Render-only host for the Ethereum seal's cost-and-funding walkthrough, as the desk's setup gate hosts it.
import '../../frontend/styles/tokens.css';
import '../../frontend/styles/main.css';
import { createRoot } from 'react-dom/client';
import { SealFundingHost } from '../../frontend/app/RelinkShell/SealFundingHost.jsx';

window.sealed = false;
window.skipped = false;
const host = document.createElement('main');
host.style.padding = '24px';
host.style.maxWidth = '620px';
document.body.append(host);
createRoot(host).render(
  <SealFundingHost name="Rowan" funding={null} onSeal={() => { window.sealed = true; }} onSkip={() => { window.skipped = true; }} />,
);
