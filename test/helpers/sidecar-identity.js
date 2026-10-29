// What every stand-in sidecar answers to the backend's identity challenge (re-audit 2026-10-29,
// M-06): the proof the real sidecars compute in voice-engines/_shared/browser_guard.py, over the
// install key this test's backend holds (NEUMA_SIDECAR_KEY, else the key file in the isolated
// settings dir — a spawned stand-in inherits both). Computed by the backend's own identityProof, so
// a stand-in proves itself exactly as an honest sidecar does and an impostor cannot.
import { identityProof, sidecarKey } from '../../backend/services/voice/sidecar-trust.js';

/**
 * Answer GET /identity?challenge=… when this request is one. impure (writes the response)
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @returns {boolean} true when answered
 */
export const answerIdentity = (req, res) => {
  const url = new URL(req.url, 'http://stand-in');
  if (url.pathname !== '/identity') return false;
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ proof: identityProof(sidecarKey(), url.searchParams.get('challenge') || '') }));
  return true;
};
