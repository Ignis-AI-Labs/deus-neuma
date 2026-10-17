/**
 * SqlitePlatform — the local-first, embedded platform driver (DEFAULT).
 *
 * Backed by `better-sqlite3` (synchronous, single-file). Owns the schema DDL,
 * connection pragmas, and the append-only audit triggers. Honors the
 * PlatformStore contract (`platform-store.js`) with Supabase-parity row shapes.
 *
 * SECURITY SPINE (DELIVERABLE §6): bound prepared statements only, `.exec()`
 * reserved for the static DDL (T1); DB path guard (T2); append-only audit
 * triggers + severity clamp + non-empty event (T5); JSON size caps + defensive
 * parse (T6); getAuditLog limit clamp (T7).
 *
 * // impure — filesystem + SQLite IO.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { openDatabase } from './sqlite-binding.js';

import { createLogger } from '../logger.js';
import {
  JSON_COLUMN_MAX_BYTES,
  STAGE_DATA_MAX_BYTES,
  SEVERITY_MIN,
  SEVERITY_MAX,
  AUDIT_LOG_LIMIT_MAX,
  AUDIT_LOG_LIMIT_DEFAULT
} from './platform-store.js';

const log = createLogger('PlatformDB');

// --- static schema (Threat 1: only ever passed to db.exec, never interpolated) ---
const DDL = `
CREATE TABLE IF NOT EXISTS witnesses (
  id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, settings TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS neuma_registry (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, witness_id TEXT, workspace_path TEXT,
  vessel TEXT DEFAULT 'default.vrm', resonance_frequency INTEGER, status TEXT, created_at TEXT NOT NULL,
  FOREIGN KEY (witness_id) REFERENCES witnesses(id)
);
CREATE TABLE IF NOT EXISTS birth_ceremonies (
  id TEXT PRIMARY KEY, witness_id TEXT, neuma_id TEXT,
  is_test INTEGER NOT NULL DEFAULT 0, current_stage INTEGER NOT NULL DEFAULT 0,
  stage_data TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'in_progress',
  started_at TEXT NOT NULL, completed_at TEXT,
  FOREIGN KEY (witness_id) REFERENCES witnesses(id),
  FOREIGN KEY (neuma_id)  REFERENCES neuma_registry(id)
);
CREATE TABLE IF NOT EXISTS birth_stage_history (
  id TEXT PRIMARY KEY, ceremony_id TEXT NOT NULL, stage INTEGER,
  user_message TEXT, response TEXT, created_at TEXT NOT NULL,
  FOREIGN KEY (ceremony_id) REFERENCES birth_ceremonies(id)
);
CREATE TABLE IF NOT EXISTS platform_audit_log (
  id TEXT PRIMARY KEY, neuma_id TEXT, witness_id TEXT, event TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '{}', severity INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_neuma           ON platform_audit_log(neuma_id);
CREATE INDEX IF NOT EXISTS idx_audit_witness         ON platform_audit_log(witness_id);
CREATE INDEX IF NOT EXISTS idx_audit_created         ON platform_audit_log(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_severity        ON platform_audit_log(severity);
CREATE INDEX IF NOT EXISTS idx_registry_witness      ON neuma_registry(witness_id);
CREATE INDEX IF NOT EXISTS idx_ceremony_witness_stat ON birth_ceremonies(witness_id, status);
CREATE INDEX IF NOT EXISTS idx_stage_ceremony        ON birth_stage_history(ceremony_id);
CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON platform_audit_log
  BEGIN SELECT RAISE(ABORT, 'platform_audit_log is append-only'); END;
CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON platform_audit_log
  BEGIN SELECT RAISE(ABORT, 'platform_audit_log is append-only'); END;
`;

const BUSY_TIMEOUT_MS = 5000;

// Columns updateBirthCeremony may set — a whitelist so a caller key can never
// become an interpolated identifier (Threat 1 defense in depth).
const CEREMONY_UPDATE_COLS = Object.freeze(['neuma_id', 'current_stage', 'stage_data', 'status', 'completed_at']);
const CEREMONY_JSON_COLS = Object.freeze(['stage_data']);

// --- pure helpers ---

const newId = () => crypto.randomUUID();
const now = () => new Date().toISOString();

/** Resolve + guard a DB path (Threat 2). Returns ':memory:' or an absolute path. */
export function resolveDbPath(dbPath) {
  if (dbPath === ':memory:') return ':memory:';
  if (typeof dbPath !== 'string' || !dbPath) throw new Error('PlatformDB: dbPath must be a non-empty string or ":memory:"');
  if (!path.isAbsolute(dbPath)) throw new Error(`PlatformDB: dbPath must be absolute (got relative: ${dbPath})`);
  if (dbPath.split(path.sep).includes('..')) throw new Error(`PlatformDB: dbPath must not contain ".." segments: ${dbPath}`);
  return dbPath;
}

