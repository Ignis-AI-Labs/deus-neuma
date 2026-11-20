/* global URL, process */
// Direct servers get an explicit engine credential derived by production code. Spawned stand-ins
// inherit that derived key and engine through their environment. Neither path reads a real key file.
import { randomBytes } from 'node:crypto';
import { engineIdentityProof, engineKey } from '../../backend/services/voice/sidecar-trust.js';

/**
 * Give a direct stand-in its own derived credential, with a throwaway root when the file has none.
 * impure (test-local environment)
 */
export const directSidecarCredential = (engine) => {
  const previous = process.env.NEUMA_SIDECAR_KEY;
  const root = previous || randomBytes(32).toString('hex');
  process.env.NEUMA_SIDECAR_KEY = root;
  return Object.freeze({
    engine,
    key: engineKey(root, engine).toString('hex'),
    restore: () => {
      if (previous === undefined) delete process.env.NEUMA_SIDECAR_KEY;
      else process.env.NEUMA_SIDECAR_KEY = previous;
    },
  });
};

/**
 * Answer GET /identity?challenge=…&socket=… with the real engine/socket proof. impure (response)
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {{engine: string, key: string}} [credential] direct credential; spawned stand-ins use env
 * @returns {boolean} true when answered
 */
export const answerIdentity = (req, res, credential = {
  engine: process.env.NEUMA_SIDECAR_ENGINE,
  key: process.env.NEUMA_SIDECAR_KEY,
}) => {
  const url = new URL(req.url, 'http://stand-in');
  if (url.pathname !== '/identity') return false;
  const host = req.socket.localAddress === '::1' ? '[::1]' : '127.0.0.1';
  const socket = `${host}:${req.socket.localPort}`;
  const challenge = url.searchParams.get('challenge') || '';
  const valid = credential?.engine && credential?.key && url.searchParams.get('socket') === socket;
  const proof = valid
    ? engineIdentityProof(credential.key, credential.engine, challenge, socket) : '';
  res.writeHead(proof ? 200 : 403, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ proof }));
  return true;
};
