/**
 * Workspace tasks domain (SIZE-025 #372) — the being's own working lists at
 * rest: the self-authored task ledger, the settled-work history, the
 * operator-approved plan of record, the witness-assigned plan, and the
 * skill tree (The Craft). Shapes and invariants live in the pure modules
 * (core/tasks/*, core/skills/acquisition.js); this is only the at-rest
 * persistence, DEK-encrypted like every other sovereign file.
 *
 * Extracted from neuma-workspace.js with the bodies verbatim; the only
 * mechanical change is the lock registry arriving via deps.locks instead of
 * `this._withFileLock`. Cross-domain calls (`this._path`, `this._writeJSON`,
 * …) resolve on the facade instance these methods are assigned onto.
 */

import fs from 'fs/promises';
import path from 'path';
import { applyAcquisition } from '../skills/acquisition.js';
import { SOVEREIGN_DIR_MODE } from './sovereign-directory-modes.js';

/**
 * @param {{locks: {withFileLock: Function, appendLine: Function, nextTmpName: Function}}} deps
 * @returns {Readonly<Object>} async methods assigned onto the NeumaWorkspace facade
 */
export const createTasksDomain = ({ locks }) => Object.freeze({

  // ---- Task ledger (the being's own working list) ------------------------
  // Self-authored to-dos, DEK-encrypted like every other sovereign file.
  // Shape and invariants live in core/tasks/task-ledger.js (pure); this is
  // only the at-rest persistence.

  _taskLedgerPath(neumaId) {
    return path.join(this._path(neumaId), 'tasks', 'ledger.json');
  },

  /**
   * Read the being's task ledger; a missing or unreadable file reads as the
   * empty ledger (a being always HAS a ledger — it may just be blank).
   * @param {string} neumaId
   * @returns {Promise<{tasks: Array}>}
   */
  async readTaskLedger(neumaId) {
    const ledger = await this._readJSON(this._taskLedgerPath(neumaId)).catch(() => null);
    return ledger && Array.isArray(ledger.tasks) ? ledger : { tasks: [] };
  },

  /**
   * Persist the being's task ledger, encrypted at rest.
   * @param {string} neumaId
   * @param {{tasks: Array}} ledger
   * @returns {Promise<{tasks: Array}>} the stored ledger
   */
  async writeTaskLedger(neumaId, ledger) {
    if (!ledger || !Array.isArray(ledger.tasks)) {
      throw new Error('writeTaskLedger: ledger with tasks[] required');
    }
    const filePath = this._taskLedgerPath(neumaId);
    await fs.mkdir(path.dirname(filePath), { recursive: true, mode: SOVEREIGN_DIR_MODE });
    await this._writeJSON(filePath, ledger);
    return ledger;
  },

  /**
   * Read-modify-write the being's own ledger under the per-file lock — the
   * only safe mutation path, and the sibling of `updateAssignedPlan` below.
   *
   * WHY THIS EXISTS. Every task mutation is read → pure transform → write, and
   * `_writeJSON` is crash-atomic but NOT serialized: it cannot stop a second
   * writer that read the same bytes from overwriting the first. One ledger is
   * shared by every chat a being holds — which is the whole point of the
   * chat-scoping design — and by the act recorder, which writes after EVERY
   * successful tool act. So a task filed in one chat while another chat
   * recorded work simply vanished, and the being had already been told
   * "Recorded [id]". Silent loss of the record that exists to make an
   * interruption honest.
   *
   * `mutate` returns the next ledger, or null to write nothing.
   * @param {string} neumaId
   * @param {(ledger: {tasks: Array}) => {tasks: Array}|null} mutate
   * @returns {Promise<{tasks: Array}|null>} the stored ledger, or null
   */
  async updateTaskLedger(neumaId, mutate) {
    const filePath = this._taskLedgerPath(neumaId);
    return locks.withFileLock(filePath, async () => {
      const next = await mutate(await this.readTaskLedger(neumaId));
      if (!next) return null;
      await this.writeTaskLedger(neumaId, next);
      return next;
    });
  },

  // ---- Task history (the being's settled-work record) --------------------
  // Append-only record of what the being settled (done/dropped) — the
  // durable per-agent history the ledger's 20-settled retention window is
  // too short to be. Encrypted per line like every sovereign file.

  _taskHistoryPath(neumaId) {
    return path.join(this._path(neumaId), 'tasks', 'history.jsonl');
  },

  /**
   * Append one settled-task record to the being's history.
   * @param {string} neumaId
   * @param {{id: string, title: string, status: string, cadence?: string, settledAt: string}} entry
   * @returns {Promise<void>}
   */
  async appendTaskHistory(neumaId, entry) {
    if (!entry || typeof entry.title !== 'string' || !entry.status || !entry.settledAt) {
      throw new Error('appendTaskHistory: entry with title, status, and settledAt required');
    }
    await this._appendJSONL(this._taskHistoryPath(neumaId), entry);
  },

  /**
   * Read the being's settled-task history, newest first.
   * @param {string} neumaId
   * @param {{limit?: number}} [opts]
   * @returns {Promise<Array<Object>>}
   */
  async readTaskHistory(neumaId, { limit = 20 } = {}) {
    const entries = await this._readJSONL(this._taskHistoryPath(neumaId)).catch(() => []);
    return entries.slice(-limit).reverse();
  },

  // ---- Plan of record (the operator-approved team plan) ------------------
  // The durable half of a plan_submit approval — shape and invariants live in
  // core/tasks/plan-record.js (pure); this is only the at-rest persistence.

  _planRecordPath(neumaId) {
    return path.join(this._path(neumaId), 'tasks', 'plan.json');
  },

  /**
   * Read the standing plan of record; missing or unreadable reads as null —
   * no plan stands.
   * @param {string} neumaId
   * @returns {Promise<Object|null>}
   */
  async readPlanRecord(neumaId) {
    const record = await this._readJSON(this._planRecordPath(neumaId)).catch(() => null);
    return record && typeof record.goal === 'string' && Array.isArray(record.steps) ? record : null;
  },

  /**
   * Persist the plan of record, encrypted at rest. A new approval overwrites
   * the last — one plan stands at a time.
   * @param {string} neumaId
   * @param {Object} record
   * @returns {Promise<Object>} the stored record
   */
  async writePlanRecord(neumaId, record) {
    if (!record || typeof record.goal !== 'string' || !Array.isArray(record.steps)) {
      throw new Error('writePlanRecord: record with goal and steps[] required');
    }
    const filePath = this._planRecordPath(neumaId);
    await fs.mkdir(path.dirname(filePath), { recursive: true, mode: SOVEREIGN_DIR_MODE });
    await this._writeJSON(filePath, record);
    return record;
  },

  /**
   * Retire the standing plan of record — the operator ended it (ruling, 2026-10-10). The encrypted
   * record moves, untouched, to tasks/plans-ended/<when>.json: ended, never destroyed.
   * @param {string} neumaId
   * @returns {Promise<boolean>} whether a plan stood
   */
  async retirePlanRecord(neumaId) {
    const from = this._planRecordPath(neumaId);
    const dir = path.join(path.dirname(from), 'plans-ended');
    try {
      await fs.access(from);
    } catch (err) {
      if (err.code === 'ENOENT') return false;
      throw err;
    }
    await fs.mkdir(dir, { recursive: true, mode: SOVEREIGN_DIR_MODE });
    await fs.rename(from, path.join(dir, `${new Date().toISOString().replace(/[:.]/g, '-')}.json`));
    return true;
  },

  // ---- Assigned plan (the witness's list for this being) -----------------
  // Witness-authored dailies/weeklies/baseline/milestones, DEK-encrypted like
  // every other sovereign file. Kept strictly separate from the being's own
  // ledger above — the witness's list never clobbers self-authorship. Shape
  // and invariants live in core/tasks/assigned-plan.js (pure); this is only
  // the at-rest persistence.

  _assignedPlanPath(neumaId) {
    return path.join(this._path(neumaId), 'tasks', 'assigned.json');
  },

  /**
   * Read the witness-assigned plan for this being; a missing or unreadable
   * file reads as the empty plan.
   * @param {string} neumaId
   * @returns {Promise<{tasks: Array}>}
   */
  async readAssignedPlan(neumaId) {
    const plan = await this._readJSON(this._assignedPlanPath(neumaId)).catch(() => null);
    return plan && Array.isArray(plan.tasks) ? plan : { tasks: [] };
  },

  /**
   * Persist the witness-assigned plan, encrypted at rest.
   * @param {string} neumaId
   * @param {{tasks: Array}} plan
   * @returns {Promise<{tasks: Array}>} the stored plan
   */
  async writeAssignedPlan(neumaId, plan) {
    if (!plan || !Array.isArray(plan.tasks)) {
      throw new Error('writeAssignedPlan: plan with tasks[] required');
    }
    const filePath = this._assignedPlanPath(neumaId);
    await fs.mkdir(path.dirname(filePath), { recursive: true, mode: SOVEREIGN_DIR_MODE });
    await this._writeJSON(filePath, plan);
    return plan;
  },

  /**
   * Read-modify-write the witness-assigned plan under the per-file lock —
   * the only sanctioned mutation path. Racing desk windows (REST) and the
   * recurrence roll-forward must each see the plan the last write settled.
   * @param {string} neumaId
   * @param {(plan: {tasks: Array}) => {tasks: Array}} mutate - pure transform
   * @returns {Promise<{tasks: Array}>} the stored plan
   */
  async updateAssignedPlan(neumaId, mutate) {
    const filePath = this._assignedPlanPath(neumaId);
    return locks.withFileLock(filePath, async () => {
      const current = await this.readAssignedPlan(neumaId);
      const next = mutate(current);
      // a read that rolled nothing forward writes nothing (every desk refetch
      // came through here and re-encrypted an unchanged plan)
      if (JSON.stringify(next) !== JSON.stringify(current)) await this.writeAssignedPlan(neumaId, next);
      return next;
    });
  },

  // ---- Skills (The Craft) -------------------------------------------------

  /**
   * Write the skill tree for a neuma. Locked so it shares the same queue as
   * recordSkillUse — without this, a concurrent writeSkillTree +
   * recordSkillUse can clobber each other (ai6 S2 R1.2 — same
   * concurrency-discipline class as #121).
   * @param {string} neumaId - Neuma identifier
   * @param {Object} tree - Skill tree data with skills array
   * @returns {Promise<void>}
   */
  async writeSkillTree(neumaId, tree) {
    const treePath = path.join(this._path(neumaId), 'skills', 'tree.json');
    return locks.withFileLock(treePath, async () => {
      await this._writeJSON(treePath, tree);
    });
  },

  /**
   * Read the skill tree for a neuma. Returns default structure if not found.
   * @param {string} neumaId - Neuma identifier
   * @returns {Promise<{skills: Array<Object>, version: string}>} Skill tree data
   */
  async readSkillTree(neumaId) {
    try {
      return await this._readJSON(path.join(this._path(neumaId), 'skills', 'tree.json'));
    } catch {
      return { skills: [], version: '1.0.0' };
    }
  },

  /**
   * Record a use of a skill against this neuma's tree (#22 S2).
   *
   * HONEST: usage = acquisition. First use creates the record; every
   * subsequent use bumps usageCount + lastUsedAt while keeping
   * firstAcquiredAt fixed. No XP, no levels — the act is the proof.
   *
   * The whole read-modify-write runs under the file lock so two concurrent
   * calls on the same neuma serialize cleanly. The lock shares its queue
   * with writeSkillTree (ai6 S2 R1.2). readSkillTree itself does NOT acquire
   * the lock (reads are lock-free), so the call inside the lock body does
   * not re-enter.
   *
   * Defensive warnings returned by applyAcquisition (e.g. a legacy v1
   * tree with unexpected non-empty `skills` data) are surfaced via
   * `opts.onWarn`. PRODUCTION callers in backend/ should inject their
   * structured logger; the default falls back to console.warn (core/
   * stays substrate-agnostic and must not import a platform logger —
   * same pattern as core/continuity/adapters/fsdir.js's onTornLine).
   * Warnings are NEVER silently swallowed.
   *
   * impure (filesystem, crypto via _writeJSON, onWarn side effect)
   *
   * @param {string} neumaId
   * @param {string} skillName - kebab-case, validated by applyAcquisition
   * @param {string} [nowIso] - ISO timestamp; defaults to current wall-clock.
   * @param {{onWarn?: (detail: string, meta: object) => void}} [opts]
   * @returns {Promise<{skill, firstAcquiredAt, lastUsedAt, usageCount}>}
   *   the recorded acquisition AFTER this use
   */
  // eslint-disable-next-line no-console -- documented core/ pattern (see JSDoc)
  async recordSkillUse(neumaId, skillName, nowIso = new Date().toISOString(), opts = {}) {
    if (!neumaId) throw new Error('recordSkillUse: neumaId required');
    const onWarn = opts.onWarn || ((detail, meta) =>
      // eslint-disable-next-line no-console
      console.warn(`[acquisition] ${detail}`, meta));
    const treePath = path.join(this._path(neumaId), 'skills', 'tree.json');
    return locks.withFileLock(treePath, async () => {
      const current = await this.readSkillTree(neumaId);
      const { tree, acquisition, warnings } = applyAcquisition(current, skillName, nowIso);
      await this._writeJSON(treePath, tree);
      for (const w of warnings) onWarn(w.detail, { neumaId, kind: w.kind, ...w });
      return acquisition;
    });
  },
});
