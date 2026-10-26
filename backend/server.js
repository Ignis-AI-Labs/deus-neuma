// First import, so every module below evaluates with the .env already loaded:
// several read process.env at import time.
import 'dotenv/config';
import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { connect as netConnect } from 'node:net';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { mkdirSync } from 'fs';
import { loadConfig, getAllowedOrigins, isProduction } from './config.js';
import { ensureSecrets } from './services/secret-provisioning.js';
import { createLogger } from './services/logger.js';
import {
  DNAVaultServiceDefault as DNAVaultService, DevModeCache,
  StagedBirthHandler
} from '../core/index.js';
import { listAvatars } from './services/avatar-roster.js';
import { securityHeaders } from './services/security-headers.js';
import { getDataRoot, getVaultRoot, getSettingsDir } from './services/data-root.js';
import { enforceRootLock } from './services/root-lock.js';

// Routes — the whole /api/v1 mount surface lives in routes/route-mounts.js
// (size-law breakdown 2026-08-26). This file keeps only what the boot
// sequence, middleware, and WS layer touch. New routers mount THERE.
import { mountApiRoutes } from './routes/route-mounts.js';
import { setupPortalRoutes } from './routes/portal-routes.js';
import { setupTerminalRoutes } from './routes/terminal-routes.js';
import { setupDictateRoutes } from './routes/dictate-routes.js';
import { apiLimiter } from './services/rate-limiter.js';

// Boot/lifecycle — startServer, shutdown paths, and their ordering laws live
// in server-boot.js (size-law breakdown 2026-08-26). Boot steps land THERE.
import { bootServer } from './server-boot.js';
import { applyWorkspaceSettings } from './services/workspace-settings.js';
import { applyRealmSettings } from './services/user-realm-settings.js';
import { applyFileSettings } from './services/user-files-settings.js';
import { installRemoteGate, mountRemoteRoutes, attachRemoteTunnelTarget } from './services/remote/wire.js';
import { attachUpgradeRouter } from './services/ws-upgrade-router.js';

// --- Bootstrap ---

// Self-provision stable at-rest secrets on a fresh (packaged) install, before
// config reads them. Explicit env (.env / Electron-injected) always wins.
const provisionedSecrets = ensureSecrets();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Validate all env vars upfront — throws in production on invalid config
const config = loadConfig();

// Apply the witness's persisted workspace choice (root + allocation) before any route touches a workspace path
await applyWorkspaceSettings();

// Restore the operator's persisted PROVIDER choice before anything speaks
// (Bastien, 2026-08-08): the active mind used to be in-memory only, so every
// packaged boot reset to the hard-coded default until the operator
// re-clicked their provider. An env-explicit LLM_PROVIDER still wins — the
// choice file only fills the gap the env leaves.
{
  const { loadProviderChoice } = await import('./services/provider-choice.js');
  const { setConfig } = await import('./services/llm-provider.js');
  const { createLogger } = await import('./services/logger.js');
  const choice = await loadProviderChoice();
  if (choice && !process.env.LLM_PROVIDER) {
    setConfig({
      provider: choice.provider,
      ...(choice.endpoint ? { endpoint: choice.endpoint } : {}),
      ...(choice.model ? { model: choice.model } : {}),
    });
    createLogger('Boot').info('Provider choice restored', {
      provider: choice.provider, endpoint: choice.endpoint, chosenBy: choice.chosenBy,
    });
  }
  // A model server the platform set up for this person (managed-ollama.js) starts again with
  // the platform, so the mind is there after a restart. Fire-and-observe: boot never waits on it.
  const { startManagedAtBoot } = await import('./services/managed-ollama.js');
  startManagedAtBoot().catch(() => {});
}

// Witnesses stand BESIDE the house, never in it (ruling, 2026-07-24): any witness
// lane still sitting inside the workspaces root moves out to the witnesses'
// ground before anything binds a lane. Idempotent — a clean house is a no-op;
// a both-grounds collision is skipped loudly, never overwritten.
{
  const { neumaWorkspace } = await import('../core/index.js');
  const { moved, skipped } = await neumaWorkspace.migrateWitnessLanes();
  if (moved.length) console.log(`[Server] witness lanes moved beside the house: ${moved.join(', ')}`);
  if (skipped.length) console.warn(`[Server] witness lanes on BOTH grounds (join by hand): ${skipped.join(', ')}`);
}

// Apply the witness's persisted data-realm location (their own chat logs) before any exchange is persisted
await applyRealmSettings();

// Apply the witness's persisted explorer roots (the folders they've opened)
// before any file route can resolve a path
await applyFileSettings();

const log = createLogger('Server');

