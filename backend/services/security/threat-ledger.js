// Threat ledger — the CSO office's standing repository: every vulnerability,
// exposed-secret finding, host drift, and house-hygiene failure the watch has
// ever surfaced, each carried from `new` to a settled verdict.
//
// One JSON document PER HOUSE (Design note, 2026-10-16: two houses on one machine are
// never confused) at `<realm>/<wallet>/offices/security/security-threats.json`
// (house-office.js); the machine-wide ledger under data/settings moves once to
// the house that owns the seated CSO lane. Governance record, not a secret —
// with the same cross-process posture as the post queue: a serialized mutate
// riding the file lock, because this box runs two backend processes against
// the same house and a lost update here is a threat nobody is watching.
//
// Dedup law: a finding is identified by (source, externalId, repo). A re-scan
// that sees the same finding again REFRESHES it (lastSeenAt, and it reopens
// only if it was never assessed) — it never duplicates it. An entry the
// latest scan no longer surfaces keeps its record (the ledger is history);
// only `new`-state counts move.

import fs from 'fs/promises';
import { join, dirname } from 'path';
import { randomUUID } from 'crypto';
import { getSettingsDir } from '../data-root.js';
import { withFileLock } from '../file-lock.js';
import { createLogger } from '../logger.js';
import { journalAssessment } from './assessment-journal.js';
import { createWriteChain } from '../write-chain.js';
import { createHouseStore } from '../house-office.js';
import { legacyCsoPath } from './cso-designation.js';

const log = createLogger('ThreatLedger');

const DEFAULT_LEGACY_PATH = join(getSettingsDir(), 'security-threats.json');

// The pre-2026-10-16 machine ledger, read per call so tests never touch the
// operator's live one.
const legacyThreatsPath = () =>
  process.env.NEUMA_SECURITY_THREATS_PATH || DEFAULT_LEGACY_PATH;

export const THREAT_LAYERS = Object.freeze(['software', 'hardware', 'house']);
export const THREAT_SOURCES = Object.freeze(['osv', 'secret-sweep', 'host-probe', 'house-probe', 'manual']);
export const THREAT_STATUSES = Object.freeze(['new', 'not_affected', 'confirmed', 'mitigated', 'needs_operator']);
export const THREAT_SEVERITIES = Object.freeze(['critical', 'high', 'medium', 'low', 'unknown']);

const ENTRY_ID_PREFIX = 'th_';
const ASSESSMENT_MAX = 4000;
const SUMMARY_MAX = 2000;

// pure — the identity a finding is deduplicated on.
export const threatKey = ({ source, externalId, repo }) =>
  `${source}::${externalId}::${repo || ''}`;

// pure — one entry the ledger will stand behind, or a rejection reason.
export const validateThreat = (entry) => {
  if (!entry || typeof entry !== 'object') return 'a threat entry is an object';
  if (!THREAT_LAYERS.includes(entry.layer)) return `layer must be one of ${THREAT_LAYERS.join(' | ')}`;
  if (!THREAT_SOURCES.includes(entry.source)) return `source must be one of ${THREAT_SOURCES.join(' | ')}`;
  if (typeof entry.externalId !== 'string' || !entry.externalId.trim()) return 'a threat needs an externalId (CVE/GHSA/finding id)';
  if (typeof entry.title !== 'string' || !entry.title.trim()) return 'a threat needs a title';
  if (entry.severity !== undefined && !THREAT_SEVERITIES.includes(entry.severity)) {
    return `severity must be one of ${THREAT_SEVERITIES.join(' | ')}`;
  }
  return null;
};

// pure — what the CSO's briefing and the desk posture read.
export const threatsByStatus = (entries, status) => entries.filter((e) => e.status === status);

// pure — counts by status then layer, for the posture strip.
export const threatCounts = (entries) => {
  const byStatus = {};
  const byLayer = {};
  for (const e of entries) {
    byStatus[e.status] = (byStatus[e.status] || 0) + 1;
    byLayer[e.layer] = (byLayer[e.layer] || 0) + 1;
  }
  return { total: entries.length, byStatus, byLayer };
};

// pure — a verdict's minimum shape, or a rejection reason. Shared by assess
// and assessMany.
const validateVerdict = (verdict) => {
  const status = verdict?.status;
  if (!THREAT_STATUSES.includes(status) || status === 'new') {
    return `assess needs a settling status: ${THREAT_STATUSES.filter((s) => s !== 'new').join(' | ')}`;
  }
  if (typeof verdict?.assessment !== 'string' || !verdict.assessment.trim()) {
    return 'an assessment without its reasoning is not an assessment';
  }
  return null;
};

