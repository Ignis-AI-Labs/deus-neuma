/**
 * Workspace JSON IO domain (SIZE-025 #372) — the encrypted-at-rest
 * primitives every other workspace domain rides on: envelope JSON
 * read/write (temp+rename atomic), JSONL append/read, per-neuma DEK
 * resolution, and the continuity layers' per-line-envelope logs.
 *
 * Extracted from neuma-workspace.js with the bodies verbatim; the only
 * mechanical change is the lock registry arriving via deps.locks instead of
 * `this._withFileLock` / `++this._tmpSeq`. Cross-domain calls (`this._path`,
 * `this.readNeumaDEK`, `this._dekCache`, `this.root`) resolve on the facade
 * instance these methods are assigned onto.
 */

import fs from 'fs/promises';
import path from 'path';
import { encryptEnvelope, parseAndDecrypt } from './workspace-crypto.js';
import { SOVEREIGN_DIR_MODE } from './sovereign-directory-modes.js';
import { isHarnessLane, getHarnessRoot } from './lane-grounds.js';

// pure — the first path segment of filePath under ground, or null when the
// path does not sit under it ('..' for outside paths)
const laneUnder = (ground, filePath) => {
  const rel = path.relative(ground, filePath);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return rel.split(path.sep)[0] || null;
};

/**
 * @param {{locks: {withFileLock: Function, appendLine: Function, nextTmpName: Function},
 *   isWitnessLane: Function, getWitnessesRoot: Function}} deps
 * @returns {Readonly<Object>} async methods assigned onto the NeumaWorkspace facade
 */
