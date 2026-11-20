// THE CHAT LINE from a terminal (backend/services/chat-line.js): find the desk, list the open chats of every operator
// who let this witness in, and speak in one — the being's reply comes back here. Impure (network).

const DESK = 'http://127.0.0.1:47317'; // the desk's own backend (electron/backend-spawn.cjs PREFERRED_PORT)
const DAEMON = 'http://localhost:3333'; // the residency daemon

// impure — is a NEUMA backend answering here? (the same health shape the desk checks, electron/port-resolve.cjs)
const answers = async (base) => {
  try {
    const res = await fetch(`${base}/api/v1/health`, { signal: AbortSignal.timeout(1500) });
    const body = await res.json();
    return res.ok && typeof body?.status === 'string' && body.components && typeof body.components === 'object';
  } catch {
    return false;
  }
};

/**
 * impure — the backend holding the operator's open chats: NEUMA_BACKEND when set, else the desk, else the daemon.
 * @param {string|undefined} named
 * @returns {Promise<string>}
 */
export const findDesk = async (named) => {
  for (const base of named ? [named] : [DESK, DAEMON]) if (await answers(base)) return base;
  throw new Error(named ? `no NEUMA backend answers at ${named}` : 'no NEUMA desk answers on this machine (tried the desk on 47317 and the daemon on 3333) — is the app open?');
};

const call = async (backend, token, route, init = {}) => {
  const res = await fetch(`${backend}/api/v1/chat-line${route}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${res.status} ${body.error || 'chat line refused'}`);
  return body;
};

/** impure — the open chats this witness may speak in. */
export const listLineChats = ({ backend, token }) => call(backend, token, '/chats');

/** impure — speak in one; resolves with the being's reply once its turn closes (or what it said by the wait). */
export const sayOnLine = ({ backend, token, to, body, re, waitSeconds }) => call(backend, token, '/send', {
  method: 'POST', body: JSON.stringify({ to, body, ...(re ? { re } : {}), ...(waitSeconds ? { waitSeconds } : {}) }),
});

/**
 * Pure — a chat from what was typed: its exact address, or a being's name when exactly one of its chats is open.
 * @param {Array<{chat: string, being: string}>} chats
 * @param {string} wanted
 * @returns {{chat?: string, error?: string}}
 */
export const pickChat = (chats, wanted) => {
  const exact = chats.find((c) => c.chat === wanted);
  if (exact) return { chat: exact.chat };
  const named = chats.filter((c) => c.being.toLowerCase() === String(wanted).toLowerCase());
  if (named.length === 1) return { chat: named[0].chat };
  if (named.length > 1) return { error: `${named[0].being} has ${named.length} chats open — name one by its address:\n${named.map((c) => `  ${c.chat}${c.title ? ` "${c.title}"` : ''}`).join('\n')}` };
  return { error: `no open chat for "${wanted}" that you may speak in — see: node cli.js chats` };
};

/** Pure — the chats, one per line. */
export const formatLineChats = ({ witness, chats }) => (chats.length
  ? [`${chats.length} open chat(s) ${witness} may speak in:`, ...chats.map((c) => `  ${c.chat}  ${c.being}${c.title ? ` — "${c.title}"` : ''}${c.busy ? '  (mid-turn)' : ''}`)].join('\n')
  : `No open chat lets ${witness} in. The operator opens a line with: node scripts/chat-line.mjs grant ${witness}`);
