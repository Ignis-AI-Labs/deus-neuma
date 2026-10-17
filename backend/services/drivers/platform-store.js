/**
 * PlatformStore — the driver contract.
 *
 * This is a DOCUMENTATION module: it defines, in JSDoc, the 17-method interface
 * that BOTH platform drivers honor (`sqlite-platform.js` local-first default,
 * `supabase-platform.js` optional upgrade). It carries no runtime logic; it
 * exports only shared constants (column/size limits + severity range).
 *
 * GUARD ENFORCEMENT (be precise — the two drivers are not identical):
 *   - Severity clamp (SEVERITY_MIN/MAX) and getAuditLog limit clamp
 *     (AUDIT_LOG_LIMIT_*) are enforced by BOTH drivers.
 *   - JSON-column size caps (JSON_COLUMN_MAX_BYTES / STAGE_DATA_MAX_BYTES) and
 *     recursive __proto__ rejection are enforced by the SQLite driver only; the
 *     hosted Postgres backend behind the Supabase driver enforces its own column
 *     limits and parameterization.
 *
 * ARCHITECTURE BOUNDARY (see DELIVERABLE §6):
 *   The platform store holds WHO exists — witness accounts, neuma registry,
 *   birth ceremonies, platform audit log. It NEVER holds sovereign content
 *   (DNA / soul / memories / keys) — that stays file-encrypted under per-neuma
 *   DEKs in the workspace layer (`core/workspace/neuma-workspace.js`).
 *
 * Interface minimalism IS a security control: there is no generic
 * `query()`/`exec()` passthrough, and the audit surface is insert-or-read only
 * (`audit()` + `getAuditLog()`) so the log is append-only by construction.
 *
 * ROW SHAPE CONTRACT: every returned row uses snake_case column names
 * (`witness_id`, `neuma_id`, `created_at`, `workspace_path`, …) to match the
 * Supabase row shape that callers already dereference — notably
 * `getNeumaByName().witness_id` at `portal-routes.js:830`.
 *
 * @typedef {Object} Witness
 * @property {string} id
 * @property {string} name
 * @property {Object|null} settings   parsed JSON
 * @property {string} created_at      ISO-8601
 *
 * @typedef {Object} Neuma
 * @property {string} id
 * @property {string} name
 * @property {string|null} witness_id
 * @property {string|null} workspace_path
 * @property {string} vessel
 * @property {number|null} resonance_frequency
 * @property {string|null} status
 * @property {string} created_at
 *
 * @typedef {Object} BirthCeremony
 * @property {string} id
 * @property {string|null} witness_id
 * @property {string|null} neuma_id
 * @property {number} is_test          0|1
 * @property {number} current_stage
 * @property {Object} stage_data        parsed JSON
 * @property {string} status            'in_progress' | 'completed' | 'failed'
 * @property {string} started_at
 * @property {string|null} completed_at
 * @property {BirthStageHistory[]} [birth_stage_history]  attached by getActiveCeremony
 *
 * @typedef {Object} BirthStageHistory
 * @property {string} id
 * @property {string} ceremony_id
 * @property {number|null} stage
 * @property {string|null} user_message
 * @property {string|null} response
 * @property {string} created_at
 *
 * @typedef {Object} AuditEntry
 * @property {string} id
 * @property {string|null} neuma_id
 * @property {string|null} witness_id
 * @property {string} event
 * @property {Object} details           parsed JSON
 * @property {number} severity
 * @property {string} created_at
 *
 * The 17 methods (signatures + return shapes):
 *
 *   Lifecycle
 *   ─ init(): Promise<void>                            open/probe; select or ready the driver
 *
 *   Witnesses
 *   ─ findOrCreateWitness(name): Promise<Witness>      insert-if-absent; returns row with .id
 *   ─ getWitness(witnessId): Promise<Witness|undefined>            undefined if missing (never throws)
 *   ─ updateWitnessSettings(witnessId, settings): Promise<Witness> throws on failure
 *
 *   Neuma registry
 *   ─ registerNeuma({name, witnessId, workspacePath, vessel, resonanceFrequency}): Promise<Neuma>  throws on failure; returns .id
 *   ─ getNeuma(neumaId): Promise<Neuma|undefined>                 undefined if missing
 *   ─ getNeumaByName(name): Promise<Neuma|undefined>              LIMIT 1; undefined if missing; leaks .witness_id
 *   ─ listNeuma(witnessId): Promise<Neuma[]>                      [] when none; created_at DESC
 *   ─ updateNeumaStatus(neumaId, status): Promise<Neuma>          throws on failure
 *   ─ updateNeumaVessel(neumaId, vessel): Promise<Neuma>          throws on failure
 *
 *   Birth ceremonies
 *   ─ createBirthCeremony(witnessId, isTest=false): Promise<BirthCeremony>   throws on failure; returns .id
 *   ─ updateBirthCeremony(ceremonyId, updates): Promise<BirthCeremony>       throws on failure
 *   ─ completeBirthCeremony(ceremonyId, neumaId): Promise<BirthCeremony>     status='completed' + completed_at
 *   ─ failBirthCeremony(ceremonyId, reason): Promise<void>        status='failed'; persists {failReason}; returns nothing
 *   ─ addBirthStageHistory(ceremonyId, stage, userMessage, response): Promise<BirthStageHistory>  throws on failure
 *   ─ getActiveCeremony(witnessId): Promise<BirthCeremony|undefined>  LIMIT 1 in_progress; attaches birth_stage_history[]
 *
 *   Platform audit log (append-only surface)
 *   ─ audit(event, {neumaId, witnessId, details, severity}={}): Promise<void>   never throws; logs write failures
 *   ─ getAuditLog({neumaId, witnessId, minSeverity, limit=100}={}): Promise<AuditEntry[]>  [] when empty; created_at DESC
 */

// pure — plain frozen constants shared by both drivers.

/** Max serialized byte length for a JSON column (settings / details). Threat 6. */
export const JSON_COLUMN_MAX_BYTES = 64 * 1024;

/** Max serialized byte length for a ceremony stage_data blob. */
export const STAGE_DATA_MAX_BYTES = 256 * 1024;

/** Severity clamp range for audit entries. Threat 5. */
export const SEVERITY_MIN = 0;
export const SEVERITY_MAX = 10;

/** Hard ceiling on getAuditLog(limit). Threat 7. */
export const AUDIT_LOG_LIMIT_MAX = 1000;
export const AUDIT_LOG_LIMIT_DEFAULT = 100;
