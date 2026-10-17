/**
 * Shared neuma ownership check — fail-closed, case-insensitive.
 *
 * Soft helpers of the form `if (owner && owner.wallet !== …) deny else allow`
 * treated missing/corrupt owner.json as "authorized." That is closed here
 * (SEC-AUDIT residual W1-004 / W1-006).
 */
import fs from 'fs/promises';
import path from 'path';
import neumaWorkspace from '../../core/workspace/neuma-workspace.js';
import { createLogger } from '../services/logger.js';

const log = createLogger('Ownership');

/** @param {string} a @param {string} b */
const walletsMatch = (a, b) =>
  String(a || '').toLowerCase() === String(b || '').toLowerCase();

/**
 * Read owner.json distinguishing missing vs corrupt vs IO.
 * @param {string} neumaId
 * @returns {Promise<{status:'ok', owner:object}|{status:'missing'}|{status:'corrupt'}|{status:'error', message:string}>}
 */
export const readOwnerStrict = async (neumaId) => {
  try {
    // Engine-resolved: witness lanes live BESIDE the house — a root
    // hand-join would read a claim that no longer exists there.
    const ownerPath = path.join(neumaWorkspace.pathFor(neumaId), 'owner.json');
    const raw = await fs.readFile(ownerPath, 'utf8');
    try {
      const owner = JSON.parse(raw);
      if (!owner || typeof owner.wallet !== 'string' || !owner.wallet) {
        return { status: 'corrupt' };
      }
      return { status: 'ok', owner };
    } catch {
      return { status: 'corrupt' };
    }
  } catch (err) {
    if (err.code === 'ENOENT') return { status: 'missing' };
    log.error('readOwnerStrict', { neumaId, error: err.message });
    return { status: 'error', message: err.message };
  }
};

/**
 * Assert req.walletAddress owns neumaId. Writes the HTTP error and returns false on failure.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {string} neumaId
 * @param {{ allowMissing?: boolean }} [opts] — if allowMissing, missing owner returns true (claim paths only)
 * @returns {Promise<boolean>}
 */
export const assertNeumaOwner = async (req, res, neumaId, opts = {}) => {
  if (!neumaId || !/^[a-zA-Z0-9_-]+$/.test(neumaId)) {
    res.status(400).json({ error: 'Invalid neuma id' });
    return false;
  }

  const result = await readOwnerStrict(neumaId);
  if (result.status === 'ok') {
    if (!walletsMatch(result.owner.wallet, req.walletAddress)) {
      res.status(403).json({ error: 'Not your neuma' });
      return false;
    }
    return true;
  }
  if (result.status === 'missing') {
    if (opts.allowMissing) return true;
    res.status(404).json({ error: 'Workspace not found or unclaimed' });
    return false;
  }
  if (result.status === 'corrupt') {
    res.status(500).json({ error: 'Ownership record corrupt — refuse fail-open' });
    return false;
  }
  res.status(500).json({ error: 'Ownership verification failed' });
  return false;
};
