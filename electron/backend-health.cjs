// Authenticated loopback health: the per-launch token never crosses HTTP.
const { createHmac, randomBytes, timingSafeEqual } = require('node:crypto');
const http = require('node:http');

const CHALLENGE_HEADER = 'x-neuma-desk-challenge';
const PROOF_HEADER = 'x-neuma-desk-proof';
const newDeskToken = () => randomBytes(32).toString('base64url');
const healthProof = (token, challenge) => createHmac('sha256', String(token))
  .update(`neuma-desk-health-v1\0${String(challenge)}`).digest('base64url');

const proofMatches = (token, challenge, actual) => {
  if (typeof actual !== 'string') return false;
  const expected = Buffer.from(healthProof(token, challenge));
  const received = Buffer.from(actual);
  return expected.length === received.length && timingSafeEqual(expected, received);
};

// impure — poll real HTTP until the child proves this launch's token or time runs out.
const waitForBackendHealth = ({ origin, token, timeoutMs = 30000 }) => new Promise((resolve, reject) => {
  if (typeof token !== 'string' || token.length < 32) {
    reject(new Error('backend did not provide its launch credential'));
    return;
  }
  const start = Date.now();
  let settled = false;
  const finish = (done, value) => { if (!settled) { settled = true; done(value); } };
  const retry = () => {
    if (settled) return;
    if (Date.now() - start > timeoutMs) finish(reject, new Error('backend did not prove its launch identity'));
    else setTimeout(ping, 300);
  };
  const ping = () => {
    if (settled) return;
    const challenge = randomBytes(18).toString('base64url');
    http.get(`${origin}/api/v1/health`, { headers: { [CHALLENGE_HEADER]: challenge } }, (res) => {
      const valid = res.statusCode === 200 && proofMatches(token, challenge, res.headers[PROOF_HEADER]);
      res.resume();
      if (valid) finish(resolve);
      else retry();
    }).on('error', retry);
  };
  ping();
});

module.exports = { CHALLENGE_HEADER, PROOF_HEADER, newDeskToken, healthProof, proofMatches, waitForBackendHealth };
