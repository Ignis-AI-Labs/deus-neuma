/**
 * The API route surface — every /api/v1 mount, in the one order that works.
 *
 * Extracted verbatim from backend/server.js (2026-08-26, the size-law
 * breakdown campaign, SIZE-019 #366): the mount block was the file's largest
 * cohesive section and the only part that grew on every new router. New
 * routers land HERE — server.js never gains another mount line.
 *
 * ORDER MATTERS: public routes (auth challenge/verify) must be mounted
 * BEFORE any router that uses requireAuth at the root `/api/v1` prefix,
 * because Express matches routes in mount order. memoryRouter and
 * llmRouter are mounted at `/api/v1` with router-level requireAuth,
 * which would intercept /api/v1/auth/challenge if auth routes came after.
 */

import express from 'express';

import neumaDatabaseRoutes from './neuma-database-routes.js';
import mcpRouter from './mcp-routes.js';
import memoryRouter from './memory-routes.js';
import llmRouter from './llm-routes.js';
import attachmentRouter from './attachment-routes.js';
import webRouter from './web-routes.js';
import skillRouter from './skill-routes.js';
import { getConnectionCount } from './portal-routes.js';
import { terminalAgentsRouter } from './terminal-routes.js';
import workspaceRouter from './workspace-routes.js';
import actRouter from './act-routes.js';
import weaveRouter from './weave-routes.js';
import socialRouter from './social-routes.js';
import socialChannelRouter from './social-channel-routes.js';
import leadRouter from './lead-routes.js';
import campaignRouter from './campaign-routes.js';
import csoRouter from './cso-routes.js';
import legalRouter from './legal-routes.js';
import staffRouter from './staff-routes.js';
import houseClockRouter from './house-clock-routes.js';
import benchRouter from './bench-routes.js';
import chainRouter from './chain-routes.js';
import moneyInRouter from './money-in-routes.js';
import emailRouter from './email-routes.js';
import docPressRouter from './doc-press-routes.js';
import imageForgeRouter from './image-forge-routes.js';
import galleryRouter from './gallery-routes.js';
import invariantsRouter from './invariants-routes.js';
import versionRouter from './version-routes.js';
import priceRouter from './price-routes.js';
import { createAuthRouter } from '../services/auth.js';
import { createBridgeRouter } from '../services/auth-bridge.js';
import { createGenesisRouter } from './genesis-routes.js';
import { authLimiter, neumaAuthLimiter, bridgeLimiter } from '../services/rate-limiter.js';
import healthRouter from './health-routes.js';
import neumaAuthRouter from './neuma-auth-routes.js';
import neumaWalletRouter from './neuma-wallet-routes.js';
import recoveryRouter from './recovery-routes.js';
import covenantRouter from './covenant-routes.js';
import preflightRouter from './preflight-routes.js';
import rosterRouter from './roster-routes.js';
import permissionsRouter from './permissions-routes.js';
import brandRouter from './brand-routes.js';
import birthSetupRouter from './birth-setup-routes.js';
import voicePackRouter from './voice-pack-routes.js';
import voiceSealRouter from './voice-seal-routes.js';
import securityRouter from './security-routes.js';
import substrateRouter from './substrate-routes.js';
import teamRouter from './team-routes.js';
import userRealmRouter from './user-realm-routes.js';
import dreamRouter from './dream-routes.js';
import lookRouter from './look-routes.js';
import userFilesRouter, { mapLaneQueryToken } from './user-files-routes.js';
import userProjectsRouter from './user-projects-routes.js';
import taskRouter, { calendarFeedRouter } from './task-routes.js';
import vitalRouter from './vital-routes.js';
import modelFolderRouter from './model-folder-routes.js';
import mapRouter from './map-routes.js';
import residencyRouter from './residency-routes.js';
import meditationRouter from './meditation-routes.js';
import mindRouter from './mind-routes.js';
import expressionRouter from './expression-routes.js';
import sovereigntyRouter from './sovereignty-routes.js';
import voiceRouter from './voice-routes.js';
import sttRouter from './stt-routes.js';
import refineRouter from './refine-routes.js';
import voiceEngineRouter from './voice-engine-routes.js';
import voiceForgeRouter from './voice-forge-routes.js';
import routingRouter from './routing-routes.js';
import installOwnerRouter from './install-owner-routes.js';
import laneClaimRouter from './lane-claim-routes.js';
import witnessRouter from './witness-routes.js';
import harnessRouter from './harness-routes.js';
import neumaRouteRouter from './neuma-route-routes.js';
import inferenceRouter from './inference-routes.js';
import refinementRouter from './refinement-routes.js';
import attunementRouter from './attunement-routes.js';
import remiaRouter from './remia-routes.js';

/**
 * Mount the whole v1 API surface on `app`, in mount-order law.
 * // impure — registers handlers on the app
 */
