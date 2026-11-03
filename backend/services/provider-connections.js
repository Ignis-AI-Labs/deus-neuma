/**
 * Provider connections — the operator's LOCKED-IN provider routes.
 *
 * A connection is a provider the operator has fully connected: credential
 * present, live probe answered, model chosen. It is persisted so the desk
 * never asks for the same setup twice, and it is the ONLY pool a new AI
 * witness may be summoned onto — a witness is born on a locked connection
 * and keeps that provider for life (no per-witness re-routing).
 *
 * Not a secret store: no keys here (credentials stay in the encrypted
 * provider-credentials store). Machine-scoped operator preference, plaintext,
 * same discipline as neuma-routes-store.
 */
import fs from 'fs/promises';
import { join, dirname } from 'path';
import { canonicalProviderId, getProvider } from './provider-registry.js';
import { getSettingsDir } from './data-root.js';
import { createWriteChain } from './write-chain.js';

const SETTINGS_DIR = getSettingsDir();

// Overridable per call so tests never touch the operator's live connections.
const connectionsPath = () =>
  process.env.NEUMA_CONNECTIONS_PATH || join(SETTINGS_DIR, 'provider-connections.json');

// Serialize read-modify-write (same TOCTOU discipline as neuma-routes-store).
const serialize = createWriteChain();

// impure — absent file means "no connections yet"; a corrupt non-object is
// treated as none (same doctrine as the routes store).
const loadConnections = async () => {
  try {
    const raw = await fs.readFile(connectionsPath(), 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const migrated = {};
    for (const [providerId, connection] of Object.entries(parsed)) {
      const canonical = canonicalProviderId(providerId);
      // A lock proved through the retired OpenCode transport is not proof of
      // Neuma's direct OAuth path. Drop it so the operator must prove again.
      if (canonical !== providerId) continue;
      migrated[canonical] = {
        ...connection,
        providerId: canonicalProviderId(connection?.providerId || providerId),
      };
    }
    return migrated;
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw err;
  }
};

// impure — atomic persist (tmp + rename)
const saveConnections = async (map) => {
  const target = connectionsPath();
  await fs.mkdir(dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(map, null, 2));
  await fs.rename(tmp, target);
};

// pure — validate + normalize a connection before it may be persisted.
const normalizeConnection = (conn) => {
  const entry = getProvider(conn?.providerId);
  if (!entry) throw new Error(`Unknown provider: ${conn?.providerId}`);
  if (typeof conn?.model !== 'string' || conn.model.length === 0) {
    throw new Error('A locked connection requires a model');
  }
  return Object.freeze({
    providerId: entry.id,
    model: conn.model,
    endpoint: typeof conn.endpoint === 'string' && conn.endpoint ? conn.endpoint : (entry.endpoint ?? null),
    account: typeof conn.account === 'string' && conn.account ? conn.account : null,
    credentialKind: conn.credentialKind === 'oauth' ? 'oauth' : 'key',
    lockedAt: conn.lockedAt || new Date().toISOString(),
    lastLiveAt: conn.lastLiveAt || null,
  });
};

/** impure — every locked connection, newest last. */
export const listConnections = async () =>
  Object.values(await loadConnections());

/** impure — one locked connection, or null. */
export const getConnection = async (providerId) =>
  (await loadConnections())[providerId] ?? null;

/**
 * impure — lock a connection in (after a live probe proved it). Overwrites any
 * prior lock for the same provider — re-connecting is how the operator moves
 * a provider to a new model.
 */
export const lockConnection = async (conn) => {
  const normalized = normalizeConnection(conn);
  return serialize(async () => {
    const map = await loadConnections();
    map[normalized.providerId] = normalized;
    await saveConnections(map);
    return normalized;
  });
};

/** impure — remove a lock (the credential itself is untouched). */
export const removeConnection = async (providerId) => serialize(async () => {
  const map = await loadConnections();
  if (map[providerId] === undefined) return false;
  delete map[providerId];
  await saveConnections(map);
  return true;
});

/**
 * The route object a connection implies for one model call, carrying the
 * credential paired with its endpoint (pairRequestCredential). Pure.
 * @param {{providerId: string, model: string}} connection
 * @param {{endpoint: string, apiKey?: string, accountId?: string}} credential
 */
export const routeForConnection = (connection, { endpoint, apiKey, accountId }) => ({
  provider: connection.providerId,
  model: connection.model,
  endpoint,
  apiKey,
  accountId,
  chatPath: getProvider(connection.providerId).chatPath,
});
