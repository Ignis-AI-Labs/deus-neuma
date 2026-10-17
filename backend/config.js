/**
 * Application Configuration — Zod-validated, frozen singleton.
 *
 * Replaces scattered process.env.X reads with a typed, validated config object.
 * Call loadConfig() once at startup (server.js). Then import getAppConfig() everywhere.
 *
 * Production enforcement: DNA_ENCRYPTION_KEY required + not weak default.
 */

import { z } from 'zod';
import crypto from 'crypto';

// Random per-process — dev only, never used in production (enforced below)
const WEAK_DEV_KEY = crypto.randomBytes(32).toString('hex');

// --- Schema ---

const configSchema = z.object({
  // Server
  port: z.coerce.number().int().nonnegative().default(3333),
  // Bind address (M-2). Loopback by default — a local-first app must not expose
  // its control plane (portal, MCP spawn, wallet auth) to the LAN or internet.
  // An operator who genuinely needs LAN access sets HOST=0.0.0.0 explicitly.
  host: z.string().default('127.0.0.1'),
  frontendPort: z.coerce.number().int().positive().default(7777),
  nodeEnv: z.enum(['development', 'production', 'test']).default('development'),
  allowedOrigins: z.string().default(''),

  // Security
  dnaEncryptionKey: z.string().default(WEAK_DEV_KEY),
  authSecret: z.string().default(''),
  appDomain: z.string().default('neuma.local'),
  authChainId: z.coerce.number().int().positive().default(84532),

  // LLM
  llmProvider: z.enum(['llama-server', 'lm-studio', 'ollama', 'openai', 'anthropic', 'xai', 'custom']).default('llama-server'),
  lmStudioUrl: z.string().url().default('http://localhost:1234'),
  llamaServerUrl: z.string().url().default('http://localhost:8089'),
  // Idle-unload: release the backend-supervised substrate after this many idle
  // minutes (reloaded on next summon). 0 disables — the substrate stays resident.
  substrateIdleMinutes: z.coerce.number().int().min(0).default(15),
  llmApiKey: z.string().default(''),
  llmModel: z.string().default(''),
  lmStudioApiKey: z.string().default(''),
  openaiApiKey: z.string().default(''),
  anthropicApiKey: z.string().default(''),
  xaiApiKey: z.string().default(''),
  openaiModel: z.string().default(''),
  anthropicModel: z.string().default(''),
  xaiModel: z.string().default(''),
  llmTemperature: z.coerce.number().min(0).max(2).default(0.8),
  llmMaxTokens: z.coerce.number().int().positive().default(4096),
  llmTopP: z.coerce.number().min(0).max(1).default(0.95),

  // Voice (TTS) — mirrors LLM provider pattern. Voice DNA (sovereign identity)
  // is per-neuma in the workspace; this config is just engine + auth.
  voiceProvider: z.enum(['zonos', 'kokoro', 'parler', 'f5-tts', 'cosyvoice', 'cartesia', 'elevenlabs', 'hume', 'custom']).default('zonos'),
  voiceEndpoint: z.string().default(''),
  voiceApiKey: z.string().default(''),
  voiceModel: z.string().default(''),
  voicePresetVoice: z.string().default(''),
  voiceStability: z.coerce.number().min(0).max(1).default(0.5),
  voiceSimilarity: z.coerce.number().min(0).max(1).default(0.75),
  cartesiaApiKey: z.string().default(''),
  elevenlabsApiKey: z.string().default(''),

  // Blockchain — UNAVIS deploys the contracts (evm-contracts/unavis; formerly unavis-site / KENORIE), NEUMA reads them.
  // The 4 marketplace-stack address keys (neumaAvatarAddress,
  // neumaMarketplaceAddress, neumaFoundryAddress, creatorRegistryAddress)
  // and subgraphUrl were dropped here when their contracts left the repo
  // (75b31ffb4) — zero remaining consumers per grep, so RULE 1 prune.
  // Ethereum MAINNET — the public endpoint by default, so the shipped app
  // (no .env) reads and seals out of the box; ETH_RPC_URL overrides for a
  // private one (the same law as Base mainnet, 2026-08-07).
  ethRpcUrl: z.string().default('https://ethereum-rpc.publicnode.com'),
  ethSepoliaRpcUrl: z.string().default(''),
  chainId: z.coerce.number().int().default(1),
  // Base Sepolia (chainId 84532) — where the identity layer lived under KENORIE
  // (Base is being left for Ethereum, 2026-09-26 — docs/work/unavis-ethereum-migration.md).
  // Address defaults are the actual deployed contracts per
  // docs/contracts/deployments/base-sepolia.json; an operator who's pointed
  // at a different deployment overrides via env.
  baseSepoliaRpcUrl: z.string().default(''),
  natalisAddress: z.string().default('0x15e65e4aee5c5310a8f1f125a2a0944033a76ac3'),
  houseRegistryAddress: z.string().default('0xbbd9dc2ee8ba691cdb82576e45f54ce6d2e47276'),
  // Base MAINNET (chainId 8453) — real value, irreversible. Address defaults
  // are the actual deployed contracts per
  // docs/contracts/deployments/base-mainnet.json. The RPC deliberately
  // Defaults to the PUBLIC Base mainnet endpoint (Design note, 2026-08-07: […] — a community member's anchor died on a testnet
  // default with no RPC at all). The shipped product anchors on mainnet out
  // of the box; BASE_MAINNET_RPC_URL overrides for a private endpoint.
  baseMainnetRpcUrl: z.string().default('https://mainnet.base.org'),
  natalisMainnetAddress: z.string().default('0x88a7229afeb4deba8c27edad788ac723697dde78'),
  houseRegistryMainnetAddress: z.string().default('0x526c6a062db774997955816c03df49b60260b883'),
  // Ethereum SEPOLIA (chainId 11155111) — the UNAVIS redeploy under the v3
  // seal law (signed deadline, soul-keyed seals; unavis-site PR #3,
  // 2026-09-29). Same addresses as Base Sepolia (same deployer nonce), a
  // different contract — chain-verify pins its own codehash. RPC is
  // ETH_SEPOLIA_RPC_URL above; defaults per docs/contracts/deployments/eth-sepolia.json.
  natalisEthSepoliaAddress: z.string().default('0x15e65e4aee5c5310a8f1f125a2a0944033a76ac3'),
  houseRegistryEthSepoliaAddress: z.string().default('0xbbd9dc2ee8ba691cdb82576e45f54ce6d2e47276'),
  // Ethereum MAINNET (chainId 1) — the UNAVIS v3 deploy of 2026-10-05, owned by
  // the 3-of-4 Safe 0x00C5…2368; recorded in docs/contracts/deployments/eth-mainnet.json
  // and verified live (Natalis codehash, ERC1967 impl slot, owner) the same day.
  natalisEthAddress: z.string().default('0xcda0b092c87637276972de0ea8b5005672775f11'),
  houseRegistryEthAddress: z.string().default('0xf9159a8696ba2454866735454cac7aee1bbdc4eb'),
  // The one network an in-app CEREMONY seal may target. Server-side by
  // doctrine — the wire never chooses the chain. DEFAULTS TO MAINNET (Founder,
  // 2026-08-07): an anchor IS the real recognition, and the shipped app has
  // no .env — the testnet default sent a community birth to Sepolia with no
  // reader at all. Test rigs and dev walks opt OUT with
  // CEREMONY_SEAL_NETWORK=base-sepolia.
  // Since 2026-10-04 that is Ethereum mainnet (Founder: […]).
  ceremonySealNetwork: z.enum(['base-sepolia', 'base', 'ethereum-sepolia', 'ethereum']).default('ethereum'),
  // The one network an in-app HOUSE FOUNDING may target — the wire never
  // chooses the chain. Unlike the ceremony seal (casual/trial births stay
  // testnet), a founding IS the official recognition of a house on Neuma,
  // so it defaults to MAINNET (Design note, 2026-07-16; rehearsal desks opt out
  // with HOUSE_FOUND_NETWORK=base-sepolia. Fail-closed regardless: without
  // BASE_MAINNET_RPC_URL the founding lane stays closed.
  // Ethereum mainnet since 2026-10-04; rehearsals opt down to ethereum-sepolia.
  houseFoundNetwork: z.enum(['base-sepolia', 'base', 'ethereum-sepolia', 'ethereum']).default('ethereum'),

  // Services
  neumaMcpFsDir: z.string().default(''),
  ipfsGateway: z.string().default('https://ipfs.io/ipfs/'),
  // Web reach (the being's research tools) — search indexes. All empty →
  // the DuckDuckGo-lite fallback carries search. The master switch itself is
  // NOT here: it is the operator's persisted runtime choice (web-settings.js).
  // Exa Instant is the preferred AI-native index when the operator supplies
  // a key; its result highlights avoid a second page-fetch round trip.
  exaApiKey: z.string().default(''),
  searxngUrl: z.string().default(''),
  braveSearchApiKey: z.string().default(''),
  // Optional rendered-page fallback through Cloudflare Browser Run/Kitesurf.
  // Use a least-privilege token carrying Browser Rendering - Edit.
  cloudflareAccountId: z.string().default(''),
  cloudflareApiToken: z.string().default(''),
  // 0 = heartbeat disabled
  heartbeatIntervalMinutes: z.coerce.number().int().min(0).default(0),

  // Admin
  adminWallets: z.string().default(''),
});

