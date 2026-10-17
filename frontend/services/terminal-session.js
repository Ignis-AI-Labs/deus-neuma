// impure - renderer-session custody, separate from xterm/effect lifetime.
import { apiCall } from '../utils/http.js';

const windowClosers = new Map();

/** Read a terminal identity only after authenticating the captured bearer. */
export const readTerminalSession = async (windowId) => {
  if (typeof windowId !== 'string' || !windowId) throw new Error('Terminal window identity required');
  const token = sessionStorage.getItem('authToken');
  if (!token) throw new Error('Sign in to recover this terminal');
  const { address } = await apiCall('GET', '/api/v1/auth/session', { headers: { Authorization: `Bearer ${token}` } });
  if (sessionStorage.getItem('authToken') !== token) throw new Error('Terminal authentication changed; reopen after signing in');
  if (typeof address !== 'string' || !/^0x[0-9a-f]{40}$/i.test(address)) throw new Error('Terminal wallet identity unavailable');
  const wallet = address.toLowerCase();
  const key = `neuma:terminal:${wallet}:${windowId}`;
  return Object.freeze({ wallet, token, key, termId: sessionStorage.getItem(key) });
};

/** Retain the server-issued ID through reauth/unmount/reload, in this browser tab only. */
export const rememberTerminalSession = (session, id) => sessionStorage.setItem(session.key, id);

/** Forget only an explicitly closed window's captured wallet identity. */
export const forgetTerminalSession = (session) => sessionStorage.removeItem(session.key);

/** Register an explicit-close action; effect disposal only unregisters it. */
export const registerTerminalWindow = (windowId, close) => {
  windowClosers.set(windowId, close);
  return () => { if (windowClosers.get(windowId) === close) windowClosers.delete(windowId); };
};

/** Invoked by window chrome, never by React cleanup or authentication navigation. */
export const closeTerminalWindow = (windowId) => windowClosers.get(windowId)?.();

/** Kill a detached terminal using the captured owner bearer, never a later wallet's token. */
export const closeTerminalSession = async (session, id) => {
  try {
    await apiCall('DELETE', `/api/v1/terminal/sessions/${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${session.token}` },
    });
  } catch (err) {
    if (err.http !== 404) throw err; // Already exited/expired is the desired end state.
  }
};
