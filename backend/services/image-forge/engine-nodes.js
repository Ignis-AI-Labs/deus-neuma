/**
 * ENGINE NODES — the image engine's own description of every node it has
 * (/object_info), read from the live engine and kept on this computer, so a
 * node can still be studied while the engine is stopped. The kept copy says
 * when it was read and from which engine version; a read never starts the
 * engine by itself (starting it is an act — forge_control).
 */
import fs from 'fs/promises';
import path from 'path';
import { getDataRoot } from '../data-root.js';
import { isComfyServing } from './comfyui-supervisor.js';

const keptPath = () => path.join(getDataRoot(), 'image-forge', 'engine-nodes.json');

// impure — the live engine's node list and version.
const fetchLive = async (cfg) => {
  const get = async (route, ms) => {
    const res = await fetch(`http://${cfg.host}:${cfg.port}${route}`, { signal: AbortSignal.timeout(ms) });
    if (!res.ok) throw new Error(`${route} answered ${res.status}`);
    return res.json();
  };
  const [objectInfo, stats] = await Promise.all([get('/object_info', 30_000), get('/system_stats', 5000).catch(() => null)]);
  return { objectInfo, version: stats?.system?.comfyui_version ?? null, readAt: new Date().toISOString() };
};

/**
 * The engine's nodes: from the live engine when it is up (and kept), else the
 * kept copy, else null. impure.
 * @param {ReturnType<import('./comfyui-config.js').resolveComfyConfig>} cfg
 * @returns {Promise<{objectInfo:Object, version:(string|null), readAt:string, live:boolean}|null>}
 */
export const readEngineNodes = async (cfg) => {
  if (await isComfyServing(cfg).catch(() => false)) {
    try {
      const read = await fetchLive(cfg);
      await fs.mkdir(path.dirname(keptPath()), { recursive: true });
      const tmp = `${keptPath()}.${process.pid}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(read));
      await fs.rename(tmp, keptPath());
      return { ...read, live: true };
    } catch { /* fall through to the kept copy */ }
  }
  try {
    const kept = JSON.parse(await fs.readFile(keptPath(), 'utf8'));
    return kept?.objectInfo ? { ...kept, live: false } : null;
  } catch {
    return null;
  }
};

/** In words: where this node list came from. Pure. */
export const nodesAsOf = (nodes) => (nodes.live
  ? `read from the running engine${nodes.version ? `, ComfyUI ${nodes.version}` : ''}`
  : `as kept on ${String(nodes.readAt).slice(0, 10)}${nodes.version ? ` from ComfyUI ${nodes.version}` : ''}; the engine is not running`);