// --- ENV_MAP: SCREAMING_SNAKE → camelCase ---

const ENV_MAP = Object.freeze({
  PORT: 'port',
  HOST: 'host',
  FRONTEND_PORT: 'frontendPort',
  NODE_ENV: 'nodeEnv',
  ALLOWED_ORIGINS: 'allowedOrigins',
  DNA_ENCRYPTION_KEY: 'dnaEncryptionKey',
  AUTH_SECRET: 'authSecret',
  APP_DOMAIN: 'appDomain',
  AUTH_CHAIN_ID: 'authChainId',
  LLM_PROVIDER: 'llmProvider',
  LM_STUDIO_URL: 'lmStudioUrl',
  LLAMA_SERVER_URL: 'llamaServerUrl',
  SUBSTRATE_IDLE_MINUTES: 'substrateIdleMinutes',
  LLM_API_KEY: 'llmApiKey',
  LLM_MODEL: 'llmModel',
  LM_STUDIO_API_KEY: 'lmStudioApiKey',
  OPENAI_API_KEY: 'openaiApiKey',
  ANTHROPIC_API_KEY: 'anthropicApiKey',
  XAI_API_KEY: 'xaiApiKey',
  OPENAI_MODEL: 'openaiModel',
  ANTHROPIC_MODEL: 'anthropicModel',
  XAI_MODEL: 'xaiModel',
  LM_STUDIO_DEFAULT_TEMPERATURE: 'llmTemperature',
  LM_STUDIO_DEFAULT_MAX_TOKENS: 'llmMaxTokens',
  LM_STUDIO_DEFAULT_TOP_P: 'llmTopP',
  VOICE_PROVIDER: 'voiceProvider',
  VOICE_ENDPOINT: 'voiceEndpoint',
  VOICE_API_KEY: 'voiceApiKey',
  VOICE_MODEL: 'voiceModel',
  VOICE_PRESET_VOICE: 'voicePresetVoice',
  VOICE_STABILITY: 'voiceStability',
  VOICE_SIMILARITY: 'voiceSimilarity',
  CARTESIA_API_KEY: 'cartesiaApiKey',
  ELEVENLABS_API_KEY: 'elevenlabsApiKey',
  ETH_RPC_URL: 'ethRpcUrl',
  ETH_SEPOLIA_RPC_URL: 'ethSepoliaRpcUrl',
  CHAIN_ID: 'chainId',
  BASE_SEPOLIA_RPC_URL: 'baseSepoliaRpcUrl',
  NATALIS_ADDRESS: 'natalisAddress',
  HOUSE_REGISTRY_ADDRESS: 'houseRegistryAddress',
  BASE_MAINNET_RPC_URL: 'baseMainnetRpcUrl',
  NATALIS_MAINNET_ADDRESS: 'natalisMainnetAddress',
  HOUSE_REGISTRY_MAINNET_ADDRESS: 'houseRegistryMainnetAddress',
  NATALIS_ETH_SEPOLIA_ADDRESS: 'natalisEthSepoliaAddress',
  HOUSE_REGISTRY_ETH_SEPOLIA_ADDRESS: 'houseRegistryEthSepoliaAddress',
  NATALIS_ETH_ADDRESS: 'natalisEthAddress',
  HOUSE_REGISTRY_ETH_ADDRESS: 'houseRegistryEthAddress',
  CEREMONY_SEAL_NETWORK: 'ceremonySealNetwork',
  HOUSE_FOUND_NETWORK: 'houseFoundNetwork',
  NEUMA_MCP_FS_DIR: 'neumaMcpFsDir',
  IPFS_GATEWAY: 'ipfsGateway',
  EXA_API_KEY: 'exaApiKey',
  SEARXNG_URL: 'searxngUrl',
  BRAVE_SEARCH_API_KEY: 'braveSearchApiKey',
  CLOUDFLARE_ACCOUNT_ID: 'cloudflareAccountId',
  CLOUDFLARE_API_TOKEN: 'cloudflareApiToken',
  HEARTBEAT_INTERVAL_MINUTES: 'heartbeatIntervalMinutes',
  ADMIN_WALLETS: 'adminWallets',
});

