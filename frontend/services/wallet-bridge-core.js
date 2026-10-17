// Wallet bridge CORE (WEB-001 / #126) — DOM-light, no UI/CSS imports, so it
// unit-tests without a browser environment. The UI-coupled runWalletBridge (which
// pulls the wallet picker) lives in wallet-bridge.js and re-exports from here.

/** True when running inside the Electron shell (no injected extensions there). */
export const isElectron = () => typeof window !== 'undefined' && !!window.neuma;

/** The bridge code from the URL, or null if this isn't a bridge hand-off tab. */
export const getBridgeCode = () => {
  try {
    return new URLSearchParams(window.location.search).get('bridge');
  } catch {
    return null;
  }
};

const BRIDGE_POLL_INTERVAL_MS = 2000;
const BRIDGE_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * ELECTRON side of the bridge: start a session, open the system browser to the
 * connect page (where the user's Rabby/MetaMask lives), and poll with the
 * pollSecret until the browser hands a token back. Returns the token + address
 * WITHOUT committing them — the caller confirms the address, then calls
 * applyBridgeSession() to commit. (Confirming first defeats any
 * associate-injection: a mismatched address is rejected before it becomes the
 * session.)
 *
 * Every effect is injectable so it unit-tests without a real browser.
 * @param {{ open?: (url:string)=>void, onStatus?: (s:string)=>void, fetchImpl?: typeof fetch, sleep?: (ms:number)=>Promise<void>, deadlineMs?: number }} [opts]
 * @returns {Promise<{ token: string, address: string }>}
 */
// impure — network IO; opens the user's system browser.
export const connectViaBrowserBridge = async ({
  open = (url) => {
    // Prefer the explicit Electron IPC (opens the system browser where the
    // extension wallet lives); fall back to window.open in a plain browser.
    if (typeof window !== 'undefined' && window.neuma && typeof window.neuma.openExternal === 'function') {
      window.neuma.openExternal(url);
    } else {
      window.open(url, '_blank', 'noopener');
    }
  },
  onStatus = () => {},
  fetchImpl = (...a) => fetch(...a),
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  deadlineMs = BRIDGE_TIMEOUT_MS,
} = {}) => {
  onStatus('starting');
  const startRes = await fetchImpl('/api/v1/auth/bridge/start', { method: 'POST' });
  if (!startRes.ok) throw new Error('Could not start the wallet bridge');
  const { browserCode, pollSecret } = await startRes.json();

  onStatus('opening-browser');
  // window.location.origin IS the backend's http origin here: the Electron
  // renderer is loaded via loadURL(http://127.0.0.1:PORT) and the web launch is
  // served by the backend too, so the system browser reaches the same /api.
  open(`${window.location.origin}/?bridge=${encodeURIComponent(browserCode)}`);

  const started = Date.now();
  onStatus('waiting');
  for (;;) {
    if (Date.now() - started > deadlineMs) throw new Error('Wallet connection timed out');
    await sleep(BRIDGE_POLL_INTERVAL_MS);
    const res = await fetchImpl(`/api/v1/auth/bridge/poll?code=${encodeURIComponent(browserCode)}`, {
      headers: { 'x-bridge-secret': pollSecret },
    });
    if (res.status === 404 || res.status === 410) throw new Error('Wallet connection expired — try again');
    if (!res.ok) continue; // transient — keep trying within the deadline
    const data = await res.json();
    if (data.pending) continue;
    if (data.token && data.address) {
      onStatus('connected');
      return { token: data.token, address: data.address };
    }
  }
};

/**
 * Commit a bridged session like a normal sign-in. Call AFTER the user has
 * confirmed the address returned by connectViaBrowserBridge().
 * @param {{ token: string, address: string }} session
 */
// impure — writes the session token + connection state to web storage.
export const applyBridgeSession = ({ token, address }) => {
  sessionStorage.setItem('authToken', token);
  localStorage.setItem('walletConnected', 'true');
  localStorage.setItem('walletAddress', address);
};
