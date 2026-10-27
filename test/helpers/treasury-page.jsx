// impure - browser fixture: the PRODUCTION TREASURY window body (its SPEND
// cards, flight check, wallets, history) with the desk's own i18n and styles,
// against the real routes, plus the real embedded wallet module so the
// operator's own key can sign through its real consent modal.
/* global window, sessionStorage, document */
import '../../frontend/i18n/index.js';
import '../../frontend/styles/main.css';
import { createRoot } from 'react-dom/client';
import * as embedded from '../../frontend/services/EmbeddedWallet.js';
import { treasuryApp } from '../../frontend/app/RelinkShell/TreasuryApp.jsx';

const { token } = window.treasuryFixture;
window.embedded = embedded;
sessionStorage.setItem('authToken', token);
const Body = treasuryApp.Body;
createRoot(document.getElementById('root')).render(
  <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}><Body /></div>,
);
