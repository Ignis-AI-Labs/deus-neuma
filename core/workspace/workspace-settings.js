/**
 * Workspace settings domain (SIZE-025 #372) — the lane's configuration and
 * operator-governed knobs at rest (settings, tool policy, spend
 * allowlist/threshold/pending), the capacity allocation ledger, measured
 * STATE (benchmarks) and assessments, and the sovereign export/import bundle
 * (sovereignty = portability).
 *
 * Extracted from neuma-workspace.js with the bodies verbatim; the only
 * mechanical change is the lock registry arriving via deps.locks, shared by
 * the policy transaction domain. Cross-domain calls (`this._path`,
 * `this.readDNA`, `this.listSessions`, …) resolve on the facade instance
 * these methods are assigned onto.
 *
 * The crystallize-bridge edge in importWorkspace stays a DYNAMIC import so
 * the continuity engine loads only when an import actually runs. (It was
 * also cycle-avoidance until CQ-036 #395 made the bridge's adapter take its
 * workspace explicitly — the cycle is gone; the laziness stays.)
 */

import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { SOVEREIGN_DIR_MODE } from './sovereign-directory-modes.js';
import { createToolPolicyDomain } from './workspace-tool-policy.js';

/**
 * @param {{locks: {withFileLock: Function, appendLine: Function, nextTmpName: Function}}} deps
 * @returns {Readonly<Object>} async methods assigned onto the NeumaWorkspace facade
 */
