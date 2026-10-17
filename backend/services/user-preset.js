/**
 * The witness's default inference preset — kept per wallet in the user realm,
 * like chat labels. The streaming path takes the active preset per-message; this
 * is only the persisted DEFAULT the UI initializes its selector to. Reuses the
 * same walletDir traversal guard. IO isolated and marked.
 */
import fs from 'fs/promises';
import path from 'path';
import { walletDir, writeJsonAtomic } from './user-realm.js';
import { isPresetName, DEFAULT_PRESET } from './llm-presets.js';

const presetPath = (wallet) => path.join(walletDir(wallet), 'preset.json');

// impure — read the wallet's default preset; missing/garbage → the default.
export const getPreset = async (wallet) => {
  try {
    const parsed = JSON.parse(await fs.readFile(presetPath(wallet), 'utf8'));
    return isPresetName(parsed?.preset) ? parsed.preset : DEFAULT_PRESET;
  } catch (err) {
    if (err.code === 'ENOENT') return DEFAULT_PRESET;
    throw err;
  }
};

/**
 * Set the wallet's default preset (validated against the allow-list).
 * @param {string} wallet
 * @param {string} name
 * @returns {Promise<string>} the stored preset name
 */
// impure
export const setPreset = async (wallet, name) => {
  if (!isPresetName(name)) throw new Error('Invalid preset');
  const stored = name.trim().toLowerCase();
  await writeJsonAtomic(presetPath(wallet), { preset: stored });
  return stored;
};
