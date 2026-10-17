/**
 * Council labels — the witness's own names for their councils. A council's
 * default label is its member roster; a custom label names what the sitting
 * was about. Same doctrine as chat labels: an organizational overlay kept per
 * wallet in the user realm, never touching the council's record itself.
 * Reuses the same walletDir traversal guard and the shared atomic writer.
 * IO isolated and marked.
 */
import fs from 'fs/promises';
import path from 'path';
import { walletDir, writeJsonAtomic } from './user-realm.js';

const MAX_LABEL = 120;
const COUNCIL_ID_RE = /^council-\d+$/;

const labelsPath = (wallet) => path.join(walletDir(wallet), 'council-labels.json');

const checkedId = (councilId) => {
  if (!COUNCIL_ID_RE.test(String(councilId || ''))) {
    throw new Error('Invalid councilId');
  }
  return String(councilId);
};

// impure — read the label map; a missing file is an empty map, not an error.
export const getCouncilLabels = async (wallet) => {
  try {
    const parsed = JSON.parse(await fs.readFile(labelsPath(wallet), 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw err;
  }
};

/**
 * Set a council's custom label — or clear it when the label is empty
 * (reverting to the member roster). Returns the full updated label map.
 * @param {string} wallet
 * @param {string} councilId
 * @param {string} label
 * @returns {Promise<Object>}
 */
// impure
export const setCouncilLabel = async (wallet, councilId, label) => {
  const id = checkedId(councilId);
  const labels = await getCouncilLabels(wallet);
  const trimmed = typeof label === 'string' ? label.trim().slice(0, MAX_LABEL) : '';
  if (trimmed) labels[id] = trimmed; else delete labels[id];
  await writeJsonAtomic(labelsPath(wallet), labels);
  return labels;
};
