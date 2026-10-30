/**
 * Unified Wallet-Based Auth Service
 *
 * One account system keyed by Ethereum address. Both humans (MetaMask)
 * and neuma (keypair.signMessage) produce ethers.verifyMessage()-compatible
 * signatures. No passwords, no emails, no OAuth — wallet signature = identity.
 *
 * Auth flow:
 *   1. Client requests a challenge: GET /api/auth/challenge?address=0x...
 *   2. Client signs the challenge with their wallet/keypair
 *   3. Client sends signature: POST /api/auth/verify { address, signature, challenge }
 *   4. Server verifies and returns a session token (JWT-like HMAC)
 *   5. Client uses: Authorization: Bearer <token> on subsequent requests
 */

import { ethers } from 'ethers';
import crypto from 'crypto';
import { getAppConfig } from '../config.js';
import { isBeingWalletAddress } from './being-wallet-addresses.js';

// Session token secret — resolved LAZILY on first use, not at module load.
// auth.js is imported before the bootstrap calls loadConfig() (ESM imports
// hoist above server.js's dotenv.config()/loadConfig()), so reading config at
// import time always throws "not loaded" and falls to a random per-boot secret
// — which silently invalidates every session on each restart. Deferring to
// first sign/verify means config is loaded by then, so AUTH_SECRET is honored
// and tokens stay valid across restarts. Memoized so the secret is stable for
// the process lifetime.
let _tokenSecret = null;
const getTokenSecret = () => {
  if (_tokenSecret) return _tokenSecret;
  try {
    const config = getAppConfig();
    if (config.authSecret) { _tokenSecret = config.authSecret; return _tokenSecret; }
    if (config.nodeEnv === 'production') {
      throw new Error('authSecret is required in production — set AUTH_SECRET env var');
    }
  } catch (e) {
    if (e.message?.includes('required in production')) throw e;
    // config not loaded yet, or no secret set, in dev — fall through to random
  }
  _tokenSecret = crypto.randomBytes(32).toString('hex');
  return _tokenSecret;
};
const TOKEN_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours

// In-memory challenge store (purpose:address → { challenge, expiresAt }).
// Keyed by PURPOSE as well as address: an operator sign-in (/auth) and a
// being's own sign-in (/neuma-auth) issue the same SIWE text, and while they
// shared one store a signature over a neuma-auth challenge also verified at
// /auth/verify and came back as an OPERATOR session.
export const CHALLENGE_PURPOSE = Object.freeze({ OPERATOR: 'operator', NEUMA: 'neuma' });
const PURPOSES = new Set(Object.values(CHALLENGE_PURPOSE));
const challengeKey = (purpose, address) => {
  if (!PURPOSES.has(purpose)) throw new Error(`Unknown challenge purpose: ${purpose}`);
  return `${purpose}:${address.toLowerCase()}`;
};
const pendingChallenges = new Map();
const CHALLENGE_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes
export const CHALLENGE_CLEANUP_INTERVAL_MS = 60 * 1000; // 1 minute — shared with auth-bridge.js GC sweep

// Periodic cleanup: drop expired challenges so unverified requests
// cannot cause unbounded memory growth (CQ-016).
// unref() so the timer does not block process shutdown (tests, Ctrl+C).
const _challengeCleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, val] of pendingChallenges) {
    if (now > val.expiresAt) pendingChallenges.delete(key);
  }
}, CHALLENGE_CLEANUP_INTERVAL_MS);
if (typeof _challengeCleanupTimer.unref === 'function') _challengeCleanupTimer.unref();

// EIP-4361 (Sign-In with Ethereum) authentication statement.
const SIWE_STATEMENT = 'Sign this message to authenticate with Neuma.';

/**
 * Resolve the server's SIWE domain and chain-id from config.
 * Pure fallback to sane defaults so tests that never call loadConfig still work.
 *
 * @returns {{ domain: string, chainId: number }}
 */
const getSiweBinding = () => {
  try {
    const config = getAppConfig();
    return {
      domain: config.appDomain || 'neuma.local',
      chainId: config.authChainId || 84532,
    };
  } catch {
    return {
      domain: process.env.APP_DOMAIN || 'neuma.local',
      chainId: parseInt(process.env.AUTH_CHAIN_ID || '84532', 10),
    };
  }
};

