// Main entry — the React shell over the kept vanilla ceremony.
import './styles/main.css';
import { createRoot } from 'react-dom/client';
import { installErrorBoundary } from './utils/error-boundary.js';
import { WebSocketService } from './services/WebSocketService.js';
import { AppShell } from './app/AppShell.jsx';
import { getBridgeCode, runWalletBridge } from './services/wallet-bridge.js';
import { bootPlaysAtStart } from './app/app-state.js';
import { genesisDue } from './app/Genesis/genesis-gate.js';
import { bootLook } from './services/look.js';
import { bootTextSize } from './services/text-size.js';
// The language engine initializes before anything renders so the first paint
// already speaks the operator's language (frontend/i18n/index.js).
import './i18n/index.js';

// Global on-screen error surfacing before anything mounts — an uncaught
// async error renders as a visible card, never a blank screen.
installErrorBoundary();

// The witness's dress paints before anything renders — the mirrored look
// applies synchronously; the canonical store corrects it once authed.
bootLook();
bootTextSize();

// The first-paint veil (index.html) is the void the startup begins from. When
// no startup plays this session — the wallet bridge, reduced motion, e2e
// flags — lift it at once; when one plays, the ignition (or GENESIS) lifts it
// at its first frame. (The veil's 6s CSS self-lift stays as the failsafe.)
const liftVeil = () => document.getElementById('first-paint-veil')?.remove();

// System-browser wallet bridge (WEB-001): a /?bridge=<code> tab is a dedicated
// connect-and-hand-back surface for the Electron app — it must NOT boot the full
// app (no portal, no WS), only run the wallet connect + associate the token.
const bridgeCode = getBridgeCode();
if (bridgeCode) {
  liftVeil(); // a utility tab gets no theater
  runWalletBridge(bridgeCode);
} else {
  if (!bootPlaysAtStart() && !genesisDue()) liftVeil();
  // One portal link for the app's lifetime, shared by ceremony and relink.
  const wsService = new WebSocketService();
  createRoot(document.getElementById('app')).render(<AppShell wsService={wsService} />);
}
