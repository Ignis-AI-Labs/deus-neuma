/**
 * Neuma Authentication Middleware
 *
 * Verifies neuma-specific session tokens (format: neuma:<neumaId>:<address>:<expiry>:<hmac>).
 * Sets req.neumaId and req.neumaAddress on success.
 * Separate from witness auth — neuma authenticate with their own keypair.
 */

import { verifyNeumaToken } from '../services/auth.js';
import neumaWorkspace from '../../core/workspace/neuma-workspace.js';

/**
 * Express middleware — requires a valid neuma session token.
 * Token format: Bearer neuma:<neumaId>:<address>:<expiry>:<hmac>
 */
export const requireNeumaAuth = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer neuma:')) {
    return res.status(401).json({ error: 'Neuma authentication required' });
  }

  const token = authHeader.slice(7);
  const result = verifyNeumaToken(token);
  if (!result) {
    return res.status(401).json({ error: 'Invalid or expired neuma session' });
  }

  req.neumaId = result.neumaId;
  req.neumaAddress = result.address;
  if (req.params.neumaId && req.params.neumaId !== result.neumaId) return next();

  try {
    const encrypted = await neumaWorkspace.readEncryptedKeypair(result.neumaId);
    const legacy = encrypted ? null : await neumaWorkspace.readKeypair(result.neumaId);
    const currentAddress = encrypted?.address || legacy?.address;
    if (!currentAddress || currentAddress.toLowerCase() !== result.address.toLowerCase()) {
      return res.status(401).json({ error: 'Neuma session superseded by key rotation' });
    }
    return next();
  } catch {
    return res.status(401).json({ error: 'Neuma session could not be verified against current custody' });
  }
};