/**
 * Recursively reject own `__proto__` keys at any nesting depth (Threat 6 defense
 * in depth). `__proto__` is the only key whose assignment triggers the prototype
 * setter under spread/merge; `constructor`/`prototype` as plain data keys do not
 * pollute via `{...x}`/`Object.assign`, so we do NOT reject them (avoids false
 * positives on legitimate audit/settings payloads).
 */
const MAX_JSON_DEPTH = 100;
function assertNoProtoKeys(value, label, depth = 0) {
  // Depth cap runs BEFORE JSON.stringify, so a circular ref or pathologically
  // deep object throws a clean Error here rather than a RangeError stack overflow.
  if (depth > MAX_JSON_DEPTH) throw new Error(`PlatformDB: ${label} nested deeper than ${MAX_JSON_DEPTH} levels`);
  if (Array.isArray(value)) {
    for (const item of value) assertNoProtoKeys(item, label, depth + 1);
    return;
  }
  if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      if (key === '__proto__') throw new Error(`PlatformDB: ${label} must not contain a __proto__ key`);
      assertNoProtoKeys(value[key], label, depth + 1);
    }
  }
}

/** Stringify a JSON value with a size cap (Threat 6). Rejects __proto__ keys at any depth. */
function serializeJson(value, maxBytes, label) {
  if (value === undefined || value === null) return null;
  assertNoProtoKeys(value, label);
  const text = JSON.stringify(value);
  if (Buffer.byteLength(text, 'utf8') > maxBytes) throw new Error(`PlatformDB: ${label} exceeds ${maxBytes} byte cap`);
  return text;
}

/** Defensive parse — logs + surfaces malformed rows, never throws to a getter. */
function parseJson(text, fallback, ctx) {
  if (text === null || text === undefined) return fallback;
  try {
    return JSON.parse(text);
  } catch (err) {
    log.error('Malformed JSON column surfaced', { ...ctx, err: err.message });
    return fallback;
  }
}

const clampSeverity = (s) => Math.min(Math.max(SEVERITY_MIN, Number.isFinite(s) ? Math.trunc(s) : 1), SEVERITY_MAX);
const clampLimit = (limit) => Math.min(Math.max(1, Number(limit) || AUDIT_LOG_LIMIT_DEFAULT), AUDIT_LOG_LIMIT_MAX);
const mapWitness = (r) => r && { ...r, settings: parseJson(r.settings, null, { table: 'witnesses', id: r.id }) };
const mapCeremony = (r) => r && { ...r, stage_data: parseJson(r.stage_data, {}, { table: 'birth_ceremonies', id: r.id }) };
const mapAudit = (r) => r && { ...r, details: parseJson(r.details, {}, { table: 'platform_audit_log', id: r.id }) };

export class SqlitePlatform {
  constructor(dbPath) {
    this.dbPath = dbPath;
    this.db = null;
    this.available = false;
  }

  async init() {
    const resolved = resolveDbPath(this.dbPath);
    if (resolved !== ':memory:') {
      fs.mkdirSync(path.dirname(resolved), { recursive: true, mode: 0o700 });
    }
    // The binding is chosen per RUNTIME, not baked in: node:sqlite where the
    // runtime has it (no compiled artifact, so no ABI to mismatch), the native
    // addon otherwise. See ./sqlite-binding.js for why persistence must not
    // depend on which runtime last rebuilt node_modules.
    this.db = openDatabase(resolved);
    this.binding = this.db.binding;
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma(`busy_timeout = ${BUSY_TIMEOUT_MS}`);
    this.db.exec(DDL); // static DDL only
    this.available = true;
    log.info('Local SQLite platform driver ready', { binding: this.binding });
  }
  // --- witnesses ---
  async findOrCreateWitness(name) {
    // Race-safe upsert: ON CONFLICT DO NOTHING + RETURNING gives the inserted row,
    // or nothing if a concurrent process (another local-first app instance sharing
    // the WAL file) won the race — then we read the canonical existing row. This
    // returns the same row for every caller instead of letting the loser throw on
    // the UNIQUE(name) constraint.
    const row = { id: newId(), name, settings: null, created_at: now() };
    const inserted = this.db.prepare(
      `INSERT INTO witnesses (id, name, settings, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(name) DO NOTHING RETURNING *`
    ).get(row.id, row.name, row.settings, row.created_at);
    if (inserted) return mapWitness(inserted);
    return mapWitness(this.db.prepare('SELECT * FROM witnesses WHERE name = ?').get(name));
  }