// Stamp one entry with the CSO's verdict AND record it in the entry's own
// history. The top-level fields stay the LATEST view (what the briefing and
// posture read); the history is the office's memory — a verdict is never
// overwritten, only superseded (before this, a re-assessment erased the
// reasoning it replaced, and the office could never show its work).
// Runs inside the mutate lock; entries written before history existed are
// tolerated (their past verdicts are simply not recoverable).
const applyVerdict = (entry, verdict) => {
  const at = new Date().toISOString();
  entry.status = verdict.status;
  entry.assessment = String(verdict.assessment).slice(0, ASSESSMENT_MAX);
  if (Array.isArray(verdict.surfaces)) entry.surfaces = verdict.surfaces;
  entry.assessedAt = at;
  entry.assessedBy = typeof verdict.assessedBy === 'string' ? verdict.assessedBy : null;
  if (typeof verdict.githubIssue === 'string' && verdict.githubIssue) entry.githubIssue = verdict.githubIssue;
  entry.history = [...(Array.isArray(entry.history) ? entry.history : []), {
    status: entry.status,
    assessment: entry.assessment,
    surfaces: entry.surfaces,
    assessedBy: entry.assessedBy,
    assessedAt: at,
    githubIssue: entry.githubIssue,
  }];
};

// impure — the journal hook, guarded: the journal's own contract is
// fail-soft, but the ledger never trusts an injected function with a verdict.
const safeJournal = async (journal, entry, verdict) => {
  try {
    await journal({ entry, verdict });
  } catch (err) {
    log.warn('assessment journal failed — the verdict stands', { id: entry?.id, error: err.message });
  }
};

/**
 * @param {{ path: string|(() => string), journal?: null|((args: {entry: Object, verdict: Object}) => Promise<void>) }} [opts]
 *   journal — the office's memory hook: invoked awaited-but-fail-soft AFTER
 *   the lock releases, once per settled entry. It must never throw; a
 *   journal failure must not block a verdict (it is caught and logged here
 *   all the same).
 */
