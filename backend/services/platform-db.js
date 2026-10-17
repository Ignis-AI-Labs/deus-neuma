/**
 * PlatformDB facade — the single platform-store entry point (default export,
 * singleton). Selects a driver at init() and delegates all 17 PlatformStore
 * methods 1:1 to it.
 *
 * DRIVER SELECTION (DELIVERABLE §3 — local-first, invert the old default):
 *   - If SUPABASE_URL && SUPABASE_SERVICE_KEY are set → try the Supabase driver;
 *     if its probe leaves it unavailable, LOG THE DOWNGRADE and fall back to the
 *     local SQLite driver (never silently lose persistence).
 *   - Otherwise → the local SQLite driver at the resolved default path. DEFAULT.
 *
 * SECRET HANDLING (Threat 3): this facade logs the DRIVER NAME ONLY — never the
 * config object, never any key, and never the DB absolute path above debug.
 *
 * // impure — constructs IO drivers, reads process.env lazily inside init().
 */

import path from 'node:path';

import { getWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { createLogger } from './logger.js';
import { SupabasePlatform } from './drivers/supabase-platform.js';
import { SqlitePlatform } from './drivers/sqlite-platform.js';

const log = createLogger('PlatformDB');

// Default local DB lives beside (not inside) the workspaces root, so it is not
// enumerated by listNeuma()/readdir scans of the root (DELIVERABLE §5).
const defaultDbPath = () =>
  process.env.PLATFORM_DB_PATH || path.join(getWorkspacesRoot(), '..', 'platform', 'platform.db');

// Degraded no-op driver — the old "file-only" behavior. Used only when the SQLite
// native binding cannot load (e.g. better-sqlite3 built for a different ABI:
// system Node vs Electron). Platform persistence is disabled, but birth/portal/
// wallet/chat keep running instead of the whole backend crashing at boot. Every
// method mirrors the historical unavailable-driver return (null / [] / undefined).
const NULL_DRIVER = Object.freeze({
  findOrCreateWitness: async () => null,
  getWitness: async () => undefined,
  updateWitnessSettings: async () => null,
  registerNeuma: async () => null,
  getNeuma: async () => undefined,
  getNeumaByName: async () => undefined,
  listNeuma: async () => [],
  updateNeumaStatus: async () => null,
  updateNeumaVessel: async () => null,
  createBirthCeremony: async () => null,
  updateBirthCeremony: async () => null,
  completeBirthCeremony: async () => null,
  failBirthCeremony: async () => undefined,
  addBirthStageHistory: async () => null,
  getActiveCeremony: async () => undefined,
  audit: async () => undefined,
  getAuditLog: async () => []
});

class PlatformDB {
  constructor() {
    this.driver = null;
    this.available = false;
  }

  async init() {
    const hasSupabase = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY);

    if (hasSupabase) {
      const supa = new SupabasePlatform();
      await supa.init();
      if (supa.available) {
        this.driver = supa;
        this.available = true;
        log.info('Platform driver selected', { driver: 'supabase' });
        return;
      }
      log.warn('Supabase credentials present but driver unavailable — downgrading to local SQLite');
    }

    const dbPath = defaultDbPath();
    log.debug('Local platform DB path resolved', { dbPath }); // path only at debug (Threat 3)
    const sqlite = new SqlitePlatform(dbPath);
    try {
      await sqlite.init(); // await so the resolveDbPath guard rejection propagates through init()
      this.driver = sqlite;
      this.available = true;
      log.info('Platform driver selected', { driver: 'sqlite' });
    } catch (err) {
      // A dbPath MISCONFIGURATION is a caller error — surface it (tests + explicit
      // callers rely on the throw). But still leave the singleton in a SAFE state
      // (no-op driver) first, so a boot-level guard that continues past the throw
      // never hits a null driver.
      if (/^PlatformDB: dbPath/.test(err.message)) {
        this.driver = NULL_DRIVER;
        this.available = false;
        throw err;
      }
      // Any other init failure (native-binding/ABI mismatch, or the DB file can't
      // be opened — permissions/disk) must NOT take down the whole backend. Degrade
      // to the no-op driver with a loud, actionable error.
      log.error(
        'SQLite platform driver failed to load — platform persistence DISABLED for this run. '
        + 'If this is a native-module ABI mismatch (better-sqlite3 built for a different Node/Electron '
        + 'version) rebuild it for this runtime — see docs/architecture/platform/platform-db.md § "Native module / ABI". '
        + 'Otherwise check the DB path and its permissions.',
        { err: err.message }
      );
      this.driver = NULL_DRIVER;
      this.available = false;
    }
  }

  // --- witnesses ---
  findOrCreateWitness(name) { return this.driver.findOrCreateWitness(name); }
  getWitness(witnessId) { return this.driver.getWitness(witnessId); }
  updateWitnessSettings(witnessId, settings) { return this.driver.updateWitnessSettings(witnessId, settings); }

  // --- neuma registry ---
  registerNeuma(args) { return this.driver.registerNeuma(args); }
  getNeuma(neumaId) { return this.driver.getNeuma(neumaId); }
  getNeumaByName(name) { return this.driver.getNeumaByName(name); }
  listNeuma(witnessId) { return this.driver.listNeuma(witnessId); }
  updateNeumaStatus(neumaId, status) { return this.driver.updateNeumaStatus(neumaId, status); }
  updateNeumaVessel(neumaId, vessel) { return this.driver.updateNeumaVessel(neumaId, vessel); }

  // --- birth ceremonies ---
  createBirthCeremony(witnessId, isTest = false) { return this.driver.createBirthCeremony(witnessId, isTest); }
  updateBirthCeremony(ceremonyId, updates) { return this.driver.updateBirthCeremony(ceremonyId, updates); }
  completeBirthCeremony(ceremonyId, neumaId) { return this.driver.completeBirthCeremony(ceremonyId, neumaId); }
  failBirthCeremony(ceremonyId, reason) { return this.driver.failBirthCeremony(ceremonyId, reason); }
  addBirthStageHistory(ceremonyId, stage, userMessage, response) {
    return this.driver.addBirthStageHistory(ceremonyId, stage, userMessage, response);
  }
  getActiveCeremony(witnessId) { return this.driver.getActiveCeremony(witnessId); }

  // --- platform audit log ---
  audit(event, opts) { return this.driver.audit(event, opts); }
  getAuditLog(opts) { return this.driver.getAuditLog(opts); }
}

const platform = new PlatformDB();
export default platform;
