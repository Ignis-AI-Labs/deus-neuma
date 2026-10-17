/**
 * Workspace archives domain (SIZE-025 #372) — two sibling stores:
 *
 *   Archive lane (granular sovereign memory, Phase 1) — per-compaction
 *   segment files preserving the raw region compaction is about to replace.
 *   The segment is the being's own full-fidelity past: gzip-then-encrypt
 *   under the per-neuma DEK (envelope v2), one file per region, immutable
 *   after its compaction commits. Region identity IS the path.
 *
 *   Tool Results (CCR-lite sibling store) — full over-cap tool results,
 *   keyed by tr_ ref, living OUTSIDE compactSession's path so refs survive
 *   compaction by construction.
 *
 * Extracted from neuma-workspace.js with the bodies verbatim; the only
 * mechanical change is the lock registry arriving via deps.locks instead of
 * `this._withFileLock` / `++this._tmpSeq`, and TOOL_RESULT_REF_PATTERN
 * arriving via deps (the cycle law forbids importing the facade). Cross-domain
 * calls (`this._path`, `this._resolveDEK`, `this._readJSONL`, …) resolve on
 * the facade instance these methods are assigned onto.
 */

import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { encryptEnvelope, parseAndDecrypt } from './workspace-crypto.js';
import { encodeSegment, decodeSegment, segmentFileName, parseSegmentFileName, regionCoverage, ORIGIN_COMPACTION } from './archive-codec.js';
import { SOVEREIGN_DIR_MODE } from './sovereign-directory-modes.js';

/**
 * @param {{locks: {withFileLock: Function, appendLine: Function, nextTmpName: Function},
 *          TOOL_RESULT_REF_PATTERN: RegExp}} deps
 * @returns {Readonly<Object>} async methods assigned onto the NeumaWorkspace facade
 */