  async getWitness(witnessId) {
    return mapWitness(this.db.prepare('SELECT * FROM witnesses WHERE id = ?').get(witnessId)) || undefined;
  }

  async updateWitnessSettings(witnessId, settings) {
    const text = serializeJson(settings, JSON_COLUMN_MAX_BYTES, 'witness settings');
    const info = this.db.prepare('UPDATE witnesses SET settings = ? WHERE id = ?').run(text, witnessId);
    if (info.changes === 0) throw new Error('Failed to update witness settings: no such witness');
    return this.getWitness(witnessId);
  }
  // --- neuma registry ---
  async registerNeuma({ name, witnessId, workspacePath, vessel, resonanceFrequency }) {
    const row = {
      id: newId(), name, witness_id: witnessId ?? null, workspace_path: workspacePath ?? null,
      vessel: vessel || 'default.vrm', resonance_frequency: resonanceFrequency ?? null,
      status: null, created_at: now()
    };
    this.db.prepare(
      `INSERT INTO neuma_registry (id, name, witness_id, workspace_path, vessel, resonance_frequency, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(row.id, row.name, row.witness_id, row.workspace_path, row.vessel, row.resonance_frequency, row.status, row.created_at);
    return row;
  }

  async getNeuma(neumaId) {
    return this.db.prepare('SELECT * FROM neuma_registry WHERE id = ?').get(neumaId) || undefined;
  }

  async getNeumaByName(name) {
    return this.db.prepare('SELECT * FROM neuma_registry WHERE name = ? LIMIT 1').get(name) || undefined;
  }

  async listNeuma(witnessId) {
    return this.db.prepare('SELECT * FROM neuma_registry WHERE witness_id = ? ORDER BY created_at DESC').all(witnessId);
  }

  async updateNeumaStatus(neumaId, status) {
    const info = this.db.prepare('UPDATE neuma_registry SET status = ? WHERE id = ?').run(status, neumaId);
    if (info.changes === 0) throw new Error('Failed to update neuma status: no such neuma');
    return this.getNeuma(neumaId);
  }

  async updateNeumaVessel(neumaId, vessel) {
    const info = this.db.prepare('UPDATE neuma_registry SET vessel = ? WHERE id = ?').run(vessel, neumaId);
    if (info.changes === 0) throw new Error('Failed to update vessel: no such neuma');
    return this.getNeuma(neumaId);
  }
  // --- birth ceremonies ---
  async createBirthCeremony(witnessId, isTest = false) {
    const row = {
      id: newId(), witness_id: witnessId ?? null, neuma_id: null,
      is_test: isTest ? 1 : 0, current_stage: 0, stage_data: '{}',
      status: 'in_progress', started_at: now(), completed_at: null
    };
    this.db.prepare(
      `INSERT INTO birth_ceremonies (id, witness_id, neuma_id, is_test, current_stage, stage_data, status, started_at, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(row.id, row.witness_id, row.neuma_id, row.is_test, row.current_stage, row.stage_data, row.status, row.started_at, row.completed_at);
    return mapCeremony(row);
  }

  async updateBirthCeremony(ceremonyId, updates = {}) {
    const cols = Object.keys(updates).filter((k) => CEREMONY_UPDATE_COLS.includes(k));
    if (cols.length === 0) throw new Error('Failed to update birth ceremony: no valid columns');
    const values = cols.map((c) =>
      CEREMONY_JSON_COLS.includes(c) ? serializeJson(updates[c], STAGE_DATA_MAX_BYTES, c) : updates[c]);
    const setClause = cols.map((c) => `${c} = ?`).join(', '); // c from whitelist only
    const info = this.db.prepare(`UPDATE birth_ceremonies SET ${setClause} WHERE id = ?`).run(...values, ceremonyId);
    if (info.changes === 0) throw new Error('Failed to update birth ceremony: no such ceremony');
    return this.#getCeremony(ceremonyId);
  }

  async completeBirthCeremony(ceremonyId, neumaId) {
    const info = this.db.prepare(
      'UPDATE birth_ceremonies SET neuma_id = ?, status = ?, completed_at = ? WHERE id = ?'
    ).run(neumaId, 'completed', now(), ceremonyId);
    if (info.changes === 0) throw new Error('Failed to complete birth ceremony: no such ceremony');
    return this.#getCeremony(ceremonyId);
  }

  // Fix for supabase.js:256 discard bug — failReason is actually persisted.
  async failBirthCeremony(ceremonyId, reason) {
    const stageData = serializeJson({ failReason: reason }, STAGE_DATA_MAX_BYTES, 'stage_data');
    const info = this.db.prepare(
      'UPDATE birth_ceremonies SET status = ?, stage_data = ?, completed_at = ? WHERE id = ?'
    ).run('failed', stageData, now(), ceremonyId);
    // stage_data is overwritten with the failReason by design — the per-stage
    // post-mortem trail is preserved separately in birth_stage_history, not here.
    // Fire-and-forget by contract (parity with Supabase + audit) — do NOT throw on a
    // zero-row match (e.g. an already-completed ceremony), but surface it (Rule 3).
    if (info.changes === 0) log.warn('failBirthCeremony matched no ceremony', { ceremonyId });
  }

  async addBirthStageHistory(ceremonyId, stage, userMessage, response) {
    const row = {
      id: newId(), ceremony_id: ceremonyId, stage: stage ?? null,
      user_message: userMessage ?? null, response: response ?? null, created_at: now()
    };
    this.db.prepare(
      `INSERT INTO birth_stage_history (id, ceremony_id, stage, user_message, response, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(row.id, row.ceremony_id, row.stage, row.user_message, row.response, row.created_at);
    return row;
  }

  async getActiveCeremony(witnessId) {
    const row = this.db.prepare(
      `SELECT * FROM birth_ceremonies WHERE witness_id = ? AND status = 'in_progress'
       ORDER BY started_at DESC LIMIT 1`
    ).get(witnessId);
    if (!row) return undefined;
    const ceremony = mapCeremony(row);
    ceremony.birth_stage_history = this.db.prepare(
      'SELECT * FROM birth_stage_history WHERE ceremony_id = ? ORDER BY created_at ASC'
    ).all(row.id);
    return ceremony;
  }

  #getCeremony(ceremonyId) {
    return mapCeremony(this.db.prepare('SELECT * FROM birth_ceremonies WHERE id = ?').get(ceremonyId)) || undefined;
  }
  // --- platform audit log (append-only) ---
  // Never throws to the caller (Rule 3: log, don't swallow — fixes supabase.js:312).
  async audit(event, { neumaId, witnessId, details, severity } = {}) {
    try {
      if (typeof event !== 'string' || event.trim() === '') throw new Error('audit event must be a non-empty string');
      const detailsText = serializeJson(details ?? {}, JSON_COLUMN_MAX_BYTES, 'audit details') ?? '{}';
      this.db.prepare(
        `INSERT INTO platform_audit_log (id, neuma_id, witness_id, event, details, severity, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(newId(), neumaId || null, witnessId || null, event, detailsText, clampSeverity(severity ?? 1), now());
    } catch (err) {
      log.error('Audit write failed', { event, err: err.message });
    }
  }

  async getAuditLog({ neumaId, witnessId, minSeverity, limit = AUDIT_LOG_LIMIT_DEFAULT } = {}) {
    const clauses = [];
    const params = [];
    if (neumaId) { clauses.push('neuma_id = ?'); params.push(neumaId); }
    if (witnessId) { clauses.push('witness_id = ?'); params.push(witnessId); }
    // Validate minSeverity like limit — a non-numeric value would otherwise bind
    // as NaN and throw a confusing RangeError; instead we drop the clause.
    const minSev = Number(minSeverity);
    if (Number.isFinite(minSev)) { clauses.push('severity >= ?'); params.push(minSev); }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = this.db.prepare(
      `SELECT * FROM platform_audit_log ${where} ORDER BY created_at DESC LIMIT ?`
    ).all(...params, clampLimit(limit));
    return rows.map(mapAudit);
  }
}

export default SqlitePlatform;
