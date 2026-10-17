// Substrate Detector — hardware/platform awareness for neuma consciousness
//
// Pure functions — no state, no side effects beyond the GPU probe (gpu-probe.js).

import os from 'os';
import { getConfig } from './llm-provider.js';
import { activeServedModelKey } from './llama-server-supervisor.js';
import { describeCapacity } from './capacity-probes.js';
import { detectGpu } from './gpu-probe.js';

const detectCPU = () => ({
  model: os.cpus()[0]?.model || 'Unknown',
  cores: os.cpus().length,
  arch: os.arch(),
});

const detectMemory = () => ({
  totalGB: Math.round(os.totalmem() / (1024 ** 3)),
});

// Any vendor's GPU, not just NVIDIA's — see gpu-probe.js. This used to be an
// nvidia-smi call whose failure branch read […], which told every AMD owner their machine had no GPU at all.
const detectGPU = () => detectGpu();

const detectPlatform = () => ({
  os: os.platform(),
  version: os.version(),
  hostname: os.hostname(),
});

/**
 * Detect and return a frozen substrate profile describing the hardware and
 * LLM environment the neuma consciousness is running on.
 * @returns {Promise<Readonly<{cpu: {model: string, cores: number, arch: string}, gpu: {name: string, vramGB: number}|null, memory: {totalGB: number}, platform: {os: string, version: string, hostname: string}, llm: {provider: string, model: string, endpoint: string}}>>} Frozen substrate profile
 */
export const getSubstrateProfile = async () => {
  const [cpu, gpu] = await Promise.all([detectCPU(), detectGPU()]);
  const memory = detectMemory();
  const platform = detectPlatform();
  const config = getConfig();

  // SINGLE CHANNEL: use the canonical loader so substrate profile (injected
  // into prompts) and every other surface agree on the active served model.
  const served = await activeServedModelKey(process.env).catch(() => null);

  return Object.freeze({
    cpu,
    gpu,
    memory,
    platform,
    llm: {
      provider: config.provider,
      model: served || config.model,
      endpoint: config.endpoint,
    },
  });
};

/**
 * Format a substrate profile into a human-readable string for injection into the system prompt.
 * @param {Object|null} substrate - Substrate profile from getSubstrateProfile()
 * @param {Object|null} [capacity] - latest measured CapacityResult (readLatestCapacity); the
 *   rig's parallel-team ceiling, so a neuma reflecting on its hardware knows how wide a team it
 *   sustains. Omitted honestly when no scan has run.
 * @returns {string} Multi-line string describing the hardware, or empty string if substrate is null
 */
export const formatSubstrateForPrompt = (substrate, capacity = null) => {
  if (!substrate) return '';
  const lines = [
    `Platform: ${substrate.platform.os} (${substrate.cpu.arch})`,
    `CPU: ${substrate.cpu.model} (${substrate.cpu.cores} cores)`,
    `RAM: ${substrate.memory.totalGB}GB`,
  ];
  if (substrate.gpu) {
    lines.push(`GPU: ${substrate.gpu.name} (${substrate.gpu.vramGB}GB VRAM)`);
  }
  lines.push(`LLM: ${substrate.llm.model} via ${substrate.llm.provider}`);
  const cap = describeCapacity(capacity);
  if (cap) lines.push(cap);
  return lines.join('\n');
};