if (provisionedSecrets.generated.length > 0) {
  log.warn('Generated new at-rest secrets on first run — back up this file', {
    keys: provisionedSecrets.generated, file: provisionedSecrets.file,
  });
}
if (provisionedSecrets.folder?.startsWith('failed')) {
  log.warn('The folder holding the at-rest secrets could not be closed to its owner', { result: provisionedSecrets.folder });
}

// DID THE GROUND MOVE UNDER US? Asked before anything reads or writes.
//
// On 2026-07-31 a two-line change repointed the data root, every settings file
// resolved to a directory that did not exist, and the desk came up with no
// history, no realm and default colours. Nothing was deleted; it was all
// unreachable, which from a desk is the same picture. The whole suite stayed
// green, because every settings spec points at its own temp path and so cannot
// see where real data lives.
//
// A check that cannot live in a test lives here. It refuses ONLY when a move
// loses something — old root full, new root empty. See services/root-lock.js.
enforceRootLock({ settings: getSettingsDir(), vault: getVaultRoot() }, { log });

// IS OUR PORT ALREADY HELD? Asked FIRST, before anything is spawned.
//
// The listen call is the last thing this file does, after MCP servers, the
// substrate check and the schedulers are all up. Discovering the conflict there
// meant every one of those was started only to be torn down — and the MCP
// filesystem server, which arrives late through an `npx` wrapper, was still
// connecting when we exited. It then wrote its handshake into a pipe with
// nobody on the other end and died on an EPIPE with a stack trace of its own.
// One ordinary "already running" produced two crash traces (#215).
//
// So the question is asked while there is still nothing to clean up. A probe,
// not a bind: binding to test would race with our own listen below.
{
  const held = await new Promise((resolve) => {
    const probe = netConnect({ host: config.host, port: config.port });
    const settle = (v) => { probe.destroy(); resolve(v); };
    probe.setTimeout(1500);
    probe.once('connect', () => settle(true));
    probe.once('timeout', () => settle(false));
    // ECONNREFUSED — nobody home. Any undecidable answer is "free": refusing to
    // boot on a probe we could not read would be worse than the conflict.
    probe.once('error', () => settle(false));
  });
  if (held) {
    log.error('Port already in use — a NEUMA backend is very likely still running', {
      host: config.host,
      port: config.port,
      hint: `Nothing is wrong with this build. Find the holder with: ss -lntp | grep ${config.port}`,
    });
    process.exit(1);
  }
}

const app = express();
const server = createServer(app);
// Tailscale Serve proxies from loopback and stamps the caller's tailnet
// address into X-Forwarded-For; trusting ONLY loopback as a proxy makes
// req.ip the phone's address for the limiters and nothing else's claim.
app.set('trust proxy', 'loopback');

const dnaVault = new DNAVaultService({
  vaultPath: join(getVaultRoot(), 'dna/'),
  auditPath: join(getVaultRoot(), 'audit/'),
  encryptionKey: config.dnaEncryptionKey
});

const dnaCache = new DevModeCache({
  cacheDir: join(getDataRoot(), 'dna-cache/')
});

const birthHandler = new StagedBirthHandler(dnaVault, dnaCache);
dnaCache.connectToLocalVault(dnaVault);

// --- Middleware ---

app.use(cors({
  origin: getAllowedOrigins(),
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Origin', 'X-Requested-With', 'Content-Type', 'Accept', 'Authorization', 'X-Neuma-State'],
}));
// Neuma Remote: who is on the other end, decided before Host is trusted
// (docs/security/remote-surface.md). Local requests pass untouched.
await installRemoteGate(app);
// A clone-seed offering carries the witness's recording inline as base64 —
// megabytes by nature. The forge routes parse their OWN bodies with a
// seed-sized limit BEHIND requireAuth (voice-forge-routes.js), so those
// paths pass through here unparsed: an unauthenticated 24MB POST dies at
// the router's auth gate without a byte of it being JSON-parsed.
// Image attachments take the same shape: the portal WS caps payloads at
// 64KB (WS-002), so images upload via REST — parsed behind auth in
// attachment-routes.js with its own wide limit, unparsed here.
// Every other endpoint keeps the strict default (100kb): wide limits are
// scoped to the surfaces that need them, never the whole API.
const jsonDefault = express.json();
// Segment-boundary match, not a bare prefix: Express routes on '/' segments,
// so a future sibling like /api/v1/attachments-info must NOT silently skip
// the parser (echo finding).
const underPath = (p, base) => p === base || p.startsWith(`${base}/`);
const selfParsedPath = (p) => underPath(p, '/api/v1/voice/forge') || underPath(p, '/api/v1/attachments') || underPath(p, '/api/v1/doc-press');
app.use((req, res, next) => {
  if (selfParsedPath(req.path)) return next(); // parsed behind auth in their routers
  return jsonDefault(req, res, next);
});
// The global ceiling, minus the routes that only hand back bytes already on
// disk (THE GALLERY's files) — see isUnmeteredApiPath for why.
app.use('/api', apiLimiter);