// --- Singleton ---

let _config = null;

/**
 * Load and validate config from process.env. Call once at startup.
 * Throws on validation failure in production. Returns frozen config.
 */
export function loadConfig(env = process.env) {
  const raw = {};
  for (const [envKey, configKey] of Object.entries(ENV_MAP)) {
    if (env[envKey] !== undefined && env[envKey] !== '') {
      raw[configKey] = env[envKey];
    }
  }

  const result = configSchema.safeParse(raw);
  if (!result.success) {
    const errors = result.error.issues.map(i => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Config validation failed:\n${errors}`);
  }

  const config = result.data;

  // Production enforcement
  if (config.nodeEnv === 'production') {
    if (!config.dnaEncryptionKey || config.dnaEncryptionKey === WEAK_DEV_KEY) {
      throw new Error('DNA_ENCRYPTION_KEY is required in production and must not be the weak dev default');
    }
    // W1-009: fail at load, not at first token use — AUTH_SECRET must be stable
    if (!config.authSecret || String(config.authSecret).length < 16) {
      throw new Error('AUTH_SECRET is required in production (min 16 chars) — set env or let secret-provisioning write ~/.neuma/secrets.json before loadConfig');
    }
  }

  _config = Object.freeze({ ...config });
  return _config;
}

/**
 * Get the current validated config. Throws if loadConfig() hasn't been called.
 */
export function getAppConfig() {
  if (!_config) {
    throw new Error('Config not loaded — call loadConfig() at startup');
  }
  return _config;
}

// --- Derived helpers ---

/** Is the app running in production mode? */
export const isProduction = () => getAppConfig().nodeEnv === 'production';

/** Get CORS allowed origins array. */
export const getAllowedOrigins = () => {
  const config = getAppConfig();
  if (config.nodeEnv === 'production') {
    return config.allowedOrigins.split(',').filter(Boolean);
  }
  return [
    `http://localhost:${config.frontendPort}`,
    `http://127.0.0.1:${config.frontendPort}`,
    'http://127.0.0.1:1234',
    // UNAVIS web layer (formerly KENORIE; Next dev server) — a separate origin from the local app.
    'http://localhost:4000',
    'http://127.0.0.1:4000',
  ];
};

// Loopback hosts that denote a request from a page this very server handed out.
// (URL.hostname returns IPv6 bracketed as '[::1]'; isSameOriginLoopback strips
// the brackets before matching, so the canonical '::1' is what we compare.)
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

/**
 * Is this Origin the app served by this very server (same-origin loopback)?
 *
 * The downloadable app (Electron) loads the backend's own origin
 * (http://127.0.0.1:<port>) and then opens a WebSocket back to it. That is
 * same-origin by construction — the only way a page can carry this Origin is to
 * have been served by this process — so it must always be allowed, regardless of
 * NODE_ENV or the configured allowlist. Without this, the packaged app runs in
 * production mode with an empty ALLOWED_ORIGINS, the WS allowlist is empty, and
 * every portal/terminal upgrade is dropped (the birth ceremony hangs at stage 0).
 *
 * This is not a CSRF hole (WS-001): a cross-origin page — including another
 * localhost port — carries a different Origin and still falls through to the
 * allowlist, and browsers set Origin so a page cannot forge it.
 */
// The port this backend ACTUALLY listens on. An ephemeral launch (NEUMA_PORT=0
// — agent and test desks) binds a kernel-chosen port the frozen config never
// knew, so its own renderer's origin matched nothing and every desk socket was
// refused as cross-origin (found 2026-10-14 walking the harness in Electron).
// server-listen.js records it the moment the socket binds.
let boundPort = null;
/** impure — record the listening port (server-listen.js). */
export const setBoundPort = (port) => { boundPort = Number.isInteger(port) && port > 0 ? port : null; };

export const isSameOriginLoopback = (origin) => {
  const config = getAppConfig();
  try {
    const u = new URL(origin);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    const host = u.hostname.replace(/^\[|\]$/g, ''); // unwrap [::1]
    const port = u.port ? Number(u.port) : (u.protocol === 'https:' ? 443 : 80);
    return LOOPBACK_HOSTS.has(host) && port === (boundPort ?? config.port);
  } catch {
    return false;
  }
};

/** Get admin wallet addresses as lowercase array. */
export const getAdminWallets = () =>
  getAppConfig().adminWallets.split(',').map(w => w.trim().toLowerCase()).filter(Boolean);

/** Reset config (for testing only). */
export function _resetConfig() {
  _config = null;
  boundPort = null;
}