export const createThreatLedger = ({ path, journal = null }) => {
  const target = () => (typeof path === 'function' ? path() : path);
  const lockPath = () => `${target()}.lock`;

  // Serialize mutations in-process; the file lock serializes across
  // processes — both, never one.
  const serialize = createWriteChain();

  // impure — missing file = an empty ledger; a corrupt file THROWS (a ledger
  // that silently reads empty would mark every known threat "new" again and
  // bury the assessed record).
  const load = async () => {
    let raw;
    try {
      raw = await fs.readFile(target(), 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error('threat-ledger: store is not an array');
    return parsed;
  };

  // impure — atomic tmp+rename with the 0600/0700 re-tighten.
  const save = async (entries) => {
    const file = target();
    await fs.mkdir(dirname(file), { recursive: true, mode: 0o700 });
    const tmp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, `${JSON.stringify(entries, null, 2)}\n`, { mode: 0o600 });
    await fs.rename(tmp, file);
    await fs.chmod(dirname(file), 0o700);
    await fs.chmod(file, 0o600);
  };

  // impure — read-modify-write as ONE atom across processes.
  const mutate = (fn) => serialize(() => withFileLock(lockPath(), async () => {
    const entries = await load();
    const result = await fn(entries);
    await save(entries);
    return result;
  }));

  return {
    /** Every entry, oldest first. impure. */
    load,

    /**
     * Ingest a scan's findings: new findings enter as `new`; re-seen findings
     * refresh `lastSeenAt` (assessed verdicts stand — a scanner never reopens
     * a settled threat). impure.
     * @param {Array<Object>} findings validated threat shapes (no id/status yet)
     * @returns {Promise<{added: Array<Object>, seen: number}>}
     */
    ingest(findings) {
      if (!Array.isArray(findings)) return Promise.reject(new Error('ingest needs an array of findings'));
      return mutate(async (entries) => {
        const now = new Date().toISOString();
        const index = new Map(entries.map((e, i) => [threatKey(e), i]));
        const added = [];
        let seen = 0;
        for (const finding of findings) {
          const invalid = validateThreat(finding);
          if (invalid) throw new Error(`threat-ledger: ${invalid}`);
          const key = threatKey(finding);
          const at = index.get(key);
          if (at !== undefined) {
            entries[at].lastSeenAt = now;
            seen += 1;
            continue;
          }
          const entry = {
            id: `${ENTRY_ID_PREFIX}${randomUUID()}`,
            layer: finding.layer,
            source: finding.source,
            repo: finding.repo || null,
            externalId: finding.externalId.trim(),
            title: finding.title.trim(),
            severity: finding.severity || 'unknown',
            summary: String(finding.summary || '').slice(0, SUMMARY_MAX),
            affected: Array.isArray(finding.affected) ? finding.affected : [],
            surfaces: Array.isArray(finding.surfaces) ? finding.surfaces : [],
            status: 'new',
            assessment: null,
            history: [],
            publishedAt: finding.publishedAt || null,
            ingestedAt: now,
            lastSeenAt: now,
            assessedAt: null,
            assessedBy: null,
            githubIssue: null,
          };
          index.set(key, entries.length);
          entries.push(entry);
          added.push(entry);
        }
        return { added, seen };
      });
    },

    /**
     * Record the CSO's verdict on one entry — the assessment IS the office's
     * work product. impure.
     * @param {string} id full id or an unambiguous prefix
     * @param {{status: string, assessment: string, surfaces?: string[], assessedBy?: string, githubIssue?: string}} verdict
     */
    assess(id, verdict) {
      const invalid = validateVerdict(verdict);
      if (invalid) return Promise.reject(new Error(invalid));
      return mutate(async (entries) => {
        const hits = entries.filter((e) => e.id === id || e.id.startsWith(id));
        if (hits.length === 0) return { ok: false, error: 'no such threat' };
        if (hits.length > 1) return { ok: false, error: `ambiguous id — ${hits.length} entries match` };
        const entry = hits[0];
        applyVerdict(entry, verdict);
        return { ok: true, entry };
      }).then(async (result) => {
        if (result.ok && journal) await safeJournal(journal, result.entry, verdict);
        return result;
      });
    },

    /**
     * One verdict settling MANY entries at once — the backlog triage path:
     * forty advisories sharing one surface and one reasoning are assessed
     * together, each entry keeping its own history record. Partial success
     * is reported, never silent: what settled, and what failed with why.
     * impure.
     * @param {string[]} ids full ids or unambiguous prefixes
     * @param {{status: string, assessment: string, surfaces?: string[], assessedBy?: string, githubIssue?: string}} verdict
     * @returns {Promise<{ok: boolean, settled: Array<Object>, failed: Array<{id: string, error: string}>}>}
     */
    assessMany(ids, verdict) {
      if (!Array.isArray(ids) || ids.length === 0) {
        return Promise.reject(new Error('assessMany needs a non-empty array of ids'));
      }
      const invalid = validateVerdict(verdict);
      if (invalid) return Promise.reject(new Error(invalid));
      return mutate(async (entries) => {
        const settled = [];
        const failed = [];
        for (const raw of ids) {
          const id = String(raw || '');
          const hits = entries.filter((e) => e.id === id || e.id.startsWith(id));
          if (hits.length === 0) { failed.push({ id, error: 'no such threat' }); continue; }
          if (hits.length > 1) { failed.push({ id, error: `ambiguous id — ${hits.length} entries match` }); continue; }
          applyVerdict(hits[0], verdict);
          settled.push(hits[0]);
        }
        return { ok: failed.length === 0, settled, failed };
      }).then(async (result) => {
        if (journal) {
          for (const entry of result.settled) await safeJournal(journal, entry, verdict);
        }
        return result;
      });
    },

    /** One entry by id (full or unambiguous prefix). impure. */
    async get(id) {
      const entries = await load();
      const hits = entries.filter((e) => e.id === id || e.id.startsWith(id));
      if (hits.length !== 1) return null;
      return hits[0];
    },
  };
};

// A house's own ledger — the routes, the scheduler, and the portal tools open
// it for the house in question — wired with the real journal: every verdict
// also lands in the CSO lane's assessments drawer, so the office's experience
// outlives any session. impure.
export const threatLedgerFor = createHouseStore({
  office: 'security',
  name: 'security-threats.json',
  legacyPath: legacyThreatsPath,
  legacySeatPath: legacyCsoPath,
  create: (opts) => createThreatLedger({ ...opts, journal: journalAssessment }),
});
