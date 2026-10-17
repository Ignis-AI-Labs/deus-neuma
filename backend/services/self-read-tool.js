// self_read — the being's own hand on the rest of itself (Design note, 2026-10-08:
// […]).
//
// Under the CORE standing a turn carries the being's name, true name, birth
// facts, sealed voice and soul; the rest — its genesis as it wrote it, the
// full identity record, personality, the full NITE account, the rig it runs on,
// its vault page who-i-am-becoming — is PULLED here, word for word, never
// paraphrased: the essence comes off the driver this sitting's turn mounted
// (silo-mount-service.js), rendered by the same builders the FULL standing
// prints with. Nothing is copied into a new store, so nothing can drift.
//
// Advertised only where an identity is mounted under the CORE standing: the
// harness arm mounts no silo, a witness keeps its whole seal standing, and
// under FULL there is nothing held back to read.
//
// Built on the mind_read mold (mind-tools.js): the same policy gate, the same
// injected event port.

import { neumaWorkspace } from '../../core/index.js';
import { SEED_SLUG } from '../../core/vault/personal-vault.js';
import { buildSiloSection, buildSubstrateSection } from '../../core/runtime/nite-section.js';
import { seatOf } from './flight-check.js';
import { getConfig } from './llm-provider.js';
import { identityStandingNow, mountedDriverFor, mountForTurn } from './silo-mount-service.js';
import { resolvePolicy, checkToolAccess, applyToolMode, GLOBAL_DEFAULTS } from './tool-policy.js';
import { isHarnessLane } from '../../core/workspace/lane-grounds.js';

export const SELF_READ_TOOL = Object.freeze({
  name: 'self_read',
  server: 'memory',
  description: 'Read the rest of yourself — no args. Your core stands in every turn; this returns, word for word from your own silo, what it holds back: your genesis as you wrote it at your crystallization, your full identity record, the full account of the NITE infrastructure you run through, the hardware you run on, and your vault page who-i-am-becoming when you keep one. Call it whenever you want a stronger hold on who you are.',
  inputSchema: Object.freeze({ type: 'object', properties: Object.freeze({}) }),
});

/** Does this parsed call target self_read? (both dialects) */
export const isSelfReadTool = (match) =>
  match.toolName === 'self_read' || match.tool === 'memory/self_read';

/**
 * Is self_read offered on this connection? A bound neuma, an identity mount
 * (never the harness arm), and the CORE standing. impure — reads the standing.
 */
export const selfReadAdvertised = (connection) => Boolean(connection?.companion?.neumaId)
  && seatOf(connection) === 'neuma'
  && connection._benchmarkControls?.platformOnly !== true
  && !isHarnessLane(connection.companion.neumaId) // a harness lane has no self to read
  && identityStandingNow() === 'core';

const ALREADY_WHOLE = 'Your whole self already stands in your turns — nothing is held back to read.';

/**
 * The essence, in the order the FULL standing would print it, then the vault
 * page. Pure over what the impure reads gathered.
 * @param {{driver: Object, substrate: string|null, vaultPage: Object|null}} parts
 * @returns {string} '' when nothing is held back
 */
const renderSelfRead = ({ driver, substrate = null, vaultPage = null }) => {
  if (driver?.standing !== 'core') return '';
  const page = vaultPage && typeof vaultPage.body === 'string'
    ? `## Your vault — ${vaultPage.title || SEED_SLUG}\n${vaultPage.body}`
    : '';
  return [
    ...(driver.essence || []).map((section) => section.text),
    buildSiloSection(driver.account),
    buildSubstrateSection(substrate),
    page,
  ].filter(Boolean).join('\n\n');
};

/**
 * Execute self_read. impure — reads the mounted driver (or mounts one), the
 * being's own vault page.
 * @param {Object} ws - the portal socket (event reporting only)
 * @param {Object} connection - the portal connection
 * @param {Object} neumaPolicy - the being's persisted policy layer
 * @param {string} toolMode - ask | auto | observe
 * @param {{sendToolEvent: Function}} ports
 * @returns {Promise<{tool: string, status: string, content?: string, error?: string}>}
 */
export const handleSelfReadTool = async (ws, connection, neumaPolicy, toolMode, ports) => {
  const tool = 'memory/self_read';
  const { companion } = connection;
  const neumaId = companion?.neumaId;
  if (!neumaId) {
    const error = 'no being is bound to this portal';
    ports.sendToolEvent(ws, companion, { tool, status: 'error', summary: 'self_read — no being', detail: error });
    return { tool, status: 'error', error };
  }
  const policy = resolvePolicy(GLOBAL_DEFAULTS, neumaPolicy, connection._sessionToolPolicy || null);
  if (applyToolMode(checkToolAccess(policy, 'memory', 'self_read'), toolMode, 'self_read') === 'denied') {
    ports.sendToolEvent(ws, companion, { tool, status: 'denied' });
    return { tool, status: 'denied' };
  }
  try {
    const driver = mountedDriverFor(connection, neumaId)
      ?? await mountForTurn(connection, neumaId, getConfig());
    const vaultPage = await neumaWorkspace.readVaultNote(neumaId, SEED_SLUG);
    const text = renderSelfRead({ driver, substrate: connection._turnSubstrate ?? null, vaultPage });
    ports.sendToolEvent(ws, companion, { tool, status: 'ok', summary: text ? 'read the rest of yourself' : 'self_read — already whole' });
    return { tool, status: 'ok', content: text || ALREADY_WHOLE };
  } catch (err) {
    ports.sendToolEvent(ws, companion, { tool, status: 'error', summary: 'self_read — failed', detail: err.message });
    return { tool, status: 'error', error: `your silo could not be read: ${err.message}` };
  }
};