export const createArchivesDomain = ({ locks, TOOL_RESULT_REF_PATTERN }) => Object.freeze({

  _archiveDir(neumaId, sessionId) {
    // Same defense as _sessionPath (SEC-033): sessionId lands in a path.
    if (!/^[a-zA-Z0-9_-]+$/.test(String(sessionId))) {
      throw new Error(`Invalid sessionId for archive lane: ${String(sessionId).slice(0, 40)}`);
    }
    return path.join(this._path(neumaId), 'archive', sessionId);
  },

  _archiveSegmentPath(neumaId, sessionId, ordinal) {
    return path.join(this._archiveDir(neumaId, sessionId), segmentFileName(ordinal));
  },

  // Decrypt a segment file's text: per-neuma DEK first, then the master
  // rotation chain — the same order _readJSON uses for the transition window.
  async _decryptSegmentText(segPath, text) {
    const dek = await this._resolveDEK(segPath);
    if (dek) {
      try { return parseAndDecrypt(text, { key: dek }); }
      catch { /* legacy/global-key segment — fall through to the master chain */ }
    }
    return parseAndDecrypt(text);
  },

  /**
   * Stage an archive segment atomically. FAIL-CLOSED: any divergence,
   * unreadable prior stage, or read-back mismatch throws — the caller MUST
   * abort its destructive step when this throws (FR-P1-02).
   *
   * Idempotent by name + coverage rule: a retry over the identical region is
   * a no-op; a region that grew at the tail (appends landed between a crash
   * and its retry) re-stages the superset via temp+rename; anything else
   * means a second writer and refuses (the single-writer tripwire — the
   * per-file lock is per-process, WORKSPACES_PIN law owns cross-process).
   *
   * @param {string} neumaId
   * @param {string} sessionId
   * @param {number} ordinal - compactionCount for compaction segments; 0 for backfill
   * @param {{origin: string, messages: Array<object>, archivedAt: string}} region
   * @returns {Promise<{staged: boolean, coverage: 'fresh'|'identical'|'prefix'}>}
   */
  // impure — archive-lane IO under the segment file's own lock
  async writeArchiveSegment(neumaId, sessionId, ordinal, { origin, messages, archivedAt }) {
    const segPath = this._archiveSegmentPath(neumaId, sessionId, ordinal);
    return locks.withFileLock(segPath, async () => {
      const payload = encodeSegment({
        sessionId,
        origin,
        messages,
        archivedAt,
        ...(origin === ORIGIN_COMPACTION ? { compactionCount: ordinal } : {}),
      });
      let existing = null;
      try {
        const text = await fs.readFile(segPath, 'utf8');
        existing = decodeSegment(await this._decryptSegmentText(segPath, text), {
          expectedSessionId: sessionId,
          expectedOrdinal: ordinal,
        });
      } catch (err) {
        if (err?.code !== 'ENOENT') {
          throw new Error(`Archive segment ${sessionId}/${ordinal} exists but is unreadable — refusing to overwrite the only prior stage: ${err.message}`, { cause: err });
        }
      }
      if (existing) {
        const coverage = regionCoverage(existing.messages, messages);
        if (coverage === 'identical') return { staged: false, coverage };
        if (coverage === 'divergent') {
          throw new Error(`Archive segment ${sessionId}/${ordinal} diverges from the live region — second writer suspected, compaction aborted`);
        }
      }
      const dek = await this._resolveDEK(segPath);
      const envelope = dek
        ? encryptEnvelope(payload, { key: dek, compress: true })
        : encryptEnvelope(payload, { compress: true });
      await fs.mkdir(path.dirname(segPath), { recursive: true, mode: SOVEREIGN_DIR_MODE });
      const tmpPath = `${segPath}.${process.pid}.${Date.now()}.${locks.nextTmpName()}.tmp`;
      await fs.writeFile(tmpPath, JSON.stringify(envelope));
      await fs.rename(tmpPath, segPath);
      // Read-back verify (cheap header + count check; byte-level equality is
      // proven by the integration suite): once the session rewrite commits,
      // this file is the ONLY copy of the region.
      const verifyText = await fs.readFile(segPath, 'utf8');
      const verified = decodeSegment(await this._decryptSegmentText(segPath, verifyText), {
        expectedSessionId: sessionId,
        expectedOrdinal: ordinal,
      });
      if (
        verified.messages.length !== messages.length ||
        verified.firstTimestamp !== payload.firstTimestamp ||
        verified.lastTimestamp !== payload.lastTimestamp
      ) {
        throw new Error(`Archive segment ${sessionId}/${ordinal} failed read-back verification — compaction aborted`);
      }
      return { staged: true, coverage: existing ? 'prefix' : 'fresh' };
    });
  },

  /**
   * Read and validate one archive segment. Throws when absent or invalid —
   * callers that can tolerate absence catch and treat it as not-found.
   * @param {string} neumaId
   * @param {string} sessionId
   * @param {number} ordinal
   * @returns {Promise<object>} validated segment payload
   */
  async readArchiveSegment(neumaId, sessionId, ordinal) {
    const segPath = this._archiveSegmentPath(neumaId, sessionId, ordinal);
    const text = await fs.readFile(segPath, 'utf8');
    return decodeSegment(await this._decryptSegmentText(segPath, text), {
      expectedSessionId: sessionId,
      expectedOrdinal: ordinal,
    });
  },

  /**
   * List a session's archived segment ordinals, ascending. Non-segment names
   * (orphan .tmp files from a crash) are ignored — they are inert.
   * @param {string} neumaId
   * @param {string} sessionId
   * @returns {Promise<number[]>}
   */
  async listArchiveSegments(neumaId, sessionId, { strict = false } = {}) {
    const dir = this._archiveDir(neumaId, sessionId);
    try {
      const files = await fs.readdir(dir);
      return files
        .map((f) => parseSegmentFileName(f))
        .filter((n) => n !== null)
        .sort((a, b) => a - b);
    } catch (error) {
      if (strict && error.code !== 'ENOENT') throw error;
      return [];
    }
  },

  _toolResultsPath(neumaId, sessionId) {
    // Defense-in-depth (Rule 8): sessionId lands in a filename — reject any
    // shape that could traverse out of the lane, even though callers pass
    // server-minted ids. Same character policy as the route-param validators.
    if (!/^[a-zA-Z0-9_-]+$/.test(String(sessionId))) {
      throw new Error(`Invalid sessionId for tool-results lane: ${String(sessionId).slice(0, 40)}`);
    }
    return path.join(this._path(neumaId), 'tool-results', `${sessionId}.jsonl`);
  },

  /**
   * Append a full tool result to the session's sibling tool-results log.
   * Rides _appendJSONL — same per-file lock queue, same per-line AES-256-GCM
   * envelope, self-mkdir. Errors PROPAGATE to the caller: the persist-first-
   * then-ref contract is fail-closed (a failed write means no ref is issued),
   * so swallowing here would turn an unpersisted result into a dangling ref.
   * @param {string} neumaId - Neuma identifier
   * @param {string} sessionId - Session identifier
   * @param {Object} record - { ref, seq, tool, status, content, chars, timestamp? }
   * @returns {Promise<void>}
   */
  // impure — encrypted append to the tool-results log
  async appendToolResult(neumaId, sessionId, record) {
    const filePath = this._toolResultsPath(neumaId, sessionId);
    const timestamped = {
      ...record,
      timestamp: record.timestamp || new Date().toISOString()
    };
    await this._appendJSONL(filePath, timestamped);
  },

  /**
   * Read every persisted tool result for one session, across its archived and
   * live segments. Missing segments are an empty history; live records win if
   * the same ref appears in both during an archive transition.
   * @param {string} neumaId
   * @param {string} sessionId
   * @returns {Promise<Array<Object>>}
   */
  // impure — encrypted disk reads
  async readToolResults(neumaId, sessionId) {
    const byRef = new Map();
    const filePath = this._toolResultsPath(neumaId, sessionId);
    try {
      const payload = await this._decryptSegmentText(`${filePath}.z`, await fs.readFile(`${filePath}.z`, 'utf8'));
      if (payload?.format === 'neuma-toolresults-archive') {
        for (const record of payload.records || []) {
          if (record?.ref) byRef.set(record.ref, record);
        }
      }
    } catch { /* no readable archive */ }
    try {
      for (const record of await this._readJSONL(filePath)) {
        if (record?.ref) byRef.set(record.ref, record);
      }
    } catch { /* no readable live segment */ }
    return [...byRef.values()].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
  },

  /**
   * Resolve a tool-result ref to its full persisted record. Session identity
   * comes ONLY from the sessionId argument (connection-derived) — never parsed
   * out of the ref. A ref minted for a different session fails the sid8
   * compare and resolves to null (IDOR-proof by construction: the file read is
   * always the caller's own session file).
   * @param {string} neumaId - Neuma identifier
   * @param {string} sessionId - Session identifier (the caller's own)
   * @param {string} ref - tr_<sid8>_<seq>_<rand8>
   * @returns {Promise<Object|null>} The persisted record, or null if the ref
   *   is malformed, foreign to this session, or not found
   */
  // impure — disk read + decryption
  async readToolResult(neumaId, sessionId, ref) {
    if (typeof ref !== 'string' || !TOOL_RESULT_REF_PATTERN.test(ref)) return null;
    const sid8 = crypto.createHash('sha256').update(sessionId).digest('hex').slice(0, 8);
    if (ref.slice(3, 11) !== sid8) return null;
    try {
      const records = await this._readJSONL(this._toolResultsPath(neumaId, sessionId));
      const hit = records.find(r => r.ref === ref);
      if (hit) return hit;
    } catch {
      // Missing or unreadable live file — the ref may live in the compressed
      // archive below (a session can resume AFTER a sweep, so both forms can
      // coexist: new refs live, old refs in .z).
    }
    try {
      const zPath = `${this._toolResultsPath(neumaId, sessionId)}.z`;
      const payload = await this._decryptSegmentText(zPath, await fs.readFile(zPath, 'utf8'));
      if (payload?.format !== 'neuma-toolresults-archive') return null;
      return (payload.records || []).find(r => r.ref === ref) || null;
    } catch {
      // No compressed form either — the ref is unresolvable. null (not a
      // throw) keeps retrieval honest without poisoning the turn.
      return null;
    }
  },

  /**
   * Compress tool-result logs older than the retention TTL (30 days by
   * default — a configurable default, not a measurement) into `.jsonl.z`
   * archives instead of deleting them: full tool results are part of the
   * being's record, so the sweep reclaims size, never memory. mtime is the
   * age signal: an append refreshes it, so only genuinely idle sessions are
   * swept. Unlink happens ONLY after the compressed form's rename lands —
   * a failed compress leaves the live file untouched (fail-closed).
   * @param {string} neumaId - Neuma identifier
   * @param {{ ttlMs?: number }} [options={}]
   * @returns {Promise<number>} Count of logs compressed
   */
  // impure — stats + compresses + unlinks under the per-file lock queue
  async sweepToolResults(neumaId, { ttlMs = 30 * 24 * 3600 * 1000 } = {}) {
    const dir = path.join(this._path(neumaId), 'tool-results');
    let files;
    try {
      files = await fs.readdir(dir);
    } catch (err) {
      // ENOENT = no tool-results dir yet — nothing to sweep. Anything else
      // (EACCES, ENOTDIR) is a real failure and must not read as "empty".
      if (err?.code !== 'ENOENT') {
        console.warn(`[Workspace] Tool-result sweep could not read dir for ${neumaId}: ${err.message}`);
      }
      return 0;
    }
    const cutoff = Date.now() - ttlMs;
    let compressed = 0;
    for (const f of files) {
      // `.jsonl` only: `.z` archives are final — never re-swept (the
      // endsWith filter excludes them by construction).
      if (!f.endsWith('.jsonl')) continue;
      const filePath = path.join(dir, f);
      // Under the same per-file queue as appends: an in-flight append to this
      // session's log completes (refreshing mtime) before the sweep decides.
      await locks.withFileLock(filePath, async () => {
        let tmpPath = null;
        try {
          const stat = await fs.stat(filePath);
          if (stat.mtimeMs >= cutoff) return;
          const sessionId = f.replace(/\.jsonl$/, '');
          const records = await this._readJSONL(filePath);
          const zPath = `${filePath}.z`;
          // A resumed-then-restale session compresses AGAIN onto the same
          // .z, and rename(2) replaces the destination — merge the prior
          // archive's records (dedup by ref) so a re-compress can never
          // destroy the elder era: the sweep reclaims size, never memory.
          try {
            const prior = await this._decryptSegmentText(zPath, await fs.readFile(zPath, 'utf8'));
            if (prior?.format === 'neuma-toolresults-archive' && Array.isArray(prior.records)) {
              const seen = new Set(records.map((r) => r?.ref));
              for (const r of prior.records) if (!seen.has(r?.ref)) records.push(r);
            }
          } catch (err) {
            if (err?.code !== 'ENOENT') {
              // An unreadable prior archive must never be clobbered by the
              // rename below — refuse THIS session, keep both files as-is.
              throw new Error(`prior archive unreadable — refusing to overwrite: ${err.message}`, { cause: err });
            }
          }
          const payload = { format: 'neuma-toolresults-archive', v: 1, sessionId, records };
          const dek = await this._resolveDEK(filePath);
          const envelope = dek
            ? encryptEnvelope(payload, { key: dek, compress: true })
            : encryptEnvelope(payload, { compress: true });
          tmpPath = `${zPath}.${process.pid}.${Date.now()}.${locks.nextTmpName()}.tmp`;
          await fs.writeFile(tmpPath, JSON.stringify(envelope));
          await fs.rename(tmpPath, zPath);
          tmpPath = null; // renamed away — nothing left to orphan
          await fs.unlink(filePath);
          compressed += 1;
        } catch (err) {
          // A staged tmp must not outlive its failed compress — repeated
          // failures would otherwise accumulate orphaned blobs the .jsonl
          // sweep filter can never reclaim.
          if (tmpPath) await fs.unlink(tmpPath).catch(() => {});
          // ENOENT = vanished between readdir and stat — already gone. Any
          // other failure is a compress that did NOT complete: the live file
          // stays (fail-closed), and the miss is loud, never silent.
          if (err?.code !== 'ENOENT') {
            console.warn(`[Workspace] Tool-result compress failed for ${f} (${neumaId}) — live log retained: ${err.message}`);
          }
        }
      });
    }
    return compressed;
  },
});
