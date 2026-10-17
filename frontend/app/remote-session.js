// remote-session.js — a paired phone's way past the gateway.
//
// A phone reaching Neuma through Tailscale Serve carries a device cookie,
// not a wallet. Before the gateway would ask for a signature, the shell
// trades that cookie for an ordinary session token (POST /api/v1/remote/session)
// and stores it exactly where a wallet sign-in would have — so everything
// downstream (the socket, every fetch) is unchanged. On a local surface the
// trade is never attempted: there is no cookie to trade and the server would
// only answer 401.
const LOCAL_HOSTS = Object.freeze(new Set(['localhost', '127.0.0.1', '::1', '[::1]']));
const DEVICE_KEY = 'neuma.remote.device';

/**
 * Is this page served from somewhere other than the machine itself? Pure.
 * @param {unknown} hostname
 * @returns {boolean}
 */
export const isRemoteSurface = (hostname) => !LOCAL_HOSTS.has(String(hostname ?? '').toLowerCase());

/**
 * Attempt the trade only on a remote surface — or inside the native app,
 * whose virtual origin is not a hostname but whose tunnel carries the
 * device credential — and only with no session yet. Pure.
 * @param {{ hostname: unknown, token: unknown, native?: boolean }} input
 * @returns {boolean}
 */
export const shouldTradeDeviceCookie = ({ hostname, token, native = false }) =>
  (isRemoteSurface(hostname) || native === true) && !token;

/**
 * Trade the device cookie for a session. Resolves the wallet address the
 * phone now acts as, or null when the server refused (no cookie, revoked,
 * expired, or remote access off). impure (network + storage).
 * @returns {Promise<string | null>}
 */
export const tradeDeviceCookie = async () => {
  const res = await fetch('/api/v1/remote/session', { method: 'POST', credentials: 'same-origin' });
  if (!res.ok) return null;
  const { token, address, device } = await res.json();
  if (typeof token !== 'string' || typeof address !== 'string' || !token || !address) return null;
  sessionStorage.setItem('authToken', token);
  sessionStorage.setItem(DEVICE_KEY, JSON.stringify(device && typeof device === 'object' ? device : {}));
  localStorage.setItem('walletAddress', address);
  localStorage.setItem('walletConnected', 'true');
  return address;
};

/**
 * The paired device this session was traded from, as the server named it,
 * or null on a surface that never traded. impure (storage read).
 * @returns {{ id?: string, label?: string } | null}
 */
export const pairedDevice = () => {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(DEVICE_KEY) ?? 'null');
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
};
