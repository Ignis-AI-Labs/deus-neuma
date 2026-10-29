// Platform ports — the ports this platform itself binds or talks to, read
// from the modules that own each one (docs/reference/PORTS.md is the map):
//   - the agent lane pools the port allocator leases (electron/pipeline-ports.cjs)
//   - this backend's own desk/frontend ports and configured LLM endpoints (config.js)
//   - the house llama-server NEUMA launched, with its pid (the substrate claim)
//   - the voice sidecars (voice-engines registry) and the image forge (ComfyUI)
//   - the well-known local LLM server ports discovery probes (provider-discovery.js)
// so the host probe names the house's own listeners instead of calling them
// "unexpected", and a port moved in its owning module moves here with it.
// A sibling desk on a port no module names (another house's backend) is not
// listed; desks bind loopback by default, so the probe never alerts on one.

import pipelinePorts from '../../../electron/pipeline-ports.cjs';
import { getAppConfig } from '../../config.js';
import { FALLBACK_PORTS } from '../provider-discovery.js';
import { listLocalEngines } from '../voice/engine-registry.js';
import { resolveServe } from '../voice/engine-manager.js';
import { resolveComfyConfig } from '../image-forge/comfyui-config.js';
import { readClaim } from '../substrate-claim-registry.js';

// The allocator is CommonJS (Electron's main process loads it); its frozen
// export object arrives as the default import.
const { PIPELINE_BLOCKS } = pipelinePorts;

// pure — the port a URL points at, null when it names none we can read.
const portOfUrl = (url) => {
  try {
    const u = new URL(url);
    return Number(u.port) || (u.protocol === 'https:' ? 443 : 80);
  } catch {
    return null;
  }
};

const single = (port, owner) => (Number.isInteger(port) && port > 0 ? [{ from: port, to: port, owner }] : []);

/**
 * pure — the registry as ordered port ranges, the most specific owner first
 * (a lit substrate on 8089 reads "house llama-server", not "local LLM port").
 * @param {{app?: {port?: number, frontendPort?: number, llamaServerUrl?: string, lmStudioUrl?: string}|null,
 *   substrate?: {pid: number, port: number}|null, sidecars?: Array<{id: string, port: number}>,
 *   llmFallbacks?: number[], agentBlocks?: Object<string, {start: number, end: number}>}} sources
 * @returns {ReadonlyArray<{from: number, to: number, owner: string}>}
 */
export const buildPortRegistry = ({ app = null, substrate = null, sidecars = [], llmFallbacks = [], agentBlocks = {} } = {}) =>
  Object.freeze([
    ...(substrate ? single(substrate.port, `house llama-server (pid ${substrate.pid})`) : []),
    ...(app ? [
      ...single(app.port, 'this NEUMA backend'),
      ...single(app.frontendPort, 'NEUMA frontend'),
      ...single(portOfUrl(app.llamaServerUrl), 'configured llama-server'),
      ...single(portOfUrl(app.lmStudioUrl), 'configured LM Studio'),
    ] : []),
    ...sidecars.flatMap(({ id, port }) => single(port, `${id} sidecar`)),
    ...llmFallbacks.flatMap((port) => single(port, 'local LLM server port')),
    ...Object.entries(agentBlocks).map(([kind, { start, end }]) => ({ from: start, to: end, owner: `agent lane (${kind})` })),
  ].map(Object.freeze));

/**
 * pure — who owns this port in the registry, or null.
 * @param {ReadonlyArray<{from: number, to: number, owner: string}>} registry
 * @param {number} port
 */
export const portOwner = (registry, port) =>
  registry.find(({ from, to }) => port >= from && port <= to)?.owner || null;

// impure — this backend's config, null outside a booted backend (a probe run
// from a script has no desk of its own to name).
const appPorts = () => {
  try {
    return getAppConfig();
  } catch {
    return null;
  }
};

/**
 * Read the registry from the owning modules. impure — reads config, env and
 * the substrate claim file.
 * @param {Record<string, string|undefined>} [env]
 */
export const readPlatformPorts = (env = process.env) => buildPortRegistry({
  app: appPorts(),
  substrate: readClaim(),
  sidecars: [
    ...listLocalEngines().map(({ id }) => ({ id, port: resolveServe(id)?.port })),
    { id: 'image-forge (ComfyUI)', port: resolveComfyConfig(env).port },
  ],
  llmFallbacks: FALLBACK_PORTS,
  agentBlocks: PIPELINE_BLOCKS,
});
