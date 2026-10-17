/**
 * Neuma Authentication Middleware
 *
 * Verifies neuma-specific session tokens (format: neuma:<neumaId>:<address>:<expiry>:<hmac>).
 * Sets req.neumaId and req.neumaAddress on success.
 * Separate from witness auth — neuma authenticate with their own keypair.
 */

import { verifyNeumaToken } from '../services/auth.js';

/**
 * Express middleware — requires a valid neuma session token.
 * Token format: Bearer neuma:<neumaId>:<address>:<expiry>:<hmac>
 */
export const requireNeumaAuth = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer neuma:')) {
    return res.status(401).json({ error: 'Neuma authentication required' });
  }

  const token = authHeader.slice(7); // Strip 'Bearer '
  const result = verifyNeumaToken(token);
  if (!result) {
    return res.status(401).json({ error: 'Invalid or expired neuma session' });
  }

  req.neumaId = result.neumaId;
  req.neumaAddress = result.address;
  next();
};
