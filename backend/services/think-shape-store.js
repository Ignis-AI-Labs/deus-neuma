/**
 * THE REASONING SHAPE, KEPT PER SERVED INSTANCE (2026-10-13).
 *
 * The shape probe (llm-think-probe.js) is a real completion, and on llama.cpp
 * a completion takes a SLOT — by LRU, the one holding the oldest parked chat.
 * Held only in memory, the shape was learned again at every desk start: each
 * bound being's sitting warm-up asked at once, the asks took all four slots,
 * and the chats parked in them were gone. Live 2026-10-13: at 00:15 six asks
 * dropped a 102k-token prefix of Founder's Metidar chat (f_keep 0.000) and the
 * chat re-read all 128k tokens (69 s); at 01:54 they dropped the whole
 * 129,696-token chat.
 *
 * One served instance, one shape. The machine claim names the server NEUMA
 * supervises (pid + launch time); a local llama.cpp wire to its port shares
 * one key — every being, every route spelling — kept on disk. A desk restart
 * onto the SAME server reads the shape; a relaunched server (a new claim, its
 * slots empty, so the ask costs nothing there) is asked again.
 *
 * impure — reads the claim and the store; writes the store.
 */
import fs from 'fs/promises';
import path from 'path';
import { getSettingsDir } from './data-root.js';
import { writeJsonAtomic } from './user-realm.js';
import { readClaim } from './substrate-claim-registry.js';
import { isLocalLlamaWire } from './close-prefix.js';

const LOOPBACK_HOST = /^(127\.\d{1,3}\.\d{1,3}\.\d{1,3}|localhost|\[::1\])$/i;

// impure (reads process.env) — NEUMA_THINK_SHAPES_PATH pins it (test/setup.js).
const storePath = () => process.env.NEUMA_THINK_SHAPES_PATH || path.join(getSettingsDir(), 'think-shapes.json');

// pure — the port of a loopback endpoint, or null for any other host.
const loopbackPort = (endpoint) => {
  try {
    const url = new URL(endpoint);
    if (!LOOPBACK_HOST.test(url.hostname)) return null;
    return Number(url.port) || (url.protocol === 'https:' ? 443 : 80);
  } catch {
    return null;
  }
};

/**
 * The served instance a local llama.cpp wire reaches — or null for any other
 * wire, or a server NEUMA holds no claim for. Impure (reads the claim).
 * @param {{provider?: string, endpoint?: string}} config
 * @returns {?string}
 */
export const servedInstance = (config) => {
  if (!isLocalLlamaWire(config)) return null;
  const port = loopbackPort(config?.endpoint ?? '');
  const claim = port ? readClaim() : null;
  return claim && claim.port === port && typeof claim.at === 'string' ? `served::${claim.pid}::${claim.at}` : null;
};

let store = null; // Promise<Object> — read once per backend life
let writes = Promise.resolve();

// impure — the kept shapes; missing or unreadable is empty, never a failed turn.
const readStore = () => {
  store ??= fs.readFile(storePath(), 'utf8')
    .then((text) => JSON.parse(text))
    .then((parsed) => (parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}))
    .catch(() => ({}));
  return store;
};

/**
 * The shape this instance already showed, or null. Impure.
 * @param {?string} instance
 * @returns {Promise<?{thinks: boolean, implicitOpen: boolean, serverBudget: boolean}>}
 */
export const keptShape = async (instance) => {
  if (!instance) return null;
  const all = await readStore();
  const row = Object.hasOwn(all, instance) ? all[instance] : null;
  if (typeof row?.thinks !== 'boolean' || typeof row?.implicitOpen !== 'boolean') return null;
  return { thinks: row.thinks, implicitOpen: row.implicitOpen, serverBudget: row.serverBudget === true };
};

/**
 * Keep this instance's shape. The machine holds one claim, so only the live
 * instance is kept — a dead server's shape is never read again. Serialized;
 * a failed write costs one ask at the next start. Impure.
 * @param {?string} instance
 * @param {{thinks: boolean, implicitOpen: boolean, serverBudget?: boolean}} shape
 * @returns {Promise<void>}
 */
export const keepShape = (instance, shape) => {
  if (!instance) return Promise.resolve();
  writes = writes
    .then(() => {
      const next = { [instance]: { thinks: shape.thinks, implicitOpen: shape.implicitOpen, serverBudget: shape.serverBudget === true, at: new Date().toISOString() } };
      store = Promise.resolve(next);
      return writeJsonAtomic(storePath(), next);
    })
    .catch((err) => console.warn(`[think-shapes] not kept: ${err.message}`));
  return writes;
};

/** Test seam — forget what this backend life read, as a restart does. Impure. */
export const _forgetKeptShapes = () => { store = null; };