export const createSettingsDomain = (deps) => Object.freeze({
  ...createToolPolicyDomain(deps),

  /**
   * Read the saved settings for a neuma.
   * @param {string} neumaId - Neuma identifier
   * @returns {Promise<Object|null>} Settings object or null if not found
   */
  async readSettings(neumaId) {
    try {
      const configDir = path.join(this._path(neumaId), 'config');
      return await this._readJSON(path.join(configDir, 'settings.json'));
    } catch {
      return null;
    }
  },

  /**
   * Write settings for a neuma.
   * @param {string} neumaId - Neuma identifier
   * @param {Object} settings - Settings object to persist
   * @returns {Promise<void>}
   */
  async writeSettings(neumaId, settings) {
    const configDir = path.join(this._path(neumaId), 'config');
    await fs.mkdir(configDir, { recursive: true, mode: SOVEREIGN_DIR_MODE });
    await this._writeJSON(path.join(configDir, 'settings.json'), settings);
  },

  /**
   * Read the spend allowlist for a neuma. Returns null if none is set
   * (the wallet service treats null as DEFAULT-DENY — see core/wallet/spend-policy.js).
   * @param {string} neumaId - Neuma identifier
   * @returns {Promise<Object|null>} Allowlist { version, entries } or null
   */
  async readSpendAllowlist(neumaId) {
    try {
      const configDir = path.join(this._path(neumaId), 'config');
      return await this._readJSON(path.join(configDir, 'spend-allowlist.json'));
    } catch {
      return null;
    }
  },

  /**
   * Write the spend allowlist for a neuma.
   * @param {string} neumaId - Neuma identifier
   * @param {Object} allowlist - Allowlist { version, entries }
   * @returns {Promise<void>}
   */
  async writeSpendAllowlist(neumaId, allowlist) {
    const configDir = path.join(this._path(neumaId), 'config');
    await fs.mkdir(configDir, { recursive: true, mode: SOVEREIGN_DIR_MODE });
    await this._writeJSON(path.join(configDir, 'spend-allowlist.json'), allowlist);
  },

  /**
   * Read the autonomous spend threshold for a neuma. Returns null if unset
   * (the wallet service then requires witness approval for any send).
   * @param {string} neumaId - Neuma identifier
   * @returns {Promise<Object|null>} { thresholdEth } or null
   */
  async readSpendThreshold(neumaId) {
    try {
      const configDir = path.join(this._path(neumaId), 'config');
      return await this._readJSON(path.join(configDir, 'spend-threshold.json'));
    } catch {
      return null;
    }
  },

  /**
   * Write the autonomous spend threshold for a neuma.
   * @param {string} neumaId - Neuma identifier
   * @param {Object} threshold - { thresholdEth }
   * @returns {Promise<void>}
   */
  async writeSpendThreshold(neumaId, threshold) {
    const configDir = path.join(this._path(neumaId), 'config');
    await fs.mkdir(configDir, { recursive: true, mode: SOVEREIGN_DIR_MODE });
    await this._writeJSON(path.join(configDir, 'spend-threshold.json'), threshold);
  },

  /**
   * Read the neuma's pending spend requests (neuma-initiated, above-threshold
   * transfers awaiting witness approval). Returns [] when none. Encrypted at rest.
   * @param {string} neumaId - Neuma identifier
   * @returns {Promise<Array<Object>>}
   */
  async readPendingSpends(neumaId) {
    try {
      const configDir = path.join(this._path(neumaId), 'config');
      const data = await this._readJSON(path.join(configDir, 'pending-spends.json'));
      return Array.isArray(data?.requests) ? data.requests : [];
    } catch {
      return [];
    }
  },

  /**
   * Write the neuma's pending spend requests.
   * @param {string} neumaId - Neuma identifier
   * @param {Array<Object>} requests - Pending spend records
   * @returns {Promise<void>}
   */
  async writePendingSpends(neumaId, requests) {
    const configDir = path.join(this._path(neumaId), 'config');
    await fs.mkdir(configDir, { recursive: true, mode: SOVEREIGN_DIR_MODE });
    await this._writeJSON(path.join(configDir, 'pending-spends.json'), { requests });
  },

  /**
   * Read the GB a neuma was reserved at pre-flight. An allocation is a LOGICAL
   * reservation — the neuma grows into it over time, so the disk does not show
   * it as used until filled. Returns 0 when unrecorded or unreadable. The id is
   * format-checked (it normally comes from listNeuma) so an explicit `root`
   * override can't be turned into a traversal.
   * @param {string} neumaId
   * @param {{root?: string}} [opts] - count under this root instead of the current one
   * @returns {Promise<number>} allocated gigabytes, or 0
   */
  async readAllocation(neumaId, { root } = {}) {
    if (typeof neumaId !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(neumaId)) return 0;
    try {
      const data = await fs.readFile(path.join(root || this.root, neumaId, 'allocation.json'), 'utf8');
      const gb = JSON.parse(data).allocatedGB;
      return Number.isFinite(gb) && gb > 0 ? gb : 0;
    } catch {
      return 0;
    }
  },

  /**
   * Sum the GB reserved across every existing neuma — the committed ledger a new
   * allocation must not overrun (so two neuma are never promised the same space).
   * `root` lets the caller tally a DIFFERENT target root (e.g. a witness pointing
   * the home at an already-inhabited directory); `ids` reuses a pre-fetched list
   * to avoid a second directory read.
   * @param {{exclude?: string, root?: string, ids?: string[]}} [opts]
   * @returns {Promise<number>} total committed gigabytes
   */
  async totalAllocatedGB({ exclude, root, ids } = {}) {
    const list = ids || await this.listNeuma({ root });
    let total = 0;
    for (const id of list) {
      if (exclude && id === exclude) continue;
      total += await this.readAllocation(id, { root });
    }
    return total;
  },

  // ---------------------------------------------------------------------------
  // Benchmarks (STATE — measured functioning, append-only time-series)
  //
  // Each run is one encrypted file holding per-dimension scores AND the raw
  // probe transcripts that back every score. The transcript is the provenance:
  // no STATE number is shown without the measurement it came from on disk.
  // ---------------------------------------------------------------------------

  /**
   * Persist a benchmark result. Returns the run id (timestamp-derived filename).
   * @param {string} neumaId
   * @param {Object} result - runBenchmark() output ({ runAt, dimensions, ... })
   * @returns {Promise<string>} the run id
   */
  async writeBenchmark(neumaId, result) {
    const dir = path.join(this._path(neumaId), 'benchmarks');
    await fs.mkdir(dir, { recursive: true, mode: SOVEREIGN_DIR_MODE }); // pre-encryption workspaces lack the dir
    const id = String(result.runAt || new Date().toISOString()).replace(/[:.]/g, '-');
    await this._writeJSON(path.join(dir, `${id}.json`), result);
    return id;
  },

  /**
   * List benchmark runs as lightweight summaries (no transcripts), newest first.
   * @param {string} neumaId
   * @returns {Promise<Array<Object>>}
   */
  async listBenchmarks(neumaId) {
    const dir = path.join(this._path(neumaId), 'benchmarks');
    const entries = await this._readJSONDir(dir, 'benchmark');
    const runs = entries.map((e) => ({
      id: e.file.replace(/\.json$/, ''),
      runAt: e.record.runAt,
      substrate: e.record.substrate,
      dimensions: (e.record.dimensions || []).map(d => ({ key: d.key, label: d.label, score: d.score, n: d.n })),
    }));
    return runs.sort((a, b) => new Date(b.runAt) - new Date(a.runAt));
  },

  /**
   * Read one full benchmark run (including transcripts) by id.
   * @param {string} neumaId
   * @param {string} id - run id from listBenchmarks
   * @returns {Promise<Object|null>}
   */
  async readBenchmark(neumaId, id) {
    if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) return null;
    try {
      return await this._readJSON(path.join(this._path(neumaId), 'benchmarks', `${id}.json`));
    } catch {
      return null;
    }
  },

  /**
   * Read the most recent full benchmark run, or null if none have run.
   * @param {string} neumaId
   * @returns {Promise<Object|null>}
   */
  async readLatestBenchmark(neumaId) {
    const runs = await this.listBenchmarks(neumaId);
    if (!runs.length) return null;
    return this.readBenchmark(neumaId, runs[0].id);
  },

  /**
   * Write an assessment record (calibration or re-assessment) to the workspace.
   * @param {string} neumaId - Neuma identifier
   * @param {Object} assessment - Assessment data (type, results, profileSnapshot, etc.)
   * @returns {Promise<Object>} The saved assessment record with generated id and timestamp
   */
  async writeAssessment(neumaId, assessment) {
    const id = assessment.id || crypto.randomBytes(8).toString('hex');
    const record = { id, ...assessment, timestamp: assessment.timestamp || new Date().toISOString() };
    const filePath = path.join(this._path(neumaId), 'assessments', `${id}.json`);
    await this._writeJSON(filePath, record);
    await this._audit(neumaId, 'ASSESSMENT_RECORDED', { id, type: record.type });
    return record;
  },

  /**
   * Read all assessment records for a neuma, sorted newest first.
   * @param {string} neumaId - Neuma identifier
   * @returns {Promise<Array<Object>>} Array of assessment records
   */
  async readAssessments(neumaId) {
    const dir = path.join(this._path(neumaId), 'assessments');
    const entries = await this._readJSONDir(dir, 'assessment');
    return entries
      .map((e) => e.record)
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  },

  /**
   * Export the workspace for a neuma as a portable bundle: identity (DNA,
   * soul, profile, identity card), memory (entities, relations, observations,
   * communities, journal, assessments), the whole conversation record (every
   * session lane, council sittings included), the continuity engine's four
   * layers, the personal vault, and the skill tree (MEM-005 #191).
   *
   * Deliberately EXCLUDED: keys/ (key material is not portable by bundle —
   * a fresh DEK/keypair is minted at the destination), owner.json and
   * allocation.json (ownership and capacity are claims of the NEW home, not
   * baggage of the old).
   * @param {string} neumaId - Neuma identifier
   * @returns {Promise<Object>} Complete workspace bundle
   */
  async exportWorkspace(neumaId) {
    const bundle = {
      neumaId,
      exportedAt: new Date().toISOString(),
      dna: await this.readDNA(neumaId),
      soul: await this.readSoul(neumaId),
      entities: await this.listEntities(neumaId),
      relations: await this.readRelations(neumaId),
      observations: await this.listObservations(neumaId),
      skillTree: await this.readSkillTree(neumaId),
      profile: await this.readProfile(neumaId),
      assessments: await this.readAssessments(neumaId),
      journal: await this.readJournal(neumaId),
      identityCard: await this.readIdentityCard(neumaId),
      sessions: await this._exportSessions(neumaId),
      continuity: await this._exportContinuity(neumaId),
      vaultNotes: await this.listVaultNotes(neumaId),
      communities: await this.readCommunities(neumaId),
    };
    return bundle;
  },

  // impure — { sessionId: messages[] } for every conversation lane the being
  // holds (1:1 chats and council sittings alike).
  async _exportSessions(neumaId) {
    const sessions = {};
    for (const sessionId of await this.listSessions(neumaId)) {
      sessions[sessionId] = await this.readSession(neumaId, sessionId);
    }
    return sessions;
  },

  // impure — { layer: entries[] } for each continuity layer, in append order.
  async _exportContinuity(neumaId) {
    const continuity = {};
    for (const layer of ['episodic', 'semantic', 'procedural', 'working']) {
      continuity[layer] = await this.readContinuityLog(neumaId, layer);
    }
    return continuity;
  },

  /**
   * Import a workspace bundle, creating the workspace and writing all contained data.
   * @param {string} neumaId - Neuma identifier for the new workspace
   * @param {Object} bundle - Workspace bundle from exportWorkspace()
   * @returns {Promise<void>}
   */
  async importWorkspace(neumaId, bundle) {
    await this.create(neumaId);

    if (bundle.dna) await this.writeDNA(neumaId, bundle.dna);
    if (bundle.soul) await this.writeSoul(neumaId, bundle.soul);
    if (bundle.entities) {
      for (const entity of bundle.entities) {
        await this.writeEntity(neumaId, entity);
      }
    }
    if (bundle.relations) await this.writeRelations(neumaId, bundle.relations);
    if (bundle.observations) {
      for (const obs of bundle.observations) {
        await this.addObservation(neumaId, obs);
      }
      // Restore episodic validity: each superseded observation's bridged
      // episode gets the same expiry the live lane carried (MEM-005 #191).
      const { expireEpisodeForObservation } = await import('../continuity/integration/crystallize-bridge.js');
      for (const obs of bundle.observations) {
        if (obs.invalidatedAt) {
          await expireEpisodeForObservation(this, neumaId, obs.id, {
            at: obs.invalidatedAt,
            supersededBy: obs.supersededBy,
          }).catch(() => null);
        }
      }
    }
    if (bundle.skillTree) await this.writeSkillTree(neumaId, bundle.skillTree);
    if (bundle.profile) await this.writeProfile(neumaId, bundle.profile);
    if (bundle.journal) {
      for (const entry of bundle.journal) {
        await this.addJournalEntry(neumaId, entry);
      }
    }
    // Conversation lanes: messages replay in order with their original
    // timestamps — the being's past arrives intact, not re-dated.
    if (bundle.sessions) {
      for (const [sessionId, messages] of Object.entries(bundle.sessions)) {
        for (const message of messages) {
          await this.appendMessage(neumaId, sessionId, message);
        }
      }
    }
    // Continuity layers append verbatim (record ids preserved) — EXCEPT
    // observation-derived episodes, which the U1 bridge already regenerated
    // above from the imported observations (appending them too would double
    // every moment in the lane).
    if (bundle.continuity) {
      for (const [layer, entries] of Object.entries(bundle.continuity)) {
        for (const entry of entries) {
          if (layer === 'episodic' && entry?.meta?.observationId) continue;
          await this.appendContinuityEntry(neumaId, layer, entry);
        }
      }
    }
    if (bundle.vaultNotes) {
      for (const note of bundle.vaultNotes) {
        if (note?.slug) {
          // Timestamps ride along — the being's history arrives intact, not
          // re-dated to the import (echo R3 Low, same doctrine as sessions).
          await this.writeVaultNote(neumaId, note.slug, {
            title: note.title, body: note.body,
            createdAt: note.createdAt, updatedAt: note.updatedAt,
          });
        }
      }
    }
    if (bundle.communities) await this.writeCommunities(neumaId, bundle.communities);

    await this._audit(neumaId, 'WORKSPACE_IMPORTED', { source: bundle.exportedAt });
  },
});