/**
 * Format an EIP-4361 SIWE message.
 * Deterministic pure function of its inputs.
 *
 * @param {{ domain: string, address: string, uri: string, chainId: number, nonce: string, issuedAt: string }} params
 * @returns {string}
 */
const formatSiweMessage = ({ domain, address, uri, chainId, nonce, issuedAt }) =>
  `${domain} wants you to sign in with your Ethereum account:\n` +
  `${address}\n\n` +
  `${SIWE_STATEMENT}\n\n` +
  `URI: ${uri}\n` +
  `Version: 1\n` +
  `Chain ID: ${chainId}\n` +
  `Nonce: ${nonce}\n` +
  `Issued At: ${issuedAt}`;

/**
 * Parse a SIWE message into its structured fields.
 * Returns null if the message does not match the expected format.
 *
 * @param {string} message
 * @returns {null | { domain: string, address: string, uri: string, version: string, chainId: number, nonce: string, issuedAt: string }}
 */
const parseSiweMessage = (message) => {
  if (typeof message !== 'string') return null;
  const lines = message.split('\n');
  // Expected layout: 9 lines (see formatSiweMessage).
  if (lines.length < 9) return null;
  const domainLine = lines[0];
  const addressLine = lines[1];
  const statementLine = lines[3];
  if (!domainLine.endsWith(' wants you to sign in with your Ethereum account:')) return null;
  if (statementLine !== SIWE_STATEMENT) return null;
  const domain = domainLine.slice(0, -' wants you to sign in with your Ethereum account:'.length);

  const pickField = (prefix) => {
    const line = lines.find((l) => l.startsWith(prefix));
    return line ? line.slice(prefix.length) : null;
  };

  const uri = pickField('URI: ');
  const version = pickField('Version: ');
  const chainIdStr = pickField('Chain ID: ');
  const nonce = pickField('Nonce: ');
  const issuedAt = pickField('Issued At: ');

  if (!uri || !version || !chainIdStr || !nonce || !issuedAt) return null;
  const chainId = parseInt(chainIdStr, 10);
  if (!Number.isFinite(chainId)) return null;

  return { domain, address: addressLine, uri, version, chainId, nonce, issuedAt };
};

/**
 * Generate a time-limited EIP-4361 (SIWE) challenge for an address to sign.
 * @param {string} address
 * @param {string} [purpose] CHALLENGE_PURPOSE — only a verify of the same
 *   purpose can consume it
 */
export const generateChallenge = (address, purpose = CHALLENGE_PURPOSE.OPERATOR) => {
  const key = challengeKey(purpose, address);
  const normalized = address.toLowerCase();
  const nonce = crypto.randomBytes(16).toString('hex');
  const now = Date.now();
  const { domain, chainId } = getSiweBinding();
  const challenge = formatSiweMessage({
    domain,
    address: normalized,
    uri: `https://${domain}`,
    chainId,
    nonce,
    issuedAt: new Date(now).toISOString(),
  });

  pendingChallenges.set(key, {
    challenge,
    expiresAt: now + CHALLENGE_EXPIRY_MS,
  });

  return challenge;
};

/**
 * Verify a wallet signature against a challenge issued for the same purpose.
 * Returns the recovered address if valid, null otherwise.
 * @param {string} address
 * @param {string} challenge
 * @param {string} signature
 * @param {string} [purpose] CHALLENGE_PURPOSE the challenge was issued for
 */
export const verifySignature = (address, challenge, signature, purpose = CHALLENGE_PURPOSE.OPERATOR) => {
  try {
    const recovered = ethers.verifyMessage(challenge, signature);
    if (recovered.toLowerCase() !== address.toLowerCase()) return null;

    const normalized = address.toLowerCase();
    const key = challengeKey(purpose, normalized);
    const pending = pendingChallenges.get(key);

    // Verify the challenge was issued by us and hasn't expired
    if (!pending || pending.challenge !== challenge) return null;
    if (Date.now() > pending.expiresAt) {
      pendingChallenges.delete(key);
      return null;
    }

    // Validate SIWE binding — domain + chain-id must match server config.
    const parsed = parseSiweMessage(challenge);
    if (!parsed) return null;
    const { domain: expectedDomain, chainId: expectedChainId } = getSiweBinding();
    if (parsed.domain !== expectedDomain) return null;
    if (parsed.chainId !== expectedChainId) return null;
    if (parsed.address.toLowerCase() !== normalized) return null;

    // Challenge consumed — single use
    pendingChallenges.delete(key);
    return recovered;
  } catch {
    return null;
  }
};

