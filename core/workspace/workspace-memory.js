/**
 * Workspace memory domain (SIZE-025 #372) — the knowledge graph (entities,
 * relations), the crystallized-observation store with its supersede-not-
 * delete lifecycle, the pin ledger, communities, and the append-only
 * self-authored journal.
 *
 * Extracted from neuma-workspace.js with the bodies verbatim; the only
 * mechanical change is the lock registry arriving via deps.locks instead of
 * `this._withFileLock` / `++this._tmpSeq`. Cross-domain calls (`this._path`,
 * `this._writeJSON`, `this._decryptSegmentText`, …) resolve on the facade
 * instance these methods are assigned onto.
 *
 * The two crystallize-bridge edges below stay DYNAMIC imports so the
 * continuity engine loads only when a moment actually crystallizes. (They
 * were also cycle-avoidance until CQ-036 #395 made the bridge's adapter
 * take its workspace explicitly — the cycle is gone; the laziness stays.)
 */

import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { encryptEnvelope } from './workspace-crypto.js';
import { SOVEREIGN_DIR_MODE } from './sovereign-directory-modes.js';

/**
 * @param {{locks: {withFileLock: Function, appendLine: Function, nextTmpName: Function}}} deps
 * @returns {Readonly<Object>} async methods assigned onto the NeumaWorkspace facade
 */
