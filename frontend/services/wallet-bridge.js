// Wallet bridge (WEB-001 / #126) — the BROWSER side of the Electron
// system-browser handoff. When the desktop app needs a wallet that only lives in
// this real browser (a Rabby/MetaMask extension Electron can't see), it opens us
// at /?bridge=<browserCode>. We run the normal connect + authenticate, then
// ASSOCIATE the minted token with the bridge session so Electron can retrieve it
// (gated on a pollSecret we never see). The token is never placed in a URL.
//
// DOM-light helpers (getBridgeCode / isElectron / connectViaBrowserBridge /
// applyBridgeSession) live in wallet-bridge-core.js and are re-exported here.
import './wallet-bridge.css';
import { requireWallet, getWalletService } from './WalletGate.js';
import { formatAddress } from '../utils/format.js';

export { isElectron, getBridgeCode, connectViaBrowserBridge, applyBridgeSession } from './wallet-bridge-core.js';

// impure — replaces the page with a single centered status card. Builds the DOM
// programmatically so dynamic values (e.g. the address) are set via textContent,
// never interpolated into innerHTML (Rule 8).
const screen = ({ title, lines = [], code = null }) => {
  const root = document.getElementById('app') || document.body;
  root.replaceChildren();

  const card = document.createElement('div');
  card.className = 'bridge-card';

  const heading = document.createElement('h1');
  heading.textContent = title;
  card.appendChild(heading);

  if (code) {
    const p = document.createElement('p');
    p.className = 'bridge-sub';
    const el = document.createElement('code');
    el.textContent = code.text;
    p.append(`${code.label} `, el);
    card.appendChild(p);
  }

  for (const line of lines) {
    const p = document.createElement('p');
    p.className = 'bridge-sub';
    p.textContent = line;
    card.appendChild(p);
  }

  const wrap = document.createElement('div');
  wrap.className = 'bridge-screen';
  wrap.appendChild(card);
  root.appendChild(wrap);
};

/**
 * Run the browser side of the bridge: connect a wallet, authenticate, hand the
 * token to the bridge session. Renders its own minimal UI — does NOT boot the
 * full app. Returns the connected address, or null if it didn't complete.
 * impure — DOM, network IO, and wallet/session state.
 * @param {string} browserCode
 * @returns {Promise<string|null>}
 */
export const runWalletBridge = async (browserCode) => {
  screen({ title: 'Connect your wallet', lines: ['Sign in with your browser wallet to bring it back to NEUMA.'] });

  const address = await requireWallet('NEUMA wants to use your browser wallet. Connect and sign to continue on the desktop app.');
  if (!address) {
    screen({ title: 'Cancelled', lines: ['No wallet connected. You can close this tab and try again in NEUMA.'] });
    return null;
  }

  const token = getWalletService().getAuthToken();
  if (!token) {
    screen({ title: 'Sign-in incomplete', lines: ['Could not finish authentication. Close this tab and try again.'] });
    return null;
  }

  try {
    const res = await fetch('/api/v1/auth/bridge/associate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ browserCode, token }),
    });
    if (!res.ok) throw new Error(`associate ${res.status}`);
  } catch {
    screen({ title: 'Handoff failed', lines: ['Signed in, but could not return the session to NEUMA. The link may have expired — try again from the app.'] });
    return null;
  }

  const short = formatAddress(address);
  screen({
    title: 'Signed in',
    code: { label: 'Connected as', text: short },
    lines: ['Return to NEUMA — you can close this tab.'],
  });
  return address;
};
