/**
 * User chat labels — the witness's own names for their chats. A chat is a
 * neuma's workspace session; its default label is just its timestamp. A custom
 * label is the witness's organizational overlay (like naming a file) — kept per
 * wallet in the user realm, never touching the neuma's sovereign session data.
 * Reuses the same walletDir traversal guard. IO isolated and marked.
 */
import fs from 'fs/promises';
import path from 'path';
import { walletDir, writeJsonAtomic } from './user-realm.js';

const MAX_LABEL = 120;
const ID_RE = /^[a-zA-Z0-9_-]+$/;

const labelsPath = (wallet) => path.join(walletDir(wallet), 'chat-labels.json');

const keyOf = (neumaId, sessionId) => {
  if (!ID_RE.test(neumaId || '') || !ID_RE.test(sessionId || '')) {
    throw new Error('Invalid neumaId or sessionId');
  }
  return `${neumaId}:${sessionId}`;
};

// impure — read the label map; a missing file is an empty map, not an error.
export const getChatLabels = async (wallet) => {
  try {
    const parsed = JSON.parse(await fs.readFile(labelsPath(wallet), 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw err;
  }
};

/**
 * Set a chat's custom label — or clear it when the label is empty (reverting to
 * the timestamp). Returns the full updated label map.
 * @param {string} wallet
 * @param {string} neumaId
 * @param {string} sessionId
 * @param {string} label
 * @returns {Promise<Object>}
 */
// impure — set or clear (empty label) a chat's name → the updated label map.
export const setChatLabel = async (wallet, neumaId, sessionId, label) => {
  const key = keyOf(neumaId, sessionId);
  const labels = await getChatLabels(wallet);
  const trimmed = typeof label === 'string' ? label.trim().slice(0, MAX_LABEL) : '';
  if (trimmed) labels[key] = trimmed; else delete labels[key];
  await writeJsonAtomic(labelsPath(wallet), labels);
  return labels;
};
