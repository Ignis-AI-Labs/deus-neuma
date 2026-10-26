/**
 * The boot/lifecycle sequence — directories, tool surface, schedulers, the
 * listen, and every shutdown path (signals + desk-parent watch).
 *
 * Extracted verbatim from backend/server.js (2026-08-26, the size-law
 * breakdown campaign): after the route-mount extraction (routes/
 * route-mounts.js) this was the file's largest remaining cohesive section.
 * server.js stays the entry point — it validates config, builds the app, the
 * HTTP server and the WS servers, then hands them here. This module NEVER
 * imports server.js (direction law); everything born in the entry point
 * (server, wss, terminalWss, config, log) arrives as parameters.
 *
 * ORDER MATTERS — the boot steps carry ordering laws, and their comments
 * moved with them: the tool surface and skill packs are fire-and-observe,
 * never awaited in front of the listen (INFRA-008 #210); every guarded step
 * degrades rather than blocks the bind; listenServer runs LAST. Shutdown
 * tells the MCP transports we are going BEFORE the drain (INFRA-009 #211),
 * and the same shutdown runs when the desk that spawned us dies (#215).
 */
import { mkdirSync } from 'fs';
import { join } from 'path';
import { createLogger } from './services/logger.js';
import { mcpService } from './services/mcp.js';
import { connectFilesystemServer } from './services/mcp-filesystem.js';
import { installFdCustody } from './services/fd-custody.js';
import platform from './services/supabase.js';
import { getWorkspacesRoot } from '../core/index.js';
import { testConnection, getConfig as getLlmConfig } from './services/llm-provider.js';
import { launchReady, activeLaunchConfig } from './services/llama-server-supervisor.js';
import { getSubstrateProfile } from './services/substrate-detector.js';
import { runPreflight, startSubstrateIdleMonitor } from './services/substrate-lifecycle.js';
import { startHeartbeat, stopHeartbeat } from './services/heartbeat.js';
import { gracefulShutdown } from './services/shutdown.js';
import { listenServer } from './services/server-listen.js';
import { watchDeskParent } from './services/desk-parent-watch.js';
import { getDataRoot, getVaultRoot } from './services/data-root.js';
import { skillService, defaultSkillsRoot } from './services/skill-service.js';
import { seedShippedPacks, seedLanded } from './services/skill-packs.js';
import { broadcastStorageWarning, localTurnSnapshot } from './routes/portal-routes.js';
import { startMeditationScheduler } from './services/meditation/meditation-scheduler.js';
import { startPostScheduler } from './services/social/post-scheduler.js';
import { startStatsSweep } from './services/social/stats/stats-sweep.js';
import { startStatusScheduler } from './services/staff/status-sweep.js';
import { startHouseClock } from './services/house-clock/house-clock.js';
import { startReplyListener } from './services/social/reply-listener.js';
import { startSecurityScheduler } from './services/security/security-scheduler.js';
import { startLegalScheduler } from './services/legal/legal-scheduler.js';
import { startDraftReview } from './services/marketing/draft-review.js';
import { startMoneyInScheduler } from './services/money-in/money-in-scheduler.js';
import { startBenchWatchdog, stopBenchWatchdog } from './services/bench/bench-watchdog.js';
import { settleLostChains } from './services/bench/bench-matched.js';
import { resumeBenchChain } from './services/bench/bench-launch.js';
import { startLineWidthWatch } from './services/substrate-lease.js';
import { comfyShutdown } from './services/image-forge/comfyui-supervisor.js';
import { startRemoteTunnel, stopRemoteTunnel } from './services/remote/wire.js';
import { hydrateStoredSecrets } from './services/stored-secrets.js';

/**
 * Run the whole boot sequence and wire the shutdown paths.
 * // impure — starts services, binds the port, registers process handlers
 * @param {object} deps
 * @param {import('http').Server} deps.server
 * @param {import('ws').WebSocketServer} deps.wss - portal WS (drained on shutdown)
 * @param {import('ws').WebSocketServer} deps.terminalWss - terminal WS (drained on shutdown)
 * @param {import('ws').WebSocketServer} [deps.dictateWss] - dictation WS (drained on shutdown)
 * @param {object} deps.config - the validated app config from loadConfig()
 * @param {object} deps.log - the entry point's 'Server' logger
 */
