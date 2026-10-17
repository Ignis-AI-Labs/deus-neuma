// remote-client.js — the desk's hand on Neuma Remote (Settings > Security > Remote).
//
// impure — talks to the local backend with the session token. Every call here
// is local-only on the server: a paired phone reaching these gets 403, which
// the section reads as […].
import { apiCall } from '../utils/http.js';

const BASE = '/api/v1/remote';

/**
 * @typedef {{ enabled: boolean, origin: string | null, rotatedAt: string | null,
 *   devices: Array<{ id: string, label: string, createdAt: string, lastSeenAt: string }>,
 *   port: number, serving: boolean,
 *   tailscale: { installed: boolean, backendState: string | null, dnsName: string | null, certDomains: string[], detail: string } }} RemoteStatus
 */

/** @returns {Promise<RemoteStatus>} */
// impure
export const getRemoteStatus = async () =>
  apiCall('GET', BASE, {
    strictJson: true, useServerError: false, errorPrefix: 'Could not read remote status',
  });

/** @returns {Promise<RemoteStatus>} */
// impure
export const enableRemote = () => apiCall('POST', `${BASE}/enable`, { errorPrefix: 'Could not enable remote access' });

/** @returns {Promise<RemoteStatus>} */
// impure
export const disableRemote = () => apiCall('POST', `${BASE}/disable`, { errorPrefix: 'Could not disable remote access' });

/** @returns {Promise<RemoteStatus>} */
// impure
export const rotateRemote = () => apiCall('POST', `${BASE}/rotate`, { errorPrefix: 'Could not rotate devices' });

/** @returns {Promise<{ code: string, expiresIn: number, url: string }>} */
// impure
export const pairPhone = () => apiCall('POST', `${BASE}/pair`, { errorPrefix: 'Could not start pairing' });

/** @returns {Promise<RemoteStatus>} */
// impure
export const enableHttps = () => apiCall('POST', `${BASE}/https/enable`, { errorPrefix: 'Could not turn on HTTPS' });

/** @returns {Promise<RemoteStatus>} */
// impure
export const disableHttps = () => apiCall('POST', `${BASE}/https/disable`, { errorPrefix: 'Could not turn off HTTPS' });

/**
 * @param {string} id
 * @returns {Promise<RemoteStatus>}
 */
// impure
export const revokeDevice = (id) =>
  apiCall('DELETE', `${BASE}/devices/${encodeURIComponent(id)}`, { errorPrefix: 'Could not revoke the device' });

/**
 * The authenticated QR route for a pairing code — rendered through AuthImage,
 * which carries the bearer the browser's own <img> fetch cannot. Pure.
 * @param {string} code
 * @returns {string}
 */
export const qrSource = (code) => `${BASE}/qr.svg?code=${encodeURIComponent(code)}`;