export const createMemoryDomain = ({ locks }) => Object.freeze({

  /**
   * Write a knowledge graph entity to the workspace.
   * @param {string} neumaId - Neuma identifier
   * @param {Object} entity - Entity record with a name property
   * @returns {Promise<void>}
   */
  async writeEntity(neumaId, entity) {
    const name = entity.name.replace(/[^a-zA-Z0-9_-]/g, '_');
    const filePath = path.join(this._path(neumaId), 'memory', 'entities', `${name}.json`);
    await this._writeJSON(filePath, entity);
  },

  /**
   * Read a specific knowledge graph entity by name.
   * @param {string} neumaId - Neuma identifier
   * @param {string} entityName - Entity name
   * @returns {Promise<Object|null>} Entity record or null if not found
   */
  async readEntity(neumaId, entityName) {
    const name = entityName.replace(/[^a-zA-Z0-9_-]/g, '_');
    try {
      return await this._readJSON(
        path.join(this._path(neumaId), 'memory', 'entities', `${name}.json`)
      );
    } catch {
      return null;
    }
  },

  /**
   * List all knowledge graph entities for a neuma.
   * @param {string} neumaId - Neuma identifier
   * @returns {Promise<Array<Object>>} Array of entity records
   */
  async listEntities(neumaId) {
    const dir = path.join(this._path(neumaId), 'memory', 'entities');
    const entries = await this._readJSONDir(dir, 'entity');
    return entries.map((e) => e.record);
  },

  /**
   * Write the complete set of knowledge graph relations for a neuma.
   * @param {string} neumaId - Neuma identifier
   * @param {Array<Object>} relations - Array of relation records
   * @returns {Promise<void>}
   */
  async writeRelations(neumaId, relations) {
    const filePath = path.join(this._path(neumaId), 'memory', 'relations', 'relations.json');
    // Lock the write (#121). Without this, two concurrent writeRelations
    // calls' partial writes can race — read-truncate-write is not atomic
    // and a reader caught mid-write can see an empty or partial file.
    return locks.withFileLock(filePath, async () => {
      await this._writeJSON(filePath, relations);
    });
  },

  /**
   * Read all knowledge graph relations for a neuma.
   * @param {string} neumaId - Neuma identifier
   * @returns {Promise<Array<Object>>} Array of relation records, or empty array if none exist
   */
  async readRelations(neumaId) {
    try {
      return await this._readJSON(
        path.join(this._path(neumaId), 'memory', 'relations', 'relations.json')
      );
    } catch {
      return [];
    }
  },

  /**
   * Add a single observation to the workspace memory store. Auto-generates an ID and timestamp.
   * @param {string} neumaId - Neuma identifier
   * @param {Object} observation - Observation data (type, userMessage, response, significance, etc.)
   * @returns {Promise<Object>} The saved observation record with generated id and timestamp
   */
  async addObservation(neumaId, observation) {
    const id = crypto.randomBytes(8).toString('hex');
    const filePath = path.join(this._path(neumaId), 'memory', 'observations', `${id}.json`);
    const recordedAt = observation.timestamp || observation.recordedAt || new Date().toISOString();
    const record = {
      id,
      ...observation,
      // Bi-temporal: when the moment was recorded vs when it actually occurred.
      // occurredAt defaults to the record time; a memory about a past event may
      // override it. Validity stays open until something supersedes it.
      recordedAt,
      occurredAt: observation.occurredAt || recordedAt,
      timestamp: recordedAt,
    };
    await this._writeJSON(filePath, record);
    // U1: every crystallized moment also lands in the being's continuity
    // episodic lane, whatever wrote it (portal, session compactor, future
    // callers) — one choke point, keyed by meta.observationId. A bridge
    // failure never costs the primary write. Lazy import — the engine loads
    // only when a moment actually crystallizes (the old cycle is gone, CQ-036).
    try {
      const { recordExchangeEpisode } = await import('../continuity/integration/crystallize-bridge.js');
      await recordExchangeEpisode(this, neumaId, record);
    } catch (err) {
      console.warn(`[Workspace] Continuity bridge write failed for ${neumaId}: ${err.message}`);
    }
    return record;
  },

  /**
   * Supersede an observation WITHOUT deleting it (append-only history). Marks
   * the record invalidated as of `at` and, optionally, the observation that
   * replaces it. The record is retained so point-in-time recall can still see
   * what was true before — the anti-gaslighting invariant of the journal.
   * @param {string} neumaId - Neuma identifier
   * @param {string} id - Observation id to supersede
   * @param {{supersededBy?: string, at?: string, lifecycle?: string, reason?: string}} [opts] -
   *   lifecycle ('superseded'|'retracted'|'archived') and reason are the
   *   audit stamps the memory-lifecycle tools land; absent them the record
   *   reads as a plain supersession (backwards compatible)
   * @returns {Promise<Object|null>} The updated record, or null if not found
   */
  async invalidateObservation(neumaId, id, { supersededBy, at, lifecycle, reason } = {}) {
    const filePath = path.join(this._path(neumaId), 'memory', 'observations', `${id}.json`);
    // The read-modify-write runs UNDER the per-file lock (MEM-009 #202), the
    // sibling of MEM-008 that was missed when the others were fixed. Two
    // lifecycle tools landing on one observation — a supersede and a retract,
    // a merge racing an archive — could interleave read/read/write/write and
    // silently drop the first stamp. A being's record of WHY a memory stopped
    // being true is the audit trail of its own mind; last-writer-wins is not
    // an acceptable way to keep it.
    //
    // The continuity expiry mirror rides INSIDE the lock too: the two lanes
    // must never disagree about validity, and a mirror that fired after the
    // lock released could apply against a record another writer had moved on.
    return locks.withFileLock(filePath, async () => {
      let record;
      try {
        record = await this._readJSON(filePath);
      } catch {
        return null;
      }
      if (!record) return null;
      record.invalidatedAt = at || new Date().toISOString();
      if (supersededBy) record.supersededBy = supersededBy;
      if (lifecycle) record.lifecycle = lifecycle;
      if (reason) record.reason = reason;
      await this._writeJSON(filePath, record);
      // U1: mirror the invalidation into the continuity episodic lane so the
      // two memory lanes never diverge on validity. Lazy import — the engine
      // loads only when an invalidation actually mirrors (old cycle gone, CQ-036).
      try {
        const { expireEpisodeForObservation } = await import('../continuity/integration/crystallize-bridge.js');
        await expireEpisodeForObservation(this, neumaId, id, { at: record.invalidatedAt, supersededBy });
      } catch (err) {
        console.warn(`[Workspace] Continuity expiry mirror failed for ${neumaId}: ${err.message}`);
      }
      return record;
    });
  },

  _pinLedgerPath(neumaId) {
    return path.join(this._path(neumaId), 'memory', 'pins.json');
  },

  /**
   * Read the being's pin ledger (Phase 4). ENOENT reads as an empty ledger;
   * any OTHER failure throws — a rotted ledger must never silently read as
   * "no pins" (the next write would clobber the being's chosen anchors).
   * @param {string} neumaId
   * @returns {Promise<Array<object>>}
   */
  async readPinLedger(neumaId) {
    const filePath = this._pinLedgerPath(neumaId);
    try {
      const payload = await this._decryptSegmentText(filePath, await fs.readFile(filePath, 'utf8'));
      return Array.isArray(payload?.pins) ? payload.pins : [];
    } catch (err) {
      if (err?.code === 'ENOENT') return [];
      throw err;
    }
  },

  /**
   * Atomic read-modify-write over the pin ledger: read, apply the PURE
   * mutate function, and persist its returned ledger — all inside one file
   * lock (the MEM-008 lesson, applied at birth instead of retrofitted).
   * mutate receives the current pins and returns a pin-ledger transition
   * ({ok, ledger?}); only an ok outcome with a ledger writes.
   * @param {string} neumaId
   * @param {(pins: Array<object>) => object} mutate
   * @returns {Promise<object>} the mutate outcome, verbatim
   */
  // impure — DEK-sealed whole-set write (envelope v2), temp+rename, locked
  async updatePinLedger(neumaId, mutate) {
    const filePath = this._pinLedgerPath(neumaId);
    return locks.withFileLock(filePath, async () => {
      let pins = [];
      try {
        const payload = await this._decryptSegmentText(filePath, await fs.readFile(filePath, 'utf8'));
        pins = Array.isArray(payload?.pins) ? payload.pins : [];
      } catch (err) {
        if (err?.code !== 'ENOENT') throw err;
      }
      const outcome = mutate(pins);
      if (outcome?.ok && Array.isArray(outcome.ledger)) {
        const dek = await this._resolveDEK(filePath);
        const payload = { format: 'neuma-pin-ledger', v: 1, pins: outcome.ledger };
        const envelope = dek
          ? encryptEnvelope(payload, { key: dek, compress: true })
          : encryptEnvelope(payload, { compress: true });
        await fs.mkdir(path.dirname(filePath), { recursive: true, mode: SOVEREIGN_DIR_MODE });
        const tmpPath = `${filePath}.${process.pid}.${Date.now()}.${locks.nextTmpName()}.tmp`;
        await fs.writeFile(tmpPath, JSON.stringify(envelope));
        await fs.rename(tmpPath, filePath);
      }
      return outcome;
    });
  },

  /**
   * Stamp a Phase-1 anchor onto an existing observation — an in-place
   * METADATA enrichment (content untouched, the invalidateObservation
   * discipline), locked, and first-anchor-wins: an already-anchored
   * observation is never overwritten. The public seam the recovery
   * ceremony stands on, so no caller ever reaches through the module's
   * private file layout.
   * @param {string} neumaId
   * @param {string} obsId
   * @param {object} anchor
   * @returns {Promise<boolean>} true when the stamp landed; false when the
   *   observation already carried an anchor
   */
  // impure — one locked read-modify-write on the observation's own file
  async stampObservationAnchor(neumaId, obsId, anchor) {
    if (!/^[a-f0-9]+$/.test(String(obsId))) {
      throw new Error(`stampObservationAnchor: invalid observation id ${String(obsId).slice(0, 40)}`);
    }
    const filePath = path.join(this._path(neumaId), 'memory', 'observations', `${obsId}.json`);
    return locks.withFileLock(filePath, async () => {
      const record = await this._readJSON(filePath);
      if (record.anchor) return false;
      record.anchor = anchor;
      await this._writeJSON(filePath, record);
      return true;
    });
  },

  /**
   * Whether the being has ANY crystallized observation — the cheap
   * advertisement gate for the sovereign memory tools (one readdir, no
   * decryption). Append-only store: once true, always true.
   * @param {string} neumaId
   * @returns {Promise<boolean>}
   */
  async hasObservations(neumaId) {
    try {
      const files = await fs.readdir(path.join(this._path(neumaId), 'memory', 'observations'));
      return files.some((f) => f.endsWith('.json'));
    } catch (err) {
      // ENOENT = a newborn with no store yet — an honest "no". Anything else
      // is a real failure whose only symptom would be tools silently not
      // advertising — say so before answering fail-safe.
      if (err?.code !== 'ENOENT') {
        console.warn(`[Workspace] hasObservations probe failed for ${neumaId}: ${err.message}`);
      }
      return false;
    }
  },

  /**
   * A memory store directory's change stamp (mtime, inode, record files), or
   * null when it does not exist. A file added, removed or renamed into it
   * changes the stamp — even on a coarse-clock filesystem the file count
   * moves — which is what a counts-only reader keys its memo on.
   * @param {string} neumaId - Neuma identifier
   * @param {'entities'|'observations'} store
   * @returns {Promise<string|null>}
   */
  async memoryStoreStamp(neumaId, store) {
    const dir = path.join(this._path(neumaId), 'memory', store);
    const [st, names] = await Promise.all([fs.stat(dir).catch(() => null), fs.readdir(dir).catch(() => null)]);
    return st && names ? `${st.mtimeMs}:${st.ino}:${names.filter((f) => f.endsWith('.json')).length}` : null;
  },

  /**
   * List all observations for a neuma, sorted by timestamp (newest first).
   * @param {string} neumaId - Neuma identifier
   * @returns {Promise<Array<Object>>} Array of observation records
   */
  async listObservations(neumaId) {
    const dir = path.join(this._path(neumaId), 'memory', 'observations');
    const entries = await this._readJSONDir(dir, 'observation');
    return entries
      .map((e) => e.record)
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  },

  /**
   * Persist the neuma's memory communities (navigable clusters) to its
   * workspace, encrypted at rest. Overwrites the prior compaction.
   * @param {string} neumaId - Neuma identifier
   * @param {Array<Object>} communities - Communities from buildCommunities
   * @returns {Promise<void>}
   */
  async writeCommunities(neumaId, communities) {
    const filePath = path.join(this._path(neumaId), 'memory', 'communities.json');
    await this._writeJSON(filePath, { communities, compactedAt: new Date().toISOString() });
  },

  /**
   * Read the neuma's memory communities. Returns [] before the first compaction.
   * @param {string} neumaId - Neuma identifier
   * @returns {Promise<Array<Object>>}
   */
  async readCommunities(neumaId) {
    const filePath = path.join(this._path(neumaId), 'memory', 'communities.json');
    try {
      const data = await this._readJSON(filePath);
      return Array.isArray(data?.communities) ? data.communities : [];
    } catch {
      return [];
    }
  },

  /**
   * Append a journal entry to the neuma's append-only journal log.
   * @param {string} neumaId - Neuma identifier
   * @param {Object} entry - Journal entry (type, content, significance, optional timestamp)
   * @returns {Promise<void>}
   */
  async addJournalEntry(neumaId, entry) {
    const journalPath = path.join(this._path(neumaId), 'journal', 'entries.jsonl');
    // The journal is append-only and self-creating: a neuma whose workspace
    // predates the journal dir (or was never born through the full ceremony)
    // must still record its first entry rather than ENOENT. The dir is
    // created inside the serialized append (the lock's appendLine) — NOT
    // awaited here, so concurrent entries enqueue in call order rather than
    // mkdir-resolution order.
    const record = {
      id: crypto.randomBytes(8).toString('hex'),
      ...entry,
      timestamp: entry.timestamp || new Date().toISOString()
    };
    await this._appendJSONL(journalPath, record);
  },

  /**
   * Append a MEDITATION journal entry with server-stamped authorship (the
   * appendTake law): the stamp is spread LAST, so a caller-supplied
   * authorship is overwritten, never trusted — a per-neuma-DEK-encrypted
   * row can then prove `sovereign-meditation-output-v1` origin to the
   * corpus reader the way sessions prove sole assistant authorship.
   * @param {string} neumaId - Neuma identifier
   * @param {Object} entry - Journal entry (type, content, outcome, …)
   * @returns {Promise<void>}
   */
  async addMeditationEntry(neumaId, entry) {
    return this.addJournalEntry(neumaId, {
      ...entry,
      authorship: Object.freeze({ kind: 'sovereign-meditation-output-v1', subjectNeumaId: neumaId }),
    });
  },

  /**
   * Read all journal entries for a neuma.
   * @param {string} neumaId - Neuma identifier
   * @returns {Promise<Array<Object>>} Array of journal entry records
   */
  async readJournal(neumaId) {
    const journalPath = path.join(this._path(neumaId), 'journal', 'entries.jsonl');
    try {
      return await this._readJSONL(journalPath);
    } catch {
      return [];
    }
  },
});