// Security headers — defense-in-depth (HEADERS-001), see security-headers.js
app.use(securityHeaders);

// --- Static files ---

if (isProduction()) {
  app.use(express.static(join(__dirname, '../dist')));
} else {
  log.info(`Development mode — frontend served by Vite on port ${config.frontendPort}`);
}

app.use('/assets', express.static(join(__dirname, '../frontend/assets')));

app.use('/frontend', express.static(join(__dirname, '../frontend'), {
  setHeaders: (res, path) => {
    if (path.endsWith('.js')) res.setHeader('Content-Type', 'application/javascript');
    else if (path.endsWith('.html')) res.setHeader('Content-Type', 'text/html');
  }
}));

app.use('/frontend/components', express.static(join(__dirname, '../frontend/components'), {
  setHeaders: (res, path) => {
    if (path.endsWith('.js')) res.setHeader('Content-Type', 'application/javascript');
  }
}));

// NO MODEL EVER SHIPS (ruling, 2026-08-06): none of the avatars are ours to
// distribute, so no .vrm is bundled into any artifact. Production scans a
// WRITABLE avatar folder under the data root (the install tree is read-only —
// the BIRTH-001 lesson), empty until the operator places their own models;
// the roster answers modelDir so the AVATAR window can name the real folder.
// Dev keeps frontend/public/model — the operator's private local fleet, never
// tracked (gitignored) and never copied into dist/ (not the Vite publicDir).
const modelPath = isProduction()
  ? join(getDataRoot(), 'model')
  : join(__dirname, '../frontend/public/model');
if (isProduction()) mkdirSync(modelPath, { recursive: true });

app.get('/api/v1/avatars', async (req, res) => {
  try {
    res.json({ avatars: await listAvatars(modelPath), modelDir: modelPath });
  } catch (error) {
    log.error('Failed to list avatars', { err: error.message });
    res.status(500).json({ error: 'Failed to list avatars', avatars: [] });
  }
});

app.use('/model', express.static(modelPath, {
  setHeaders: (res, path) => {
    if (path.endsWith('.vrm')) {
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Access-Control-Allow-Origin', '*');
    }
  }
}));

app.use(express.static(join(__dirname, 'public'), {
  setHeaders: (res, path) => {
    if (path.endsWith('.svg')) res.setHeader('Content-Type', 'image/svg+xml');
  }
}));

app.use('/animations', express.static(join(__dirname, 'public/animations')));
app.use('/animation', express.static(join(__dirname, 'public/animations')));
mountRemoteRoutes(app);
// --- Mount routes (v1) --- the whole surface + compat redirect, in
// mount-order law — see routes/route-mounts.js
mountApiRoutes(app);

// --- SPA fallback (production only) ---

if (isProduction()) {
  app.get('*', (req, res, next) => {
    // Skip API routes and static files
    if (req.path.startsWith('/api/') || req.path.startsWith('/frontend/') ||
        req.path.startsWith('/model/') || req.path.startsWith('/assets/') ||
        req.path.startsWith('/animations/') || req.path.startsWith('/animation/')) {
      return next();
    }
    res.sendFile(join(__dirname, '../dist/index.html'));
  });
}

// --- WebSocket ---

// maxPayload: portal messages are a few KB (WS-002); the terminal allows ~1MB
// for pastes. Both endpoints are noServer and share one upgrade router, which
// holds the origin (WS-001) and peer boundaries (services/ws-upgrade-router.js).
const wss = new WebSocketServer({ noServer: true, maxPayload: 65536 });
setupPortalRoutes(wss, { birthHandler });

// Integrated terminal — a shell is arbitrary code execution by design, gated
// by auth-on-connect (terminal-routes) + local desks only.
const terminalWss = new WebSocketServer({ noServer: true, maxPayload: 1048576 });
setupTerminalRoutes(terminalWss);

// Hold-to-talk dictation over the live speech lane — 100 ms PCM frames (3.2 KB).
const dictateWss = new WebSocketServer({ noServer: true, maxPayload: 65536 });
setupDictateRoutes(dictateWss);

attachUpgradeRouter(server, { wss, terminalWss, dictateWss });
// The native road (Road B) injects admitted TLS sockets into this server.
attachRemoteTunnelTarget(server);

// --- Boot ---
// Everything from here down — directories, tool surface, schedulers, the
// listen, and the shutdown paths — runs in server-boot.js. It fires AFTER
// the routes and the WS upgrade router above exist, so nothing can bind
// before the surface it serves is wired.
bootServer({ server, wss, terminalWss, dictateWss, config, log });
