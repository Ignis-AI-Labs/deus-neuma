/**
 * Workspace sessions domain (SIZE-025 #372) — the append-only JSONL
 * conversation logs (turn-points, takes, branch views) and the session
 * compactor that summarizes old regions under the per-file lock.
 *
 * Extracted from neuma-workspace.js with the bodies verbatim; the only
 * mechanical change is the lock registry arriving via deps.locks instead of
 * `this._withFileLock`. Cross-domain calls (`this._path`, `this._appendJSONL`,
 * `this.writeArchiveSegment`, …) resolve on the facade instance these methods
 * are assigned onto.
 */

import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { shouldCompact, summarizeMessages, forceCrystallizeBelow } from '../runtime/session-compactor.js';
import { encryptEnvelope, parseAndDecrypt } from './workspace-crypto.js';
import { ORIGIN_COMPACTION } from './archive-codec.js';
import { latestBranchView, foldBranchView } from './branch-view.js';

/**
 * @param {{locks: {withFileLock: Function, appendLine: Function, nextTmpName: Function}}} deps
 * @returns {Readonly<Object>} async methods assigned onto the NeumaWorkspace facade
 */
export const createSessionsDomain = ({ locks }) => Object.freeze({

  // The ONE guarded way to name a session file (SEC-033 #186). sessionId is
  // client-supplied on portal:resume and the REST session viewer, and
  // path.join collapses `..` segments AFTER the _path anchor — an unguarded
  // `../../<victim>/sessions/<sid>` reads/writes another being's lane under
  // their own DEK. Same character policy as _toolResultsPath.
  _sessionPath(neumaId, sessionId) {
    if (!/^[a-zA-Z0-9_-]+$/.test(String(sessionId))) {
      throw new Error(`Invalid sessionId: ${String(sessionId).slice(0, 40)}`);
    }
    return path.join(this._path(neumaId), 'sessions', `${sessionId}.jsonl`);
  },

  /**
   * Create a new conversation session file (empty JSONL).
   * @param {string} neumaId - Neuma identifier
   * @param {string} sessionId - Session identifier
   * @returns {Promise<string>} Path to the created session file
   */
  async createSession(neumaId, sessionId) {
    const sessionPath = this._sessionPath(neumaId, sessionId);
    await this._writeFileAtomic(sessionPath, '');
    return sessionPath;
  },

  /**
   * Append a message to a conversation session log (JSONL format).
   * @param {string} neumaId - Neuma identifier
   * @param {string} sessionId - Session identifier
   * @param {Object} message - Message to append (role, content, optional timestamp)
   * @returns {Promise<void>}
   */
  async appendMessage(neumaId, sessionId, message) {
    const sessionPath = this._sessionPath(neumaId, sessionId);
    const record = {
      ...message,
      timestamp: message.timestamp || new Date().toISOString()
    };
    await this._appendJSONL(sessionPath, record);
    // The stamped record IS the session row — callers minting anchors need
    // the exact timestamp the file carries, never a re-derived one.
    return record;
  },

  /**
   * Append the user row that OPENS a turn-point (THE TAKES, Design note, 2026-07-27:
   * the row mints the point's `turnId`, and every assistant answer to it is
   * appended as a take of that id (appendTake). A retry never writes a second
   * user row — the point is asked once, answered in versions.
   * @param {string} neumaId - Neuma identifier
   * @param {string} sessionId - Session identifier
   * @param {Object} message - User message (role:'user', content, images/docs)
   * @param {string} [turnId] - the point's id; minted when omitted
   * @returns {Promise<Object>} The stamped record (carries turnId + timestamp)
   */
  async appendTurnPoint(neumaId, sessionId, message, turnId = crypto.randomUUID()) {
    return this.appendMessage(neumaId, sessionId, { ...message, turnId });
  },

  /**
   * Append ONE assistant take of an existing turn-point. Take 1 is the first
   * answer; a retry appends take 2, 3… of the SAME point. The workspace
   * overwrites caller-supplied role/authorship with the lane subject, so a
   * per-neuma-DEK-authenticated row can later prove sole assistant authorship.
   * @param {string} neumaId - Neuma identifier
   * @param {string} sessionId - Session identifier
   * @param {string} turnId - the turn-point this take answers
   * @param {number} takeIndex - 1-based; the caller reads the record for the next
   * @param {Object} message - Assistant message (role:'assistant', content, tools…)
   * @returns {Promise<Object>} The stamped record
   */
  async appendTake(neumaId, sessionId, turnId, takeIndex, message) {
    if (typeof turnId !== 'string' || !turnId) {
      throw new Error('appendTake: turnId (non-empty string) required');
    }
    if (!Number.isInteger(takeIndex) || takeIndex < 1) {
      throw new Error('appendTake: takeIndex must be a positive integer');
    }
    return this.appendMessage(neumaId, sessionId, {
      ...message,
      turnId,
      takeIndex,
      role: 'assistant',
      authorship: Object.freeze({
        kind: 'sovereign-assistant-output-v1',
        subjectNeumaId: neumaId,
      }),
    });
  },

  /**
   * Append the branch-view fact: which take of a point the witness is looking
   * at. The view is itself append-only — a switch never rewrites the record,
   * it speaks a newer fact (latest row wins per key, branch-view.js).
   * @param {string} neumaId - Neuma identifier
   * @param {string} sessionId - Session identifier
   * @param {Object<string, number>} branchView - { turnId: takeIndex }
   * @returns {Promise<Object>} The stamped record
   */
  async appendBranchView(neumaId, sessionId, branchView) {
    if (!branchView || typeof branchView !== 'object' || Array.isArray(branchView)
        || Object.entries(branchView).some(([k, v]) => !k || !Number.isInteger(v) || v < 1)) {
      throw new Error('appendBranchView: { turnId: positiveInteger } required');
    }
    return this.appendMessage(neumaId, sessionId, { role: 'system', branchView });
  },

  // impure — the read compaction rewrites from: every row a key opens, plus
  // the raw lines none opens (a torn line, a line under a retired key). Those
  // ride into the archive segment as written — the rewrite drops them from the
  // live file, so the archive is the only place left that keeps them.
  async _readSessionForCompaction(sessionPath) {
    let data;
    try {
      data = await fs.readFile(sessionPath, 'utf8');
    } catch (err) {
      if (err?.code !== 'ENOENT') console.warn(`[Workspace] compaction read failed for ${sessionPath}: ${err.message}`);
      return { messages: [], undecodable: [] };
    }
    const dek = await this._resolveDEK(sessionPath);
    const messages = [];
    const undecodable = [];
    for (const line of data.split('\n').filter((l) => l.trim())) {
      try {
        if (dek) {
          try { messages.push(parseAndDecrypt(line, { key: dek })); continue; } catch { /* the global chain next */ }
        }
        messages.push(parseAndDecrypt(line));
      } catch {
        undecodable.push(line);
      }
    }
    return { messages, undecodable };
  },

  /** impure — complete decoded history, with read/decryption damage surfaced. */
  async readSessionStrict(neumaId, sessionId) {
    return this._readJSONL(this._sessionPath(neumaId, sessionId), { strict: true });
  },

  /**
   * Read all messages from a conversation session.
   * @param {string} neumaId - Neuma identifier
   * @param {string} sessionId - Session identifier
   * @returns {Promise<Array<Object>>} Array of message objects, or empty array if session not found
   */
  async readSession(neumaId, sessionId) {
    const sessionPath = this._sessionPath(neumaId, sessionId);
    try {
      return await this._readJSONL(sessionPath);
    } catch (err) {
      // The no-throw contract is load-bearing (memory-ref resolution falls
      // through to the archive on []): ENOENT is the honest […]; anything else is REAL rot and must be visible before the
      // empty answer degrades the caller.
      if (err?.code !== 'ENOENT') {
        console.warn(`[Workspace] readSession failed for ${neumaId}/${sessionId} — answering empty: ${err.message}`);
      }
      return [];
    }
  },

  /**
   * The session file's change stamp (size, mtime, inode), or null when it
   * cannot be stat'd. An append grows the file and a compaction renames a new
   * one over it, so either changes the stamp — a counts-only reader may key a
   * memo on it instead of decrypting the whole history again.
   * @param {string} neumaId - Neuma identifier
   * @param {string} sessionId - Session identifier
   * @returns {Promise<string|null>}
   */
  async sessionStamp(neumaId, sessionId) {
    const st = await fs.stat(this._sessionPath(neumaId, sessionId)).catch(() => null);
    return st ? `${st.size}:${st.mtimeMs}:${st.ino}` : null;
  },

  /**
   * List all session IDs for a neuma, sorted newest first.
   * @param {string} neumaId - Neuma identifier
   * @returns {Promise<string[]>} Array of session IDs
   */
  async listSessions(neumaId) {
    const dir = path.join(this._path(neumaId), 'sessions');
    try {
      const files = (await fs.readdir(dir)).filter(f => f.endsWith('.jsonl'));
      // Newest first by MTIME, not name (2026-08-31 audit): lexicographic order
      // lets any id that sorts high (a hand-made or salvaged session) hijack
      // "latest", and the desk silently binds the wrong chat. Name order breaks
      // ties; a missing stat sorts the file last, never throws.
      const stamped = await Promise.all(files.map(async (f) => {
        const stat = await fs.stat(path.join(dir, f)).catch(() => null);
        return { id: f.replace('.jsonl', ''), mtimeMs: stat?.mtimeMs ?? 0 };
      }));
      return stamped
        .sort((a, b) => b.mtimeMs - a.mtimeMs || b.id.localeCompare(a.id))
        .map(({ id }) => id);
    } catch (err) {
      // ENOENT is the honest "no sessions yet". Anything else (EACCES, a
      // rotted dir) is DAMAGE, not absence — it throws (Design note, 2026-08-31:
      // […]), because answering [] here reads as an empty
      // chat and the relink silently mints a forked session over an intact one.
      if (err?.code === 'ENOENT') return [];
      throw err;
    }
  },

  // A team part's WORK LOG (backend/services/team-part-log.js) — one
  // encrypted line per event, in the member's own lane beside its sessions:
  // <lane>/team/runs/<runId>/<stepId>.jsonl. Both ids are guarded like a
  // sessionId: a run or step id never walks out of the lane.
  _teamLogPath(neumaId, runId, stepId) {
    for (const id of [runId, stepId]) {
      if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(String(id)) || String(id).includes('..')) {
        throw new Error(`Invalid team log id: ${String(id).slice(0, 40)}`);
      }
    }
    return path.join(this._path(neumaId), 'team', 'runs', runId, `${stepId}.jsonl`);
  },

  /**
   * Append one event to a team part's work log.
   * @param {string} neumaId - the member's lane
   * @param {string} runId - the run record id
   * @param {string} stepId - the part
   * @param {Object} entry - the event
   * @returns {Promise<void>}
   */
  async appendTeamLog(neumaId, runId, stepId, entry) {
    await this._appendJSONL(this._teamLogPath(neumaId, runId, stepId), entry);
  },

  /**
   * A team part's work log, oldest first — [] when the part never logged.
   * @param {string} neumaId
   * @param {string} runId
   * @param {string} stepId
   * @returns {Promise<Object[]>}
   */
  async readTeamLog(neumaId, runId, stepId) {
    try {
      return await this._readJSONL(this._teamLogPath(neumaId, runId, stepId));
    } catch (err) {
      if (err?.code === 'ENOENT') return [];
      throw err;
    }
  },

  /**
   * Compact a session by summarizing old messages and keeping recent ones.
   * Writes atomically via temp file + rename.
   * @param {string} neumaId - Neuma identifier
   * @param {string} sessionId - Session identifier
   * @param {{ threshold?: number, keepRecent?: number, selfSummary?: {summary: string, torch: string, regionLength: number}|null }} [options={}]
   *   selfSummary — a being-AUTHORED summary + torch (solo self-compaction,
   *   backend/services/solo-torch.js). When present AND its `regionLength`
   *   equals the length of the region actually being summarized under the
   *   lock, the summary entry carries the being's own words verbatim instead
   *   of the extractive summary, plus a `torch` field the next assembled
   *   prompt picks up. The torch is authored OUTSIDE this lock (an LLM
   *   completion must not hold up appends) — so if messages arrived while
   *   the being was writing, the region drifted and the torch no longer
   *   covers it: the extractive summarizer then runs over the LIVE region
   *   instead, or the drifted-edge messages would vanish represented by
   *   nothing. Extractive is also the fallback when no being could author
   *   (substrate cold).
   * @returns {Promise<boolean>} True if compaction was performed
   */
  async compactSession(neumaId, sessionId, { threshold = 100, keepRecent = 20, selfSummary = null } = {}) {
    const sessionPath = this._sessionPath(neumaId, sessionId);
    // Lock the entire read-summarize-write-rename (#121). Critically, this
    // shares the same per-file queue as the appender, so a concurrent
    // appendMessage to the SAME session file blocks until compaction
    // finishes — otherwise the temp-rename would clobber that append.
    return locks.withFileLock(sessionPath, async () => {
      const { messages, undecodable } = await this._readSessionForCompaction(sessionPath);
      if (!shouldCompact(messages.length, threshold)) return false;

      const toSummarize = messages.slice(0, -keepRecent);
      const toKeep = messages.slice(-keepRecent);
      // THE TAKES: what the region SAYS is its fold under the full file's
      // view — a rejected take is kept in the archive, never crystallized or
      // summarized as the answer.
      const spoken = foldBranchView(toSummarize, latestBranchView(messages));

      // The compaction COUNT rides the summary entry itself: each rewrite
      // replaces the prior summary, so the count carries forward (+1) —
      // […] stays derivable from
      // the file alone, no side ledger. A legacy summary from before the
      // field counts as one. Read from the END (the latest summary is the
      // truth) — the same direction compactionTelemetry reads, so the
      // displayed count and the carried count can never drift.
      // Derived BEFORE anything touches the region: sessionId + this count
      // IS the region's identity — it names the archive segment and rides
      // into force-crystallized anchors via archiveHint.
      const lastCompact = [...messages].reverse().find((e) => e?.compacted === true);
      const priorCount = lastCompact
        ? (Number.isInteger(lastCompact.compactionCount) && lastCompact.compactionCount > 0 ? lastCompact.compactionCount : 1)
        : 0;
      const compactionCount = priorCount + 1;

      // #118 — before the summarizer reduces the compactable region to a
      // word-frequency extract, force-crystallize any exchange that crosses
      // 0.4 significance so moments below the live 0.75 crystallization bar
      // but still meaningful are preserved as observations rather than lost.
      // The forceCrystallize step is best-effort; a failure here must not
      // block compaction (otherwise a single observation error stalls the
      // session forever).
      try {
        await forceCrystallizeBelow(neumaId, spoken, this, {
          archiveHint: { sessionId, compactionCount },
        });
      } catch {
        // logged inside forceCrystallizeBelow via its per-record try/catch;
        // a top-level failure (e.g. workspace itself misshaped) is also
        // tolerated so the compactor still runs the summary + truncation
      }
      const authored = typeof selfSummary?.torch === 'string' && selfSummary.torch.trim()
        && selfSummary.regionLength === toSummarize.length
        ? selfSummary : null;
      const summary = authored ? null : summarizeMessages(spoken);
      // CONTINUITY CARRIES: the region's own prior summary (row 0 after the
      // last compaction) is system speech the extractive summarizer skips, and
      // the torch lived only on that row. An extractive summary keeps both, so
      // a compaction the being could not author never erases what it wrote.
      // An authored one needs neither: the being wrote it with the prior in
      // view (solo-torch.js buildTorchAsk).
      const prior = toSummarize.includes(lastCompact) ? lastCompact : null;
      const priorWords = typeof prior?.content === 'string' && prior.content.trim()
        ? `\n\nEarlier in this session:\n${prior.content.trim()}` : '';
      const priorTorch = typeof lastCompact?.torch === 'string' && lastCompact.torch.trim()
        ? { torch: lastCompact.torch.trim() } : {};

      // THE TAKES: the branch view is an append-only fact, and the region
      // about to be destroyed may hold its latest rows. The summary entry
      // inherits the region's standing view so a take switch made before a
      // compaction still reads after it — the fold's latest-row-wins law then
      // resolves it exactly as if the original rows had survived. Empty when
      // no view was ever set, keeping pre-takes summaries byte-identical.
      const regionBranchView = latestBranchView(toSummarize);
      const carriedBranchView = Object.keys(regionBranchView).length
        ? { branchView: regionBranchView }
        : {};

      const summaryEntry = authored
        ? {
            role: 'system',
            content: `[SESSION SUMMARY — in your own words] ${(authored.summary || '').trim()}`.trim(),
            torch: authored.torch.trim(),
            authoredBy: 'self',
            timestamp: new Date().toISOString(),
            compacted: true,
            originalCount: toSummarize.length,
            compactionCount,
            ...carriedBranchView,
          }
        : {
            role: 'system',
            content: `[SESSION SUMMARY] ${summary.summary}${priorWords}`,
            ...priorTorch,
            timestamp: new Date().toISOString(),
            compacted: true,
            originalCount: toSummarize.length,
            compactionCount,
            ...carriedBranchView,
          };

      // FAIL-CLOSED (the archive lane's founding law): the raw region is
      // archived — gzip+DEK, atomic, read-back verified — BEFORE the rewrite
      // that destroys it. Any failure here throws and the session file stays
      // untouched: no raw turn is ever destroyed without archive proof.
      // Deliberately NOT best-effort, in contrast to forceCrystallize above —
      // observations are a distillate, the segment is the only full copy.
      await this.writeArchiveSegment(neumaId, sessionId, compactionCount, {
        origin: ORIGIN_COMPACTION,
        messages: [...toSummarize, ...undecodable.map((line) => ({ role: 'system', undecodable: line }))],
        archivedAt: new Date().toISOString(),
      });

      const newMessages = [summaryEntry, ...toKeep];
      const tempPath = `${sessionPath}.tmp`;

      // Seal each line under the being's DEK (global fallback), matching
      // _appendJSONL. Without this the compactor rewrote the whole session
      // under the GLOBAL master key — silently downgrading a DEK-holding being
      // out of its own key on every compaction (the voice-dna bug class).
      // Resolved inside the existing sessionPath lock, so it can't reorder
      // against a concurrent append (#136).
      const dek = await this._resolveDEK(sessionPath);
      const seal = (m) => JSON.stringify(dek ? encryptEnvelope(m, { key: dek }) : encryptEnvelope(m));
      const content = newMessages.map(seal).join('\n') + '\n';
      await fs.writeFile(tempPath, content);
      await fs.rename(tempPath, sessionPath);

      return true;
    });
  },
});