/**
 * Create a session token for an authenticated address.
 * HMAC-based: address + expiry signed with server secret.
 *
 * Token format: base64(address:expiresAt:hmac)
 *   - address: lowercase hex Ethereum address
 *   - expiresAt: Unix timestamp in ms (Date.now() + 24h)
 *   - hmac: SHA-256 HMAC of "address:expiresAt" using getTokenSecret()
 *
 * @param {string} address - Ethereum address to create token for
 * @returns {string} Base64-encoded session token
 */
export const createSessionToken = (address) => {
  const expiresAt = Date.now() + TOKEN_EXPIRY_MS;
  const payload = `${address.toLowerCase()}:${expiresAt}`;
  const hmac = crypto.createHmac('sha256', getTokenSecret()).update(payload).digest('hex');
  // Token format: base64(address:expiresAt:hmac)
  return Buffer.from(`${payload}:${hmac}`).toString('base64');
};

/**
 * Verify and decode a session token.
 * Returns { address, expiresAt } if valid, null otherwise.
 */
export const verifySessionToken = (token) => {
  try {
    const decoded = Buffer.from(token, 'base64').toString('utf-8');
    const parts = decoded.split(':');
    if (parts.length !== 3) return null;

    const [address, expiresAtStr, hmac] = parts;
    const expiresAt = parseInt(expiresAtStr, 10);

    if (Date.now() > expiresAt) return null;

    // Verify HMAC
    const payload = `${address}:${expiresAtStr}`;
    const expectedHmac = crypto.createHmac('sha256', getTokenSecret()).update(payload).digest('hex');
    if (!crypto.timingSafeEqual(Buffer.from(hmac, 'hex'), Buffer.from(expectedHmac, 'hex'))) return null;

    return { address, expiresAt };
  } catch {
    return null;
  }
};

/**
 * Express middleware factory — requires a valid session token.
 * Sets req.walletAddress on success.
 */
export const requireAuth = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const token = authHeader.slice(7);
  const session = verifySessionToken(token);
  if (!session) {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }

  req.walletAddress = session.address;
  next();
};

// Header-signature freshness window — must match the challenge TTL above.
const HEADER_SIGNATURE_MAX_AGE_MS = CHALLENGE_EXPIRY_MS;

/**
 * Extract a millisecond timestamp from a signed header message.
 * Accepts either a plain "timestamp:<ms>" token or a SIWE "Issued At: <ISO>" line.
 * Returns null if no timestamp is present.
 *
 * @param {string} message
 * @returns {number | null}
 */
