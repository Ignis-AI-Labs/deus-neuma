/**
 * remote-store — the remote-access record on disk: data/settings/remote.json.
 *
 * Version 2 carries the ROADS (Road B, docs/security/remote-surface.md):
 *   tailnet — the enrolled MagicDNS origin, Road A as built
 *   lan     — { port }, the native TLS listener (tunnel.js), off by default
 *   relay   — { url }, the byte-blind relay road (phase C)
 * `enabled` is derived: any road on. `origin` remains the tailnet origin —
 * the served origin and socket allowlist read it, and only while the
 * tailnet road is on.
 *
 * Device rows come in two kinds, either/or:
 *   cookie — { hash }              Road A: SHA-256 of the cookie secret
 *   native — { spki, cert }        Road B: the phone's public key hash and
 *                                  its self-signed certificate — PUBLIC
 *                                  material only. Nothing in a row can open
 *                                  a connection or mint one, so reading
 *                                  this file still grants nothing.
 * Written 0600. Factory shape:
 * the default instance reads the real path; tests build their own against a
 * tmp file — real disk either way. The request gate reads `get()` on every
 * request and every WS upgrade, so the state is cached in memory and
 * refreshed only by load() and save().
 */
import fs from 'fs/promises';
import { join } from 'path';
import { getSettingsDir } from '../data-root.js';
import { writeJsonAtomic } from '../user-realm.js';
import { createLogger } from '../logger.js';

const log = createLogger('RemoteStore');

// Resolved per call, never at import: NEUMA_DATA_ROOT is set by the packaged
// app after this module may already have loaded.
const defaultPath = () => join(getSettingsDir(), 'remote.json');

export const EMPTY_REMOTE_STATE = Object.freeze({
  version: 2,
  enabled: false,
  origin: null,
  roads: Object.freeze({ tailnet: null, lan: null, relay: null }),
  devices: Object.freeze([]),
  rotatedAt: null,
});

const CORE_DEVICE_FIELDS = Object.freeze(['id', 'label', 'address', 'createdAt', 'lastSeenAt']);

const isNonEmptyString = (v) => typeof v === 'string' && v.length > 0;

const isPemCert = (v) => isNonEmptyString(v) && v.includes('BEGIN CERTIFICATE');

const validDevice = (device) => {
  if (device === null || typeof device !== 'object') return false;
  if (!CORE_DEVICE_FIELDS.every((field) => isNonEmptyString(device[field]))) return false;
  const cookie = isNonEmptyString(device.hash);
  const native = isNonEmptyString(device.spki) && isPemCert(device.cert);
  // Exactly one credential kind per row — never both, never neither.
  return cookie !== native;
};

const frozenDevice = (device) => Object.freeze(Object.fromEntries([
  ...CORE_DEVICE_FIELDS.map((field) => [field, device[field]]),
  ...(isNonEmptyString(device.hash) ? [['hash', device.hash]] : []),
  ...(isNonEmptyString(device.spki) ? [['spki', device.spki]] : []),
  ...(isPemCert(device.cert) ? [['cert', device.cert]] : []),
]));

const normalizeTailnet = (raw, roads) => {
  const v2 = roads && isNonEmptyString(roads.tailnet);
  if (v2) return roads.tailnet.trim().toLowerCase();
  // v1 migration: { enabled, origin } was the whole story.
  return raw.enabled === true && isNonEmptyString(raw.origin) ? raw.origin.trim().toLowerCase() : null;
};

const normalizeLan = (roads) => {
  const lan = roads?.lan;
  if (lan === null || lan === undefined) return null;
  const port = Number(lan?.port);
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? Object.freeze({ port }) : null;
};

const normalizeRelay = (roads) => {
  const url = roads?.relay?.url;
  // ws:// is accepted only to a loopback host — the relay leg rides inside
  // the inner TLS session, but the desk-online metadata still deserves wss
  // beyond the operator's own network.
  if (typeof url !== 'string') return null;
  const clean = url.trim();
  const wss = /^wss:\/\//.test(clean);
  const wsLoopback = /^ws:\/\/(127\.0\.0\.1|\[::1\]|localhost)(:\d+)?$/.test(clean);
  if (!wss && !wsLoopback) return null;
  const token = typeof roads?.relay?.token === 'string' ? roads.relay.token : '';
  return Object.freeze({ url: clean, ...(token ? { token } : {}) });
};

/**
 * Coerce whatever was on disk (or handed to save) into a valid state. Anything
 * malformed reads as OFF with no devices — the safe direction. Pure.
 * @param {unknown} raw
 * @returns {typeof EMPTY_REMOTE_STATE}
 */
export const normalizeRemoteState = (raw) => {
  if (raw === null || typeof raw !== 'object') return EMPTY_REMOTE_STATE;
  const roads = raw.roads !== null && typeof raw.roads === 'object' ? raw.roads : null;
  const tailnet = normalizeTailnet(raw, roads);
  const lan = normalizeLan(roads);
  const relay = normalizeRelay(roads);
  const devices = Array.isArray(raw.devices) ? raw.devices.filter(validDevice).map(frozenDevice) : [];
  return Object.freeze({
    version: 2,
    enabled: tailnet !== null || lan !== null || relay !== null,
    origin: tailnet,
    roads: Object.freeze({ tailnet, lan, relay }),
    devices: Object.freeze(devices),
    rotatedAt: typeof raw.rotatedAt === 'string' ? raw.rotatedAt : null,
  });
};

/**
 * @param {{ path?: string | (() => string) }} [opts]
 */
export const createRemoteStore = ({ path = defaultPath } = {}) => {
  let cache = EMPTY_REMOTE_STATE;
  const listeners = new Set();
  const notify = () => {
    for (const listener of listeners) {
      try { listener(cache); } catch (error) {
        log.error('remote access subscriber failed', { error: error.message });
      }
    }
  };
  const filePath = () => (typeof path === 'function' ? path() : path);
  return {
    /** Subscribe to authoritative cache changes. impure (lifecycle). */
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    /**
     * Read the file into the cache. A missing file is simply OFF; an
     * unreadable one is OFF too, but says so. impure (fs).
     * @returns {Promise<typeof EMPTY_REMOTE_STATE>}
     */
    async load() {
      try {
        cache = normalizeRemoteState(JSON.parse(await fs.readFile(filePath(), 'utf8')));
      } catch (err) {
        if (err?.code !== 'ENOENT') {
          log.warn('remote.json unreadable — remote access reads as OFF', { error: err.message });
        }
        cache = EMPTY_REMOTE_STATE;
      }
      notify();
      return cache;
    },
    /** The cached state. Pure read; never touches disk. */
    get() {
      return cache;
    },
    /**
     * Persist a state atomically, tighten to 0600, and refresh the cache.
     * impure (fs).
     * @param {unknown} next
     * @returns {Promise<typeof EMPTY_REMOTE_STATE>}
     */
    async save(next) {
      const state = normalizeRemoteState(next);
      const file = filePath();
      await writeJsonAtomic(file, state);
      // Best-effort: Windows has no meaningful mode bits.
      await fs.chmod(file, 0o600).catch(() => {});
      cache = state;
      notify();
      return state;
    },
  };
};

/** The one instance the gate, the routes, and the upgrade handler share. */
export const remoteStore = createRemoteStore();
