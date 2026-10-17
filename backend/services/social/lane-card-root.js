/** A derived card directory grants no authority outside its existing lane. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { loadHouseWorkspace } from '../house-workspace.js';

/** impure — read existing ground only; absence grants nothing.
 * @param {string|null} wallet
 * @param {string|null} laneId
 * @returns {Promise<string|null>}
 */
export const laneCardRoot = async (wallet, laneId) => {
  if (!wallet || !/^[a-zA-Z0-9_-]+$/.test(String(laneId || ''))) return null;
  try {
    const { root } = await loadHouseWorkspace(wallet);
    if (!root) return null;
    const house = await fs.realpath(root);
    const cards = path.join(house, 'workspaces', laneId, 'cards');
    return await fs.realpath(cards) === cards ? cards : null;
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null;
    throw error;
  }
};