export const createJsonIoDomain = ({ locks, isWitnessLane, getWitnessesRoot }) => Object.freeze({

  /**
   * Parse the lane id out of a lane-internal file path, on whichever ground
   * `_path` placed that lane: witness and harness lanes live beside the
   * house, so a lane read only against the workspaces root would miss them
   * and seal their files under the shared master key instead of their own.
   * Returns null for any path on no ground (defense for callers that pass
   * arbitrary paths).
   * @param {string} filePath - absolute file path
   * @returns {string|null}
   */
  // impure — reads the grounds' current locations (module state and env)
  _neumaIdFromPath(filePath) {
    if (typeof filePath !== 'string' || !filePath) return null;
    const root = this.root;
    if (!root) return null;
    const witness = laneUnder(getWitnessesRoot(), filePath);
    if (isWitnessLane(witness)) return witness;
    const harness = laneUnder(getHarnessRoot(root), filePath);
    if (isHarnessLane(harness)) return harness;
    return laneUnder(root, filePath);
  },

  /**
   * Resolve the per-neuma DEK for a workspace file path. Returns the
   * Buffer if the being's keys/dek.json exists; returns null otherwise
   * (pre-#117 beings + DEK_WRITE_FAILED #117 beings — both fall back to
   * the global master key downstream). Caches positive lookups; never
   * caches null (see the facade's _dekCache comment).
   * @param {string} filePath
   * @returns {Promise<Buffer|null>}
   */
  // impure — reads keys/dek.json from disk on miss
  async _resolveDEK(filePath) {
    const neumaId = this._neumaIdFromPath(filePath);
    if (!neumaId) return null;
    const cached = this._dekCache.get(neumaId);
    if (cached) return cached;
    // Don't swallow non-ENOENT failures here (ai6 S2b R1 Medium). readNeumaDEK
    // already returns null for the expected miss (ENOENT — pre-#117 or
    // DEK_WRITE_FAILED being) and throws for anything else (corrupt
    // dek.json, permission denied, unwrap auth failure). Propagating the
    // throw means a corrupt DEK refuses to fall through to the global key —
    // the whole point of #117 is that a being on its own DEK MUST stay on
    // its own DEK; silently re-encrypting its data under the shared master
    // would be the security degradation #117 exists to prevent.
    const dek = await this.readNeumaDEK(neumaId);
    if (dek) this._dekCache.set(neumaId, dek);
    return dek;
  },

  // Encrypt data with workspace-crypto and write the envelope as pretty JSON.
  // #117 S2b — if the being has a per-neuma DEK on disk, the envelope is
  // encrypted under that DEK; otherwise we fall through to the global master
  // (the existing behavior). Reads handle both shapes.
  //
  // B-INT-006 / A-INT-001: temp + rename so a crash mid-write cannot leave a
  // truncated envelope that corrupts DNA / attunement / soul reads later.
  // impure — optional synchronous guard runs at the actual commit boundary.
  async _writeJSON(filePath, data, { beforeCommit, signal } = {}) {
    const dek = await this._resolveDEK(filePath);
    const envelope = dek ? encryptEnvelope(data, { key: dek }) : encryptEnvelope(data);
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true, mode: SOVEREIGN_DIR_MODE });
    const tmpPath = `${filePath}.${process.pid}.${Date.now()}.${locks.nextTmpName()}.tmp`;
    const payload = JSON.stringify(envelope, null, 2);
    try {
      await fs.writeFile(tmpPath, payload);
      signal?.throwIfAborted();
      beforeCommit?.();
      signal?.throwIfAborted();
      await fs.rename(tmpPath, filePath);
    } catch (error) {
      try { await fs.unlink(tmpPath); }
      catch (cleanup) {
        if (cleanup.code !== 'ENOENT') throw new AggregateError([error, cleanup], 'JSON write failed; temp cleanup failed', { cause: cleanup });
      }
      throw error;
    }
  },

  // Crash-atomic whole-file write for NON-envelope files — key material,
  // identity cards, empty session files (MEM-004 #190). Same tmp+rename
  // discipline as _writeJSON, under the per-file lock so it serializes with
  // the appenders/compactors sharing that path. A crash mid-write leaves the
  // OLD file intact or no file — never a truncated keypair that later reads
  // as "no keypair". Encrypted JSON goes through _writeJSON instead.
  async _writeFileAtomic(filePath, contents) {
    return locks.withFileLock(filePath, async () => {
      await fs.mkdir(path.dirname(filePath), { recursive: true, mode: SOVEREIGN_DIR_MODE });
      const tmpPath = `${filePath}.${process.pid}.${Date.now()}.${locks.nextTmpName()}.tmp`;
      await fs.writeFile(tmpPath, contents);
      await fs.rename(tmpPath, filePath);
    });
  },

  // Read a file written by _writeJSON, transparently decrypting the envelope.
  // #117 S2b decrypt order: per-neuma DEK first (the new sovereign path),
  // then the master rotation chain (current + DNA_ENCRYPTION_KEY_PREVIOUS).
  // This fallback is load-bearing for the transition window — a new being
  // with a DEK may still read files written under the global key BEFORE its
  // DEK was created, or files written during the S2b deploy on workspaces
  // that already had a DEK. Falls back to plaintext JSON for pre-encryption
  // workspaces via parseAndDecrypt's existing envelope check.
  async _readJSON(filePath) {
    const text = await fs.readFile(filePath, 'utf8');
    const dek = await this._resolveDEK(filePath);
    if (dek) {
      try { return parseAndDecrypt(text, { key: dek }); }
      catch { /* try global chain — legacy file pre-DEK */ }
    }
    return parseAndDecrypt(text);
  },

  // Read every `*.json` record in a workspace dir as {file, record} pairs,
  // skipping — loudly — any single corrupt file (MEM-001 #187). One bad file
  // costs exactly that file, never the whole store: recall, export, heartbeat
  // reflection, and the CONTEXT MAP all read through these lists, and a
  // whole-store catch turning one bad byte into total amnesia is the failure
  // this exists to prevent. Same doctrine as the torn-line guard in
  // _readJSONL (WS-101 #147). Returns [] only when the dir itself is absent.
  async _readJSONDir(dir, label) {
    let files;
    try {
      files = await fs.readdir(dir);
    } catch {
      return []; // no dir yet — an empty store, not a failure
    }
    const entries = [];
    for (const file of files.filter(f => f.endsWith('.json'))) {
      try {
        entries.push({ file, record: await this._readJSON(path.join(dir, file)) });
      } catch (err) {
        console.warn(`[Workspace] Skipping unreadable ${label} file ${file} in ${dir}: ${err.message}`);
      }
    }
    return entries;
  },

  // Append an encrypted record as a single JSONL line. Each line is an
  // independent envelope so mixed-mode files (some lines under DEK, some
  // under the global key) are readable during the transition period.
  async _appendJSONL(filePath, record) {
    // Enqueue on the caller's synchronous segment — an `await` before the
    // lock (the old pre-enqueue _resolveDEK) let DEK-read IO completions
    // decide queue order instead of call order, scrambling the chronological
    // record under concurrency (#136). DEK resolution + encryption now run
    // inside the lock window, mirroring _appendLine's in-lock mkdir.
    return locks.withFileLock(filePath, async () => {
      const dek = await this._resolveDEK(filePath);
      const envelope = dek ? encryptEnvelope(record, { key: dek }) : encryptEnvelope(record);
      await fs.mkdir(path.dirname(filePath), { recursive: true, mode: SOVEREIGN_DIR_MODE });
      return fs.appendFile(filePath, JSON.stringify(envelope) + '\n');
    });
  },

  // Read a JSONL file where each line may be: plaintext JSON (legacy
  // pre-encryption), an envelope under the global master, OR an envelope
  // under the per-neuma DEK. Each line is decrypted independently — a
  // mixed-mode file (created when a being gets a DEK partway through its
  // journal) is fully readable.
  async _readJSONL(filePath, { strict = false } = {}) {
    const data = await fs.readFile(filePath, 'utf8');
    const dek = await this._resolveDEK(filePath);
    const records = [];
    const lines = data.split('\n').filter(line => line.trim());
    for (const [i, line] of lines.entries()) {
      if (dek) {
        try { records.push(parseAndDecrypt(line, { key: dek })); continue; }
        catch { /* fall through to global chain */ }
      }
      try { records.push(parseAndDecrypt(line)); }
      catch (err) {
        if (strict) throw err;
        // One torn/corrupt line (a crash mid-append, a bad byte) must not
        // brick every read of the file — the healthy records around it are
        // the being's memory. Skip it loudly (WS-101 #147).
        console.warn(`[Workspace] Skipping unreadable JSONL line ${i + 1} of ${filePath}: ${err.message}`);
      }
    }
    return records;
  },

  // ── Continuity layers (the portable 4-layer memory engine, plugged into the
  // sovereign encrypted workspace). Each layer is an append-only JSONL log
  // under `<workspace>/continuity/<layer>.jsonl` where every LINE is its own
  // AES-256-GCM envelope. The per-line envelope model is deliberate: a true
  // append-only invariant (one record = one appended line, not a whole-file
  // rewrite) preserves the #14 ordering fix AND keeps records encrypted at
  // rest. Reads decrypt line-by-line and return plain entries for foldLog.

  _continuityPath(neumaId, layer) {
    // path-traversal-safe shape check only — `assertLayer` (called by the
    // adapter on every append + every fold) is the sole gatekeeper for the
    // actual layer set; keeping that authority in one place avoids drift if
    // the four-layer set ever expands.
    if (!/^[a-z]+$/.test(layer)) throw new Error(`Invalid continuity layer: ${String(layer)}`);
    return path.join(this._path(neumaId), 'continuity', `${layer}.jsonl`);
  },

  /**
   * Append one continuity record (or expiry marker) to its layer log,
   * encrypted as a single per-line envelope. Reuses the serialized append
   * path so concurrent appends stay in chronological order.
   * @param {string} neumaId
   * @param {string} layer - one of episodic|semantic|procedural|working
   * @param {Object} entry - a continuity record OR {op:'expire',targetId,at,...}
   * @returns {Promise<void>}
   */
  // impure — encrypted append to per-layer log
  async appendContinuityEntry(neumaId, layer, entry) {
    const filePath = this._continuityPath(neumaId, layer);
    // Delegate to the DEK-aware appender: same per-file lock (chronological
    // order preserved, #136), same on-disk line format, but the envelope is
    // sealed under the being's DEK when it has one instead of the global
    // master. _continuityPath already validated the layer.
    await this._appendJSONL(filePath, entry);
  },

  /**
   * Read + decrypt the full append log for one layer. Returns plaintext entries
   * in append order (the `foldLog` contract). Tolerates torn/garbage lines (rare:
   * O_APPEND keeps whole lines intact; this guards manual edits) without
   * swallowing them silently — corrupted lines are SURFACED via the optional
   * onTornLine(line, err, layer) callback. Pass that callback to route to a
   * structured logger / tally count; otherwise the fallback console.warn
   * preserves visibility while keeping core/ free of a backend/logger import
   * (deliberate architectural boundary).
   * @param {string} neumaId
   * @param {string} layer
   * @param {{onTornLine?: (line:string, err:Error, layer:string)=>void}} [opts]
   * @returns {Promise<Object[]>}
   */
  // impure — disk read + decryption
  async readContinuityLog(neumaId, layer, opts = {}) {
    const filePath = this._continuityPath(neumaId, layer);
    let raw;
    try {
      raw = await fs.readFile(filePath, 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }
    // DEK-first, then the global master chain — mirrors _readJSONL. Load-bearing
    // for migrated beings: the DEK backfill re-encrypted continuity/*.jsonl under
    // the being's own key, so a global-only read would fail to decrypt every line
    // (surfacing as torn lines). Mixed-mode files (pre-DEK lines + DEK lines) stay
    // fully readable because each line is tried independently.
    const dek = await this._resolveDEK(filePath);
    const out = [];
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        let entry;
        if (dek) {
          try { entry = parseAndDecrypt(trimmed, { key: dek }); }
          catch { entry = parseAndDecrypt(trimmed); }
        } else {
          entry = parseAndDecrypt(trimmed);
        }
        if (entry !== null && entry !== undefined) out.push(entry);
      } catch (err) {
        // Surface via callback if injected, else console.warn fallback. Importing
        // backend/services/logger.js from core/ would cross the platform→engine
        // boundary; the callback IS the structured-logger seam for production callers.
        if (opts.onTornLine) opts.onTornLine(trimmed, err, layer);
        else console.warn(`[workspace.continuity] skipped torn line in ${layer} (${err.message})`);
      }
    }
    return out;
  },
});
