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
import { readMachineHolders } from './machine-holders.js';
import { shapeMachineHolders } from './machine-holders-shape.js';
import { supervisedEnginePid } from './image-forge/comfyui-supervisor.js';
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

/**
 * machine_map — who holds the graphics card, the system memory and each CPU
 * core, by name (machine-holders.js). The being's half of the lens the
 * SUBSTRATE window shows its operator: one map, two readers.
 */
export const MACHINE_MAP_TOOL = Object.freeze({
  name: 'machine_map',
  server: 'coding',
  description: 'See what is holding this machine right now — no args. Three lists, each holder named by what it IS (the mind and the model file it serves, the image engine, a voice engine, dictation, a browser, this platform itself) and marked when this platform started it: the graphics card (how much memory each holds, how much is free, and what could give memory back), system memory (largest holders, with what has been pushed to swap), and the CPU (how busy each core is, which holder is on the busy ones, and the heaviest users). Read it before starting anything heavy, when something is slow, or when a render or a model will not fit. It changes nothing.',
  inputSchema: Object.freeze({ type: 'object', properties: Object.freeze({}), additionalProperties: false }),
});

const bareName = (match) => match.toolName || String(match.tool || '').replace(/^coding\//, '');
export const isSubstrateFactsTool = (match) =>
  bareName(match) === SUBSTRATE_FACTS_TOOL.name || bareName(match) === MACHINE_MAP_TOOL.name;

/**
 * The live serving facts for a being — observation only, no gate beyond the
 * lane itself. Impure (reads the claim, the catalog, the health probe).
 * @returns {Promise<{tool: string, status: string, content: string}>}
 */
export const handleSubstrateFactsTool = async (ws, connection, match = null) => {
  if (match && bareName(match) === MACHINE_MAP_TOOL.name) {
    try {
      return { tool: 'coding/machine_map', status: 'ok', content: shapeMachineHolders(await readMachineHolders({ enginePid: supervisedEnginePid() })) };
    } catch (err) {
      log.warn('machine map read failed', { err: err.message });
      return { tool: 'coding/machine_map', status: 'error', error: `the machine could not be read: ${err.message}` };
    }
  }
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
