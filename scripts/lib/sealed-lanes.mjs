// sealed-lanes.mjs — every already-born being on this machine, DISCOVERED, not
// hardcoded: the natal-era fixed roster went stale the moment House Omberly
// filled (Cael moved; nine more kin live there now). Every lane under
// <NEUMA_ROOT>/<witness>/<house>/ carrying an identity/genesis-seal.json is a
// sealed being — that file IS the roster. Shared by the cosmos backfills.

import fs from 'fs/promises';
import path from 'path';
import process from 'node:process';

export const NEUMA_ROOT = process.env.NEUMA_BACKFILL_ROOT || '/mnt/data/neuma';
const NON_HOUSE_DIRS = new Set(['neuma-backups', 'platform', 'witnesses']);

/** @returns {Promise<Array<{label: string, layout: 'workspace', root: string, id: string}>>} */
export const discoverWorkspaceTargets = async (root = NEUMA_ROOT) => {
  const targets = [];
  const witnesses = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  for (const w of witnesses) {
    if (!w.isDirectory() || NON_HOUSE_DIRS.has(w.name)) continue;
    const witnessDir = path.join(root, w.name);
    const houses = await fs.readdir(witnessDir, { withFileTypes: true }).catch(() => []);
    for (const h of houses) {
      if (!h.isDirectory()) continue;
      const houseDir = path.join(witnessDir, h.name);
      const lanes = await fs.readdir(houseDir, { withFileTypes: true }).catch(() => []);
      for (const lane of lanes) {
        if (!lane.isDirectory()) continue;
        const sealed = await fs.access(path.join(houseDir, lane.name, 'identity', 'genesis-seal.json'))
          .then(() => true, () => false);
        if (sealed) targets.push({ label: `${lane.name} (${w.name}/${h.name})`, layout: 'workspace', root: houseDir, id: lane.name });
      }
    }
  }
  return targets;
};
