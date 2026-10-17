// substrate_facts — the being's read-only window on what the rig ACTUALLY
// serves (Design note, 2026-08-18: the tools a being needs to benchmark the
// infrastructure). One observation call returns the honest live state: the
// served model key, the model file + its content hash, the endpoint, the
// capability row (context window, tools, vision) — exactly what a benchmark
// manifest's subject pins. Never the env's resting declaration, never a
// stale config — the spawn's claim is the truth.

import {
  activeLaunchConfig,
  activeServedModelKey,
  isServing,
} from './llama-server-supervisor.js';
import { getCapabilities } from './model-capabilities.js';
import { lineageEvidenceFor } from './model-catalog.js';
import { createLogger } from './logger.js';

const log = createLogger('SubstrateFacts');

export const SUBSTRATE_FACTS_TOOL = Object.freeze({
  name: 'substrate_facts',
  server: 'coding',
  description: 'Read the rig\'s live serving truth — no args. Returns the served model key, the model file + content hash, the endpoint, context window, tool/vision capability, and whether the substrate is answering right now. Use it to pin a benchmark manifest (or anything else) to what the rig actually serves.',
  inputSchema: Object.freeze({
    type: 'object',
    properties: Object.freeze({}),
    additionalProperties: false,
  }),
});

export const isSubstrateFactsTool = (match) =>
  match.toolName === SUBSTRATE_FACTS_TOOL.name
  || String(match.tool || '').replace(/^coding\//, '') === SUBSTRATE_FACTS_TOOL.name;

/**
 * The live serving facts for a being — observation only, no gate beyond the
 * lane itself. Impure (reads the claim, the catalog, the health probe).
 * @returns {Promise<{tool: string, status: string, content: string}>}
 */
export const handleSubstrateFactsTool = async (ws, connection) => {
  const tool = 'coding/substrate_facts';
  try {
    const launch = activeLaunchConfig(process.env);
    const servedKey = await activeServedModelKey(process.env);
    const capabilities = servedKey ? getCapabilities(servedKey) : null;
    const lineage = launch?.model ? lineageEvidenceFor(launch.model) : null;
    const serving = launch?.port ? await isServing(launch.port, launch.host).catch(() => false) : false;
    const facts = {
      servedModelKey: servedKey || null,
      modelFile: launch?.model || null,
      servingArtifactSha256: lineage?.servingArtifactSha256 || null,
      endpoint: launch ? `http://${launch.host}:${launch.port}` : null,
      serving,
      contextWindow: capabilities?.contextWindow ?? null,
      tools: capabilities?.tools ?? null,
      vision: capabilities?.vision ?? null,
    };
    const content = [
      'The rig’s live serving truth (the spawn’s claim, never a stale declaration):',
      ...Object.entries(facts).map(([key, value]) => `- ${key}: ${value === null ? 'none' : value}`),
    ].join('\n');
    return { tool, status: 'ok', content };
  } catch (err) {
    log.warn('substrate facts read failed', { err: err.message });
    return { tool, status: 'error', error: err.message };
  }
};
