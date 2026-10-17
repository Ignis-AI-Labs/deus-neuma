import {
  generateChallenge,
  verifySignature,
  createSessionToken,
  verifySessionToken,
  verifyHeaderSignature,
} from '../../backend/services/auth.js';
import { generateKeypair, signMessage } from '../../core/weave/keypair.js';

// SIWE tests rely on the default config fallback — domain: 'neuma.local',
// chain-id: 84532 (Base Sepolia).

describe('Auth Service', () => {
  let keypair;

  beforeAll(() => {
    keypair = generateKeypair();
  });

  describe('generateChallenge', () => {
    test('generates an EIP-4361 (SIWE) challenge for an address', () => {
      const challenge = generateChallenge(keypair.address);
      expect(challenge).toContain('neuma.local wants you to sign in with your Ethereum account:');
      expect(challenge).toContain(keypair.address.toLowerCase());
      expect(challenge).toContain('Sign this message to authenticate with Neuma.');
      expect(challenge).toContain('URI: https://neuma.local');
      expect(challenge).toContain('Version: 1');
      expect(challenge).toContain('Chain ID: 84532');
      expect(challenge).toMatch(/Nonce: [a-f0-9]{32}/);
      expect(challenge).toMatch(/Issued At: \d{4}-\d{2}-\d{2}T/);
    });

    test('generates unique challenges', () => {
      const c1 = generateChallenge(keypair.address);
      const c2 = generateChallenge(keypair.address);
      expect(c1).not.toBe(c2);
    });
  });

  describe('verifySignature', () => {
    test('verifies a valid wallet signature against a challenge', async () => {
      const challenge = generateChallenge(keypair.address);
      const signature = await signMessage(keypair.privateKey, challenge);
      const result = verifySignature(keypair.address, challenge, signature);
      expect(result).toBe(keypair.address);
    });

    test('rejects a signature from wrong address', async () => {
      const other = generateKeypair();
      const challenge = generateChallenge(keypair.address);
      const signature = await signMessage(other.privateKey, challenge);
      const result = verifySignature(keypair.address, challenge, signature);
      expect(result).toBe(null);
    });

    test('rejects a challenge not issued by us', async () => {
      const fakeChallenge = 'fake challenge message';
      const signature = await signMessage(keypair.privateKey, fakeChallenge);
      const result = verifySignature(keypair.address, fakeChallenge, signature);
      expect(result).toBe(null);
    });

    test('challenge is single-use', async () => {
      const challenge = generateChallenge(keypair.address);
      const signature = await signMessage(keypair.privateKey, challenge);

      // First use succeeds
      const result1 = verifySignature(keypair.address, challenge, signature);
      expect(result1).toBe(keypair.address);

      // Second use fails (challenge consumed)
      const result2 = verifySignature(keypair.address, challenge, signature);
      expect(result2).toBe(null);
    });
  });

  describe('verifyHeaderSignature', () => {
    const runMiddleware = async (headers) => {
      const req = { headers };
      const res = {
        statusCode: 200,
        body: null,
        status(code) { this.statusCode = code; return this; },
        json(payload) { this.body = payload; return this; },
      };
      let nextCalled = false;
      await verifyHeaderSignature(req, res, () => { nextCalled = true; });
      return { req, res, nextCalled };
    };

    test('accepts a fresh signed message with embedded timestamp', async () => {
      const message = `marketplace:listing:create timestamp:${Date.now()}`;
      const signature = await signMessage(keypair.privateKey, message);
      const { nextCalled, res } = await runMiddleware({
        address: keypair.address,
        signature,
        message,
      });
      expect(nextCalled).toBe(true);
      expect(res.statusCode).toBe(200);
    });

    test('rejects a replayed (stale) signature older than 5 minutes', async () => {
      const staleTs = Date.now() - (6 * 60 * 1000);
      const message = `marketplace:listing:create timestamp:${staleTs}`;
      const signature = await signMessage(keypair.privateKey, message);
      const { nextCalled, res } = await runMiddleware({
        address: keypair.address,
        signature,
        message,
      });
      expect(nextCalled).toBe(false);
      expect(res.statusCode).toBe(401);
      expect(res.body.error).toBe('Signature expired');
    });

    test('rejects a message with no freshness timestamp', async () => {
      const message = 'marketplace:listing:create';
      const signature = await signMessage(keypair.privateKey, message);
      const { nextCalled, res } = await runMiddleware({
        address: keypair.address,
        signature,
        message,
      });
      expect(nextCalled).toBe(false);
      expect(res.statusCode).toBe(401);
      expect(res.body.error).toBe('Signed message missing freshness timestamp');
    });
  });

  describe('session tokens', () => {
    test('creates and verifies a session token', () => {
      const token = createSessionToken(keypair.address);
      expect(typeof token).toBe('string');
      expect(token.length).toBeGreaterThan(0);

      const session = verifySessionToken(token);
      expect(session).not.toBe(null);
      expect(session.address).toBe(keypair.address.toLowerCase());
      expect(session.expiresAt).toBeGreaterThan(Date.now());
    });

    test('rejects a tampered token', () => {
      const token = createSessionToken(keypair.address);
      const tampered = token.slice(0, -5) + 'XXXXX';
      const session = verifySessionToken(tampered);
      expect(session).toBe(null);
    });

    test('rejects a completely invalid token', () => {
      expect(verifySessionToken('not-a-real-token')).toBe(null);
      expect(verifySessionToken('')).toBe(null);
    });
  });
});