export const bootServer = ({ server, wss, terminalWss, dictateWss, config, log }) => {
  const mcpLog = createLogger('MCP');

  // A rejection no caller holds must not end the desk: Electron does not
  // respawn its backend, so Node's default (exit) is a dead app — once right
  // after an operator paid gas (ethers' receipt wait, 2026-10-19). Logged at
  // error level with its stack, never hidden; the bug is fixed at its source.
  process.on('unhandledRejection', (reason) => {
    log.error('Unhandled promise rejection — the backend stays up; fix it where it was thrown', {
      error: reason instanceof Error ? reason.message : String(reason),
      code: reason?.code,
      stack: reason instanceof Error ? reason.stack : undefined,
    });
  });

  // Held so graceful shutdown can silence the campaign lane before draining.
  let stopPostScheduler = null;
  let stopReplyListener = null;
  let stopMeditation = null;
  // Same for the CSO's standing watch.
  let stopSecurityScheduler = null;
  let stopLegalScheduler = null;
  let stopMoneyIn = null;
  let stopStatusSweep = null;
  let stopHouseClock = null;

  // --- Directory bootstrapping ---

  const ensureDirectories = () => {
    // data/memory-store is NOT bootstrapped: the legacy global graph is retired
    // (CORE-001 / #116) — existing installs keep their historical dir untouched,
    // fresh installs never grow an empty one. The tool-sandbox deny on that path
    // stays as defense in depth.
    // Vault + workspaces are sovereign, writable stores — under their own roots
    // (NEUMA_VAULT_ROOT / WORKSPACES_ROOT in the packaged app, repo dirs in dev).
    const dirs = [
      join(getVaultRoot(), 'dna/active'), join(getVaultRoot(), 'dna/history'), join(getVaultRoot(), 'audit'),
      getWorkspacesRoot()
    ];
    for (const dir of dirs) {
      mkdirSync(dir, { recursive: true });
    }
    // Runtime-writable data dirs live under the data root (NEUMA_DATA_ROOT in
    // the packaged app, the repo's data/ in dev).
    for (const dir of ['temp', 'dna-cache']) {
      mkdirSync(join(getDataRoot(), dir), { recursive: true });
    }
    log.info('Directories bootstrapped');
  };

  // --- Initialize services ---

  const initializeMCP = async () => {
    try {
      mcpLog.info('Initializing tool surface');
      try {
        // Stand the native filesystem organ on the project dir AND the
        // sovereign-workspaces root, so a neuma's lane is physically reachable
        // by its file tools (the per-neuma sandbox confines each to its own
        // lane). In-process — connectFilesystemServer spawns nothing.
        const roots = await connectFilesystemServer();
        mcpLog.info('Filesystem organ standing', { roots });
      } catch (err) {
        // Only a real disk fault lands here now (no child process to fail) —
        // say so; "install via UI" was the child-process era's advice.
        mcpLog.error('Filesystem organ failed to stand', { err: err.message });
      }
      mcpLog.info('Tool surface ready');
    } catch (error) {
      mcpLog.error('Initialization error', { err: error.message });
    }
  };

  // --- Start ---

  async function startServer() {
    installFdCustody(); // leaked FileHandles name their opener — see fd-custody.js
    // Ensure directories exist. Guarded: a boot step must never prevent the server
    // from listening — a subsystem that can't initialize should degrade and be
    // reported, not stop the backend (electron/backend-spawn.cjs owns the child).
    try {
      ensureDirectories();
    } catch (err) {
      log.error('ensureDirectories failed — continuing to boot', { err: err.message });
    }

    // The tool surface comes up ALONGSIDE the listen, never in front of it
    // (INFRA-008 #210 — in the child-process era a cold `npx` could eat the
    // whole 30s connect timeout while /api/v1/health did not exist yet, and the
    // Electron shell's own 30s wait quit the app; Mars's machine, 2026-07-29).
    // The filesystem organ is in-process now and stands in milliseconds, but
    // the ordering law survives it: nothing before the listen needs the tool
    // surface — a being's turn reads it live — so this stays fire-and-observe,
    // the same shape as the substrate ignition below. The catch is empty
    // because initializeMCP logs its own failure; it cannot reject silently.
    initializeMCP().catch(() => {});

    // THE CRAFT SHIPS WITH THE HOUSE (Design note, 2026-08-05: […]).
    //
    // `skills-packs/` and the plugin installer both already existed; nothing ever
    // wired them together, so a real install booted with an EMPTY skills root and
    // every sc-* protocol, team-project, and natalis-self-seal existed only on
    // machines where someone had run an installer by hand.
    //
    // Fire-and-observe, exactly like MCP above: the skills root is read live at
    // summon time, so nothing before the listen needs it — and a malformed pack
    // must cost that pack, never the boot. seedShippedPacks never rejects.
    seedShippedPacks(defaultSkillsRoot())
      .then((report) => {
        // A seed that landed changed the root out from under a registry that may
        // already have been scanned — `refresh()` makes the next read see it.
        if (report.some(seedLanded)) skillService.refresh();
      })
      .catch((err) => log.warn('skill packs not seeded — the house boots without them', { err: err.message }));

    // platform.init() degrades on a driver load/open failure but re-throws a
    // dbPath misconfig — guard it here so even that can't stop the server from
    // listening (the singleton is left on its safe no-op driver, so platform
    // calls degrade rather than crash).
    // Keys saved in Settings → API (search, page reader, downloads, chain RPC) load before anything asks for one.
    await hydrateStoredSecrets();

    try {
      await platform.init();
    } catch (err) {
      log.error('platform.init failed — platform persistence disabled, continuing to boot', { err: err.message });
    }

    // LLM health check (warn only — user can configure via UI). For the
    // backend-supervised provider a DOWN substrate is not a misconfiguration —
    // the preflight right below boots it — so warn only when the launch
    // genuinely cannot succeed (binary/model missing). The old blind probe
    // logged […] into the failures feed on
    // EVERY boot of a healthy llama-server rig (idle-unloaded substrate),
    // sending witnesses to fix settings that were never wrong.
    try {
      if (getLlmConfig().provider === 'llama-server') {
        const ready = launchReady(activeLaunchConfig(process.env));
        if (ready.ready) {
          log.info('Substrate supervised — preflight ensures serving');
        } else {
          log.warn('llama-server launch prerequisites missing — check LLAMA_SERVER_BIN / LLAMA_SERVER_MODEL', ready);
        }
      } else {
        const llmOk = await testConnection();
        if (llmOk) {
          log.info('LLM provider connected');
        } else {
          log.warn('LLM provider not reachable — configure via Settings > LLM tab');
        }
      }
    } catch {
      log.warn('LLM provider not reachable — configure via Settings > LLM tab');
    }

    // Substrate preflight — every app launch, if the backend-supervised substrate
    // (llama-server) is down and can boot, boot it fire-and-observe so the witness
    // never lands on a dead model. Guarded internally: never blocks the listen.
    await runPreflight();

    // Idle-unload — graceful hardware return: release the substrate's VRAM after
    // it sits idle, reloaded on the next summon. Guarded: a monitor that can't
    // start must not stop the server from listening.
    try {
      startSubstrateIdleMonitor({ idleMinutes: config.substrateIdleMinutes });
    } catch (err) {
      log.error('idle monitor failed to start — continuing to boot', { err: err.message });
    }

    // Claude Code bridge — Claude through the operator's own subscription

    // Substrate detection (non-critical — informational only)
    try {
      const substrate = await getSubstrateProfile();
      const gpu = substrate.gpu ? `${substrate.gpu.name} (${substrate.gpu.vramGB}GB)` : 'none';
      log.info('Substrate detected', {
        cores: substrate.cpu.cores,
        ramGB: substrate.memory.totalGB,
        gpu,
        llmModel: substrate.llm.model,
        llmProvider: substrate.llm.provider,
      });
    } catch { /* substrate detection non-critical */ }

    // Between-session heartbeat — neuma reflect while no portal is open; the
    // same pulse now watches disk headroom (storage:warning to open desks) and
    // sweeps expired tool-result logs (2026-07-04 isolation audit).
    if (config.heartbeatIntervalMinutes > 0) {
      try {
        startHeartbeat(config.heartbeatIntervalMinutes * 60 * 1000, {
          onStorageWarning: broadcastStorageWarning,
        });
      } catch (err) {
        log.error('heartbeat failed to start — continuing to boot', { err: err.message });
      }
    }

    // The standing loops, each guarded the same way: a scheduler that cannot
    // start must never stop the listen.
    const startGuarded = (label, start) => {
      try { return start(); }
      catch (err) { log.error(`${label} failed to start — continuing to boot`, { err: err.message }); return null; }
    };
    // Campaign lane — publish witness-approved queued posts when their time arrives.
    stopPostScheduler = startGuarded('post scheduler', startPostScheduler);
    // Reply lane — watch who answers the house's posts on X.
    stopReplyListener = startGuarded('reply listener', startReplyListener);
    // The stats sweep — what the house's posts did, read back on a decaying
    // schedule, read-only; NEUMA_STATS_SWEEP=0 keeps it down.
    startGuarded('stats sweep', startStatsSweep);
    // The CSO's standing watch — the 24-hour dependency/secret/host/house scan.
    stopSecurityScheduler = startGuarded('security scheduler', startSecurityScheduler);
    // The CLO's standing watch — licences shipped, the house's papers, and
    // what the new work touches, every 24 hours.
    stopLegalScheduler = startGuarded('legal scheduler', startLegalScheduler);
    // The claims check — every waiting draft read against its company's kit;
    // what needs a legal reading is filed with the CLO office. It flags, never holds.
    startGuarded('claims review', startDraftReview);
    // The money-in watch — what the house received, every 10 minutes, read-only.
    stopMoneyIn = startGuarded('money-in watch', startMoneyInScheduler);
    // The Optio office's cadence — standing status checks on open charges.
    stopStatusSweep = startGuarded('status sweep', startStatusScheduler);
    // The house clock — the house wakes itself for its own work, inside the
    // charter its operator approved (house-clock.js).
    stopHouseClock = startGuarded('house clock', startHouseClock);
    // The bench watch — sees and says (stalls, crunch, serving incidents);
    // never kills, never relights. No-op when no harness stands on this box.
    startGuarded('bench watchdog', startBenchWatchdog);
    // A set the last process ran is carried on (its arms outlive the desk);
    // a set that cannot be is told to the chat that watched it.
    startGuarded('lost bench watches', async () => settleLostChains(await resumeBenchChain()));
    // The house's model line runs as wide as this rig was MEASURED to run — the
    // only cap on parallel sittings; open tabs are never capped (2026-10-15).
    startGuarded('line width', startLineWidthWatch);
    // The meditation loop — piggyback-only dreams; the portal turn truth is injected.
    stopMeditation = startGuarded('meditation scheduler', () => startMeditationScheduler({ turnSnapshot: localTurnSnapshot }));
    // The native road (Road B) — binds only if a native road is already on;
    // a tunnel that cannot start costs the road, never the listen.
    startGuarded('remote tunnel', startRemoteTunnel);

    // Bind only after every service is ready; the listener owns collision
    // reporting and returns the real port when the kernel assigned `:0`.
    listenServer({ server, config, log, mcpService });
  }

  startServer().catch(err => {
    log.error('Fatal startup error', { err: err.message, stack: err.stack });
    process.exit(1);
  });

  // Graceful shutdown — stop the heartbeat + close the WebSockets so the HTTP
  // server actually drains, with a hard deadline. Clean enough for systemd
  // Restart and node --watch (no more wedged :3333 on restart — resolves #37).
  const shutdown = () => {
    stopPostScheduler?.(); // no tick may fire into the drain window
    stopReplyListener?.(); // the reply lane's heartbeat stops with it
    stopSecurityScheduler?.(); // the CSO's watch stops with the server
    stopLegalScheduler?.(); // the CLO's watch stops with the server
    stopMoneyIn?.(); // the money-in watch stops with the server
    stopStatusSweep?.(); // the office's cadence stops with the server
    stopHouseClock?.(); // no wake starts into the drain window
    stopBenchWatchdog(); // the bench watch stops with the server
    stopMeditation?.(); // an in-flight dream aborts; nothing of it lands
    stopRemoteTunnel?.().catch(() => {}); // the native road's listeners close with it
    // Owned ComfyUI must not outlive a clean exit (B-4 law); adopted instances
    // are left alone. Fire-and-forget: the drain deadline still governs.
    comfyShutdown().catch(() => {});
    // Close the MCP transports DELIBERATELY (INFRA-009 #211). A server that
    // learns of our exit from a collapsing pipe dies on an unhandled EPIPE and
    // prints a crash trace that reads like a real fault on a perfectly clean
    // quit. Telling it we are going is the difference between an exit and a
    // stack. Fire-and-forget for the same reason as ComfyUI above — the drain
    // deadline governs, and a transport that will not close must not hold the
    // process open.
    mcpService.disconnectAll().catch(() => {});
    return gracefulShutdown({
      server,
      sockets: [wss, terminalWss, dictateWss].filter(Boolean),
      stopHeartbeat,
      log,
      exit: (code) => process.exit(code),
    });
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  // THE DESK IS GONE, AND SO ARE WE.
  //
  // Spawned by the desk we lead our own process group (#211), which means the
  // terminal's Ctrl-C never reaches us and a desk that is SIGKILLed or crashes
  // runs no cleanup at all. Either way this process would go on holding the port,
  // and the operator's next launch would fail with EADDRINUSE — reading as a port
  // conflict rather than the truth, which is that the last one never died (#215).
  //
  // The same shutdown as a signal: MCP transports are told we are going before
  // the pipes collapse, so nothing dies on an EPIPE on the way out.
  watchDeskParent({
    onOrphaned: (deskPid) => {
      log.info('The desk that spawned this backend is gone — standing down', { deskPid });
      shutdown();
    },
  });
};