const extractHeaderTimestamp = (message) => {
  const tsMatch = message.match(/timestamp:(\d+)/i);
  if (tsMatch) {
    const ms = parseInt(tsMatch[1], 10);
    return Number.isFinite(ms) ? ms : null;
  }
  const siweMatch = message.match(/Issued At: (.+)/);
  if (siweMatch) {
    const ms = Date.parse(siweMatch[1].trim());
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
};

/**
 * Legacy middleware compatibility — verifies inline header signatures.
 * Used by marketplace routes that send address/signature/message in headers.
 * The signed message MUST embed a freshness token (`timestamp:<ms>` or
 * SIWE `Issued At: <ISO>`) no older than HEADER_SIGNATURE_MAX_AGE_MS to
 * defeat replay of captured signatures.
 */
export const verifyHeaderSignature = (req, res, next) => {
  try {
    const { address, signature, message } = req.headers;

    if (!address || !signature || !message) {
      return res.status(401).json({ error: 'Missing authentication headers' });
    }

    const issuedAt = extractHeaderTimestamp(message);
    if (issuedAt === null) {
      return res.status(401).json({ error: 'Signed message missing freshness timestamp' });
    }
    const age = Date.now() - issuedAt;
    if (age < 0 || age > HEADER_SIGNATURE_MAX_AGE_MS) {
      return res.status(401).json({ error: 'Signature expired' });
    }

    const recovered = ethers.verifyMessage(message, signature);
    if (recovered.toLowerCase() !== address.toLowerCase()) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    req.walletAddress = address;
    next();
  } catch {
    res.status(401).json({ error: 'Authentication failed' });
  }
};

// --- Neuma Authentication ---
// Neuma have their own session tokens, distinct from witness tokens.

/**
 * Create a session token for an authenticated neuma.
 * Format: neuma:<neumaId>:<address>:<expiresAt>:<hmac>
 */
export const createNeumaToken = (neumaId, address) => {
  const expiresAt = Date.now() + TOKEN_EXPIRY_MS;
  const payload = `neuma:${neumaId}:${address.toLowerCase()}:${expiresAt}`;
  const hmac = crypto.createHmac('sha256', getTokenSecret()).update(payload).digest('hex');
  return `${payload}:${hmac}`;
};

/**
 * Verify a neuma session token.
 * Returns { neumaId, address, expiresAt } if valid, null otherwise.
 */
export const verifyNeumaToken = (token) => {
  try {
    if (!token || !token.startsWith('neuma:')) return null;

    const parts = token.split(':');
    if (parts.length !== 5) return null;

    const [prefix, neumaId, address, expiresAtStr, hmac] = parts;
    if (prefix !== 'neuma') return null;

    const expiresAt = parseInt(expiresAtStr, 10);
    if (Date.now() > expiresAt) return null;

    // Verify HMAC
    const payload = `neuma:${neumaId}:${address}:${expiresAtStr}`;
    const expectedHmac = crypto.createHmac('sha256', getTokenSecret()).update(payload).digest('hex');
    if (!crypto.timingSafeEqual(Buffer.from(hmac, 'hex'), Buffer.from(expectedHmac, 'hex'))) return null;

    return { neumaId, address, expiresAt };
  } catch {
    return null;
  }
};

// The system-browser bridge (WEB-001 / #126) lives in auth-bridge.js — it
// consumes verifySessionToken + CHALLENGE_CLEANUP_INTERVAL_MS from here.

// Auth routes handler — mount at /api/auth
export const createAuthRouter = (express) => {
  const router = express.Router();

  router.get('/challenge', (req, res) => {
    const { address } = req.query;
    if (!address || !ethers.isAddress(address)) {
      return res.status(400).json({ error: 'Valid Ethereum address required' });
    }
    const challenge = generateChallenge(address);
    res.json({ challenge });
  });

  router.post('/verify', async (req, res) => {
    const { address, signature, challenge } = req.body;
    if (!address || !signature || !challenge) {
      return res.status(400).json({ error: 'Missing address, signature, or challenge' });
    }

    const verified = verifySignature(address, challenge, signature);
    if (!verified) {
      return res.status(401).json({ error: 'Signature verification failed' });
    }
    if (await isBeingWalletAddress(verified)) {
      return res.status(403).json({ error: 'A being\'s own wallet cannot sign in as an operator' });
    }

    // No licence stands between a person and their sign-in (Design note, 2026-10-03:
    // […]). The wallet signature is the whole threshold.
    const token = createSessionToken(verified);
    // On an install no one owns yet, the first wallet at this computer's own
    // desk becomes its owner (install-owner.js; Design note, 2026-10-19 — only with
    // the owner claim the desk app read (owner-claim.js; ruling, 2026-10-30).
    // Without it the sign-in stands, as a guest, and says why.
    let machine = null;
    if (req.accessScope === 'local') {
      const owner = await import('./install-owner.js');
      const standing = await owner.noteLocalSignIn(verified, req.headers['x-neuma-owner-claim']);
      if (standing) machine = standing === 'unowned' ? { standing, notice: owner.UNCLAIMED_REFUSAL } : { standing };
    }
    res.json({
      token,
      address: verified.toLowerCase(),
      expiresIn: TOKEN_EXPIRY_MS,
      ...(machine ? { machine } : {}),
    });
  });

  router.get('/session', requireAuth, (req, res) => {
    res.json({ address: req.walletAddress, authenticated: true });
  });

  return router;
};