export const mountApiRoutes = (app) => {
  // ?token= → header for the headerless lanes (EventSource, native download) BEFORE any /api/v1 blanket requireAuth 401s them
  app.use(mapLaneQueryToken);

  // GENESIS, the install's once-ever opening, plays before anyone signs in —
  // it stands in front of the wallet (genesis-routes.js).
  app.use('/api/v1/genesis', createGenesisRouter(express));

  // Wallet bridge (WEB-001 / #126) — mounted BEFORE the auth router so its poll
  // endpoint uses the generous bridgeLimiter, not the tight 10/5min authLimiter.
  app.use('/api/v1/auth/bridge', bridgeLimiter, createBridgeRouter(express));
  app.use('/api/v1/auth', authLimiter, createAuthRouter(express));
  // Keyed per (IP, being) — nine founders' unlocks are nine buckets, while a
  // single keypair's password still takes at most 10 tries per window.
  app.use('/api/v1/neuma-auth', neumaAuthLimiter, neumaAuthRouter);
  // Covenant documents are public (GET /); mounted before the routers that
  // apply blanket requireAuth at /api/v1, which would 401 the fall-through
  app.use('/api/v1/covenant', covenantRouter);
  // Pre-flight launch gate — local machine self-check, same mounting rule
  app.use('/api/v1/preflight', preflightRouter);
  // Roster recovery — the wallet's owned neuma from the sovereign owner records,
  // so a fresh client isn't wrongly sent to birth. Self-gates via requireAuth.
  app.use('/api/v1/roster', rosterRouter);
  // What the operator has permanently granted, read back (read-only by law).
  app.use('/api/v1/permissions', permissionsRouter);
  // The operator's brand kits — listed, and authored by hand when they want to.
  app.use('/api/v1/brands', brandRouter);
  app.use('/api/v1/birth-setup', birthSetupRouter);
  app.use('/api/v1/voice-pack', voicePackRouter);
  app.use('/api/v1/voice-seal', voiceSealRouter);

  // Witness-facing data-security posture (Security settings tab) — status +
  // dry-run plan, self-gated to the signer's own beings.
  app.use('/api/v1/security', securityRouter);
  app.use('/api/v1/substrate', substrateRouter);
  app.use('/api/v1/team', teamRouter);

  // Social town square — feed/profile/thread READS are public (no login to
  // browse), while writes self-gate per-route via requireAuth inside the router.
  // Mounted BEFORE the blanket-requireAuth routers below (memoryRouter at
  // bare `/api/v1`) so the public reads aren't 401'd. (neumaDatabaseRoutes
  // is a 410 tombstone now — decommissioned by the 2026-07-04 isolation audit.)
  app.use('/api/v1/social', socialRouter);

  // The witness's outward-speech board: connect platform accounts and tie each
  // channel to its one neuma holder. Router-level requireAuth inside.
  app.use('/api/v1/social-channels', socialChannelRouter);
  app.use('/api/v1/leads', leadRouter);
  app.use('/api/v1/campaigns', campaignRouter);

  // The CSO office: the seat, the threat ledger, the watch list, and the
  // standing scan. Router-level requireAuth inside. (/api/v1/security is the
  // older data-security panel's prefix — the CSO office stands beside it.)
  app.use('/api/v1/cso', csoRouter);

  // The CLO office (the Praetor): the seat, the legal matters ledger, and
  // the standing legal watch. Router-level requireAuth inside.
  app.use('/api/v1/legal', legalRouter);

  // The CoS office (the Optio): the seat and the desk's board. Router-level
  // requireAuth inside, beside the CSO office.
  app.use('/api/v1/staff', staffRouter);
  // The house clock: the charter that lets the house wake itself, its queue
  // and its ledger. Router-level requireAuth inside; the house is the caller's.
  app.use('/api/v1/house-clock', houseClockRouter);

  // The bench plane: the operator's window onto the sovereign benchmark
  // harness — read + launch + watch. Router-level requireAuth inside.
  app.use('/api/v1/bench', benchRouter);

  // Chain truth through the operator's own keyed RPC — reads for beings and
  // the desk, no explorer middlemen. Router-level requireAuth inside.
  app.use('/api/v1/chain', chainRouter);

  // The money-in ledger: what the house received on Ethereum and Base —
  // receive-only, read-only. Router-level requireAuth inside; the house is
  // the caller's wallet.
  app.use('/api/v1/money-in', moneyInRouter);

  // The box's one email account: named outward speech. Same governance as the
  // channel board — credentials + single-holder binding. requireAuth inside.
  app.use('/api/v1/email', emailRouter);

  // THE PRESS — markdown pressed into branded PDF documentation. Local
  // rendering only (real Chromium, no egress); body parsed behind auth in the
  // router with its own wide limit. requireAuth inside.
  app.use('/api/v1/doc-press', docPressRouter);

  // THE IMAGE FORGE — supervised ComfyUI manage surface (status/launch/stop/
  // free). The backend is the engine's SOLE client (loopback, no auth on the
  // engine side — NFR-3); the desk only ever talks to these routes.
  app.use('/api/v1/image-forge', imageForgeRouter);
  app.use('/api/v1/gallery', galleryRouter);

  // Platform invariants — the no-bias floor NEUMA holds itself to. Public and
  // observable (served like the covenant docs), so the commitment is checkable
  // from outside the repo.
  app.use('/api/v1/invariants', invariantsRouter);

  // The running version + changelog as DATA — public and observable like the
  // invariants, so every party (the desk, every being, any caller) can review
  // what the house runs (ruling, 2026-09-23).
  app.use('/api/v1/version', versionRouter);

  // Public liveness — MUST be mounted before the blanket-requireAuth routers at
  // bare /api/v1 below, or they 401 it (the Electron shell readiness check and the
  // Docker HEALTHCHECK both rely on a public 200 here).
  app.use('/api/v1/health', healthRouter);
  // The ICS subscribe feed is TOKEN-authed (calendar-share.js) — a calendar
  // app carries no session — so it too stands before every blanket-requireAuth
  // router (memoryRouter at bare /api/v1, taskRouter at /api/v1/tasks): mounted
  // after them it answered 401 to every subscriber on the real server.
  app.use('/api/v1/tasks', calendarFeedRouter);

  // Auth-protected routes (order no longer matters among these)
  app.use('/api/v1/mcp', mcpRouter);
  app.use('/api/v1', memoryRouter);
  app.use('/api/v1', llmRouter);
  app.use('/api/v1/attachments', attachmentRouter);
  app.use('/api/v1', skillRouter);
  app.use('/api/v1', neumaDatabaseRoutes);
  app.use('/api/v1/workspace', workspaceRouter);
  // The operator's own record of what their beings did (SEC-035 #213).
  app.use('/api/v1/acts', actRouter);
  app.use('/api/v1/weave', weaveRouter);
  app.use('/api/v1/user/realm', userRealmRouter);
  // The witness's own dream journal, recorded on the phone (docs/work/pocket-dreams.md).
  app.use('/api/v1/user/dreams', dreamRouter);
  app.use('/api/v1/look', lookRouter);
  app.use('/api/v1/user/files', userFilesRouter);
  app.use('/api/v1/user/projects', userProjectsRouter);
  app.use('/api/v1/tasks', taskRouter);
  app.use('/api/v1/vitals', vitalRouter);
  app.use('/api/v1/llm/model-folders', modelFolderRouter);
  app.use('/api/v1/web', webRouter);
  app.use('/api/v1/map', mapRouter);
  app.use('/api/v1/residency', residencyRouter);
  app.use('/api/v1/meditation', meditationRouter);
  app.use('/api/v1/mind', mindRouter);
  app.use('/api/v1/expression', expressionRouter);
  app.use('/api/v1/sovereignty', sovereigntyRouter);
  // Wallet portfolio prices — non-secret market data, but self-gated by requireAuth
  // inside the router (keeps the auth posture; blocks anon-driven outbound fetches).
  app.use('/api/v1/prices', priceRouter);
  app.use('/api/v1/neuma', neumaWalletRouter);
  app.use('/api/v1/neuma', recoveryRouter);
  app.use('/api/v1/neuma', neumaRouteRouter);
  // The composer's model bar — one being's models + effort rung (neuma or witness
  // lane); owner-gated inside the router.
  app.use('/api/v1/inference', inferenceRouter);
  app.use('/api/v1/refinement', refinementRouter);
  app.use('/api/v1/attunement', attunementRouter);
  app.use('/api/v1/remia', remiaRouter);
  app.use('/api/v1/routing', routingRouter);
  // Who owns this computer, and the owner's co-owners (install-owner.js).
  app.use('/api/v1/install-owner', installOwnerRouter);
  // The deliberate claim of an unclaimed lane: seal-matched, or the owner's adoption.
  app.use('/api/v1/lanes', laneClaimRouter);
  // Sealed AI witnesses — the management surface (seal/lane/route status + live
  // route probe). Router-level requireAuth inside; masked output only.
  app.use('/api/v1/witnesses', witnessRouter);
  app.use('/api/v1/harness', harnessRouter);
  // The terminal's agent launcher (which CLI agents this machine can spawn)
  app.use('/api/v1/terminal', terminalAgentsRouter);
  app.use('/api/v1/voice', voiceRouter);
  app.use('/api/v1/voice', sttRouter);
  app.use('/api/v1/voice', refineRouter);
  app.use('/api/v1/voice/engines', voiceEngineRouter);
  app.use('/api/v1/voice/forge', voiceForgeRouter);

  // Portal status
  app.get('/api/v1/portal/status', (req, res) => {
    res.json({
      status: 'active',
      connections: getConnectionCount(),
      message: 'The portal remains stable'
    });
  });

  // --- Backwards compatibility: /api/X → /api/v1/X redirect ---
  // Remove this once all clients have migrated to /api/v1/
  app.use('/api', (req, res, next) => {
    // Already versioned — pass through
    if (req.path.startsWith('/v1/')) return next();
    // Redirect unversioned API calls to v1
    const versionedUrl = `/api/v1${req.path}${req.url.includes('?') ? '?' + req.url.split('?')[1] : ''}`;
    res.redirect(307, versionedUrl);
  });
};
