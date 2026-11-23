/**
 * THE REMOTE ROAD'S ACCESS LOG — every time this desk was reached, or nearly reached, from outside it: a phone
 * paired, a phone signed in, every change a phone made (its method and path, never its body), a phone cut, the roads
 * opened, closed or rotated, and requests the gate refused
 * (docs/work/crm-match-blob.md, 2026-11-23: until now each of these went to the console only, and a paired phone's
 * last sign-in overwrote the one before). Kept on this machine, 0600, beside remote.json; read on the desk only.
 *
 * Never a secret: no cookie, no token, no pairing code is ever written — a device by its id and label, a peer by its
 * address. Refusals can be sent by anyone, so one peer refused for one reason is written at most once a minute (the
 * repeats are counted on the next line), and the file rolls over at 2 MB, keeping the one before.
 * impure (fs, clock).
 */
import fs from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { getSettingsDir } from '../data-root.js';
import { createLogger } from '../logger.js';

const log = createLogger('Remote.AccessLog');
export const ACCESS_EVENTS = Object.freeze(['paired', 'session', 'acted', 'revoked', 'rotated', 'enabled', 'disabled', 'road', 'refused']);
const LOG_MAX_BYTES = 2 * 1024 * 1024;
const REFUSAL_GAP_MS = 60_000;
const FIELD_MAX = 200;
const FIELDS = Object.freeze(['device', 'label', 'address', 'road', 'peer', 'reason', 'method', 'path', 'repeats']);

// pure — only the known fields, each short text or a count; anything else is dropped.
const cleanFields = (fields = {}) => Object.fromEntries(FIELDS.filter((k) => fields[k] !== undefined && fields[k] !== null)
  .map((k) => [k, typeof fields[k] === 'number' ? fields[k] : String(fields[k]).slice(0, FIELD_MAX)]));

/** One log line, or null for an event it does not know. pure. */
export const accessEntry = (event, fields, at) => (ACCESS_EVENTS.includes(event) ? { at, event, ...cleanFields(fields) } : null);

/**
 * @param {{ path?: string | (() => string), now?: () => number }} [opts]
 */
export const createAccessLog = ({ path = () => join(getSettingsDir(), 'remote-access.jsonl'), now = () => Date.now() } = {}) => {
  const file = () => (typeof path === 'function' ? path() : path);
  const refusals = new Map(); // `${peer}|${reason}` → {at, repeats}
  let chain = Promise.resolve();

  // impure — one line appended, rolled over first when the file is full. Never throws: the road stands either way.
  const write = (entry) => {
    if (!entry) return chain;
    chain = chain.then(async () => {
      const target = file();
      await fs.mkdir(dirname(target), { recursive: true, mode: 0o700 });
      const size = (await fs.stat(target).catch(() => null))?.size ?? 0;
      if (size > LOG_MAX_BYTES) await fs.rename(target, `${target}.1`);
      await fs.appendFile(target, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
      await fs.chmod(target, 0o600);
    }).catch((err) => log.warn('the remote access log could not be written', { err: err.message }));
    return chain;
  };

  // impure — every line of one file, newest last; a broken line is skipped, never fatal.
  const lines = async (target) => (await fs.readFile(target, 'utf8').catch(() => '')).split('\n').filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

  return {
    /** Note one event. @returns {Promise<void>} */
    note: (event, fields) => write(accessEntry(event, fields, new Date(now()).toISOString())),

    /** Note a refused request: at most once a minute for one peer and one reason, the repeats counted. */
    refused: ({ peer, reason, method, path: reqPath }) => {
      const key = `${peer ?? '?'}|${reason ?? '?'}`;
      const seen = refusals.get(key);
      const t = now();
      if (seen && t - seen.at < REFUSAL_GAP_MS) { seen.repeats += 1; return chain; }
      refusals.set(key, { at: t, repeats: 0 });
      if (refusals.size > 1000) refusals.delete(refusals.keys().next().value);
      return write(accessEntry('refused', { peer, reason, method, path: reqPath, ...(seen?.repeats ? { repeats: seen.repeats } : {}) }, new Date(t).toISOString()));
    },

    /**
     * The log, newest first, a page at a time (every line is readable: page by `before`, the `at` of the last one shown).
     * @returns {Promise<{entries: object[], more: boolean}>}
     */
    read: async ({ limit = 200, before = null } = {}) => {
      await chain;
      const all = [...(await lines(`${file()}.1`)), ...(await lines(file()))].reverse();
      const from = before ? all.filter((e) => String(e.at) < String(before)) : all;
      const n = Math.max(1, Math.min(1000, Number(limit) || 200));
      return { entries: from.slice(0, n), more: from.length > n };
    },
  };
};

export const accessLog = createAccessLog();
