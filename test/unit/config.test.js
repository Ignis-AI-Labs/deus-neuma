import { describe, it, expect, beforeEach } from 'vitest';
import { loadConfig, getAppConfig, getAllowedOrigins, isSameOriginLoopback, getAdminWallets, isProduction, _resetConfig, setBoundPort } from '../../backend/config.js';

describe('backend/config.js', () => {
  beforeEach(() => {
    _resetConfig();
  });

  describe('loadConfig()', () => {
    it('returns frozen config with defaults when env is empty', () => {
      const config = loadConfig({});
      expect(config.port).toBe(3333);
      expect(config.host).toBe('127.0.0.1');
      expect(config.frontendPort).toBe(7777);
      expect(config.nodeEnv).toBe('development');
      expect(config.llmProvider).toBe('llama-server');
      expect(config.llmTemperature).toBe(0.8);
      expect(config.llmMaxTokens).toBe(4096);
      expect(config.llmTopP).toBe(0.95);
      expect(config.ethRpcUrl).toBe('https://ethereum-rpc.publicnode.com'); // Ethereum mainnet's public endpoint since 2026-10-04
      expect(config.ipfsGateway).toBe('https://ipfs.io/ipfs/');
      expect(Object.isFrozen(config)).toBe(true);
    });

    it('coerces PORT to number', () => {
      const config = loadConfig({ PORT: '8080' });
      expect(config.port).toBe(8080);
      expect(typeof config.port).toBe('number');
    });

    it('accepts PORT=0 for a kernel-assigned test or probe port', () => {
      expect(loadConfig({ PORT: '0' }).port).toBe(0);
    });

    it('reads HOST override (M-2 bind address)', () => {
      const config = loadConfig({ HOST: '0.0.0.0' });
      expect(config.host).toBe('0.0.0.0');
    });

    it('coerces CHAIN_ID to number', () => {
      const config = loadConfig({ CHAIN_ID: '11155111' });
      expect(config.chainId).toBe(11155111);
    });

    it('coerces LLM temperature/maxTokens/topP to numbers', () => {
      const config = loadConfig({
        LM_STUDIO_DEFAULT_TEMPERATURE: '0.5',
        LM_STUDIO_DEFAULT_MAX_TOKENS: '8192',
        LM_STUDIO_DEFAULT_TOP_P: '0.9',
      });
      expect(config.llmTemperature).toBe(0.5);
      expect(config.llmMaxTokens).toBe(8192);
      expect(config.llmTopP).toBe(0.9);
    });

    it('maps SCREAMING_SNAKE to camelCase', () => {
      const config = loadConfig({
        LLM_PROVIDER: 'anthropic',
        ANTHROPIC_API_KEY: 'sk-ant-test',
        ADMIN_WALLETS: '0xabc,0xdef',
      });
      expect(config.llmProvider).toBe('anthropic');
      expect(config.anthropicApiKey).toBe('sk-ant-test');
      expect(config.adminWallets).toBe('0xabc,0xdef');
    });

    it('validates LLM_PROVIDER enum', () => {
      expect(() => loadConfig({ LLM_PROVIDER: 'invalid-provider' })).toThrow('Config validation failed');
    });

    it('validates NODE_ENV enum', () => {
      expect(() => loadConfig({ NODE_ENV: 'staging' })).toThrow('Config validation failed');
    });

    it('ignores empty string env vars (uses defaults)', () => {
      const config = loadConfig({ PORT: '', LLM_PROVIDER: '' });
      expect(config.port).toBe(3333);
      expect(config.llmProvider).toBe('llama-server');
    });
  });

  describe('seal network config (mainnet-through-portal law)', () => {
    // The default flipped on 2026-08-07 and this assertion did not follow it.
    // backend/config.js:92-98 states the reason: […] So BOTH halves of the
    // old law are gone: ceremony seals default to MAINNET, and the mainnet RPC
    // now carries a public default instead of being empty. Test rigs and dev
    // walks opt OUT with CEREMONY_SEAL_NETWORK=base-sepolia, which the sibling
    // case below pins.
    //
    // Third stale assertion from this one flip — the other two were the seal
    // preflight cases in #309, which failed for exactly the same reason.
    it('defaults: ceremony seals anchor on MAINNET (the shipped app has no .env); mainnet addresses = real deployment', () => {
      const config = loadConfig({});
      // Ethereum mainnet since 2026-10-04 (Base is left; its seals stay readable)
      expect(config.ceremonySealNetwork).toBe('ethereum');
      expect(config.ethRpcUrl).toBe('https://ethereum-rpc.publicnode.com');
      expect(config.natalisEthAddress).toBe('0xcda0b092c87637276972de0ea8b5005672775f11'); // UNAVIS mainnet, 2026-10-05
      expect(config.houseRegistryEthAddress).toBe('0xf9159a8696ba2454866735454cac7aee1bbdc4eb');
      expect(config.baseMainnetRpcUrl).toBe('https://mainnet.base.org');
      expect(config.natalisMainnetAddress).toBe('0x88a7229afeb4deba8c27edad788ac723697dde78');
      expect(config.houseRegistryMainnetAddress).toBe('0x526c6a062db774997955816c03df49b60260b883');
    });

    it('CEREMONY_SEAL_NETWORK=base-sepolia opts a test rig DOWN to testnet', () => {
      expect(loadConfig({ CEREMONY_SEAL_NETWORK: 'base-sepolia' }).ceremonySealNetwork).toBe('base-sepolia');
    });

    it('the FOUNDING defaults to MAINNET — the official recognition targets the real chain (Design note, 2026-07-16', () => {
      const config = loadConfig({});
      expect(config.houseFoundNetwork).toBe('ethereum');
    });

    it('HOUSE_FOUND_NETWORK=base-sepolia opts a rehearsal desk down to testnet', () => {
      const config = loadConfig({ HOUSE_FOUND_NETWORK: 'base-sepolia' });
      expect(config.houseFoundNetwork).toBe('base-sepolia');
    });

    it('CEREMONY_SEAL_NETWORK=base opens mainnet ceremonies (operator decision)', () => {
      const config = loadConfig({
        CEREMONY_SEAL_NETWORK: 'base',
        BASE_MAINNET_RPC_URL: 'https://mainnet.base.org',
      });
      expect(config.ceremonySealNetwork).toBe('base');
      expect(config.baseMainnetRpcUrl).toBe('https://mainnet.base.org');
    });

    it('rejects a network outside the seal registry', () => {
      expect(() => loadConfig({ CEREMONY_SEAL_NETWORK: 'goerli' })).toThrow('Config validation failed');
    });
  });

  describe('production enforcement', () => {
    it('throws when DNA_ENCRYPTION_KEY missing in production', () => {
      expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(
        'DNA_ENCRYPTION_KEY is required in production'
      );
    });

    it('throws when DNA_ENCRYPTION_KEY is not provided in production', () => {
      expect(() => loadConfig({
        NODE_ENV: 'production',
        // No DNA_ENCRYPTION_KEY — falls back to random dev default, which should be rejected
      })).toThrow('DNA_ENCRYPTION_KEY is required in production');
    });

    it('accepts strong key in production (AUTH_SECRET also required per W1-009)', () => {
      const config = loadConfig({
        NODE_ENV: 'production',
        DNA_ENCRYPTION_KEY: 'a-real-production-key-that-is-strong-enough',
        AUTH_SECRET: 'an-auth-secret-at-least-16-chars',
      });
      expect(config.nodeEnv).toBe('production');
      expect(config.dnaEncryptionKey).toBe('a-real-production-key-that-is-strong-enough');
    });

    it('refuses production without AUTH_SECRET (W1-009 — fail at load, not first token)', () => {
      expect(() => loadConfig({
        NODE_ENV: 'production',
        DNA_ENCRYPTION_KEY: 'a-real-production-key-that-is-strong-enough',
      })).toThrow('AUTH_SECRET is required in production');
    });
  });

  describe('getAppConfig()', () => {
    it('throws when config not loaded', () => {
      expect(() => getAppConfig()).toThrow('Config not loaded');
    });

    it('returns loaded config', () => {
      loadConfig({});
      const config = getAppConfig();
      expect(config.port).toBe(3333);
    });
  });

  describe('isProduction()', () => {
    it('returns false for development', () => {
      loadConfig({});
      expect(isProduction()).toBe(false);
    });

    it('returns true for production', () => {
      loadConfig({ NODE_ENV: 'production', DNA_ENCRYPTION_KEY: 'strong-key-32-chars-minimum-ok!', AUTH_SECRET: 'an-auth-secret-at-least-16-chars' });
      expect(isProduction()).toBe(true);
    });
  });

  describe('getAllowedOrigins()', () => {
    it('returns dev origins in development', () => {
      loadConfig({});
      const origins = getAllowedOrigins();
      expect(origins).toContain('http://localhost:7777');
      expect(origins).toContain('http://127.0.0.1:7777');
    });

    it('returns custom origins in production', () => {
      loadConfig({
        NODE_ENV: 'production',
        DNA_ENCRYPTION_KEY: 'strong-key-32-chars-minimum-ok!',
        AUTH_SECRET: 'an-auth-secret-at-least-16-chars',
        ALLOWED_ORIGINS: 'https://app.kenorie.com,https://kenorie.com',
      });
      const origins = getAllowedOrigins();
      expect(origins).toEqual(['https://app.kenorie.com', 'https://kenorie.com']);
    });

    it('uses custom frontend port in dev origins', () => {
      loadConfig({ FRONTEND_PORT: '9999' });
      const origins = getAllowedOrigins();
      expect(origins).toContain('http://localhost:9999');
    });
  });

  describe('isSameOriginLoopback()', () => {
    // The Electron shell loads http://127.0.0.1:<port> (its own backend) and
    // opens a WebSocket back to it — same-origin by construction. In production
    // ALLOWED_ORIGINS is empty, so without this allowance every WS upgrade is
    // dropped and the birth ceremony hangs at stage 0.
    it('allows loopback origins on the backend port (the app itself)', () => {
      loadConfig({ NODE_ENV: 'production', PORT: '47317', DNA_ENCRYPTION_KEY: 'strong-key-32-chars-minimum-ok!', AUTH_SECRET: 'an-auth-secret-at-least-16-chars' });
      expect(isSameOriginLoopback('http://127.0.0.1:47317')).toBe(true);
      expect(isSameOriginLoopback('http://localhost:47317')).toBe(true);
      expect(isSameOriginLoopback('http://[::1]:47317')).toBe(true);
    });

    it('an ephemeral launch (PORT 0) admits its own renderer on the port it actually bound', () => {
      // agent and test desks bind a kernel-chosen port; the frozen config says 0
      loadConfig({ PORT: '0' });
      expect(isSameOriginLoopback('http://127.0.0.1:37147')).toBe(false); // before the bind is known
      setBoundPort(37147);
      expect(isSameOriginLoopback('http://127.0.0.1:37147')).toBe(true);
      expect(isSameOriginLoopback('http://127.0.0.1:37148')).toBe(false);
      expect(isSameOriginLoopback('http://evil.com:37147')).toBe(false);
    });

    it('rejects loopback origins on a different port (cross-origin)', () => {
      loadConfig({ PORT: '3333' });
      expect(isSameOriginLoopback('http://127.0.0.1:7777')).toBe(false);
      expect(isSameOriginLoopback('http://localhost:1234')).toBe(false);
    });

    it('rejects non-loopback hosts even on the backend port', () => {
      loadConfig({ PORT: '3333' });
      expect(isSameOriginLoopback('http://evil.com:3333')).toBe(false);
      expect(isSameOriginLoopback('http://192.168.1.5:3333')).toBe(false);
    });

    it('rejects non-http(s) schemes and malformed origins', () => {
      loadConfig({ PORT: '3333' });
      expect(isSameOriginLoopback('file:///etc/passwd')).toBe(false);
      expect(isSameOriginLoopback('ws://127.0.0.1:3333')).toBe(false);
      expect(isSameOriginLoopback('not-a-url')).toBe(false);
      expect(isSameOriginLoopback('')).toBe(false);
    });

    it('matches the implicit port 80 for a bare http loopback origin', () => {
      loadConfig({ PORT: '80' });
      expect(isSameOriginLoopback('http://127.0.0.1')).toBe(true);
    });

    it('matches the implicit port 443 for a bare https loopback origin', () => {
      loadConfig({ PORT: '443' });
      expect(isSameOriginLoopback('https://127.0.0.1')).toBe(true);
    });
  });

  describe('getAdminWallets()', () => {
    it('returns empty array when no admin wallets', () => {
      loadConfig({});
      expect(getAdminWallets()).toEqual([]);
    });

    it('parses comma-separated wallets to lowercase', () => {
      loadConfig({ ADMIN_WALLETS: '0xAbC, 0xDeF' });
      expect(getAdminWallets()).toEqual(['0xabc', '0xdef']);
    });
  });
});
