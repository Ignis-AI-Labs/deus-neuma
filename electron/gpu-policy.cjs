'use strict';

/**
 * Desk compositor policy — pick the real GPU and stay off the iGPU tile budget.
 *
 * On this hybrid box Chromium's tile_manager dies when the compositor sits
 * on Intel (`renderD128`) while llama-server already owns the NVIDIA card.
 * Other desks on the same machine (Code, Brave, Discord) already force
 * `--render-node-override=/dev/dri/renderD129`. We do the same, only when
 * that node is actually present.
 */

const fs = require('node:fs');
const path = require('node:path');

const NVIDIA_VENDOR = '0x10de';

/**
 * Pure — first NVIDIA render node, or null.
 * @param {readonly {path: string, vendor: string}[]} nodes
 * @returns {string|null}
 */
const nvidiaRenderNode = (nodes) => {
  if (!Array.isArray(nodes)) return null;
  const hit = nodes.find((n) => n && n.vendor === NVIDIA_VENDOR && typeof n.path === 'string' && n.path);
  return hit ? hit.path : null;
};

/**
 * Pure — Chromium switches that put the compositor on the named GPU.
 * Empty when there is no NVIDIA render node (do not guess).
 * @param {readonly {path: string, vendor: string}[]} nodes
 * @returns {readonly (readonly [string, string])[]}
 */
const compositorSwitches = (nodes) => {
  const node = nvidiaRenderNode(nodes);
  if (!node) return Object.freeze([]);
  return Object.freeze([
    Object.freeze(['render-node-override', node]),
  ]);
};

/**
 * Impure — read /sys/class/drm render nodes and their PCI vendors.
 * @param {string} [drmRoot]
 * @returns {{path: string, vendor: string}[]}
 */
const readRenderNodes = (drmRoot = '/sys/class/drm') => {
  let names;
  try { names = fs.readdirSync(drmRoot); } catch { return []; }
  const nodes = [];
  for (const name of names) {
    if (!/^renderD\d+$/.test(name)) continue;
    let vendor = '';
    try { vendor = fs.readFileSync(path.join(drmRoot, name, 'device', 'vendor'), 'utf8').trim(); } catch { continue; }
    nodes.push({ path: `/dev/dri/${name}`, vendor });
  }
  return nodes;
};

/**
 * Impure — apply the policy to Electron's command line. Must run before ready.
 * @param {{commandLine: {appendSwitch: Function}}} app
 * @param {{path: string, vendor: string}[]} [nodes]
 */
const applyGpuPolicy = (app, nodes = readRenderNodes()) => {
  for (const [name, value] of compositorSwitches(nodes)) {
    app.commandLine.appendSwitch(name, value);
  }
};

module.exports = Object.freeze({
  NVIDIA_VENDOR,
  applyGpuPolicy,
  compositorSwitches,
  nvidiaRenderNode,
  readRenderNodes,
});
