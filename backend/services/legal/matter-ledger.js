// Matter ledger — the CLO office's standing record: every license question,
// gap in the house's own papers, piece of new work that touches a regulated
// area, and regulation the office found by research — each carried from
// `new` to a settled verdict.
//
// One JSON document per HOUSE (Design note, 2026-10-16: two houses on one machine
// are never confused): `<realm>/<wallet>/offices/legal/legal-matters.json`
// (house-office.js). The machine-wide ledger (data/settings/legal-matters.json)
// moves once to the house that owns the seated CLO lane — or, with no seat,
// to the machine's original single operator. Mutated in-process serialized
// AND under the file lock (this box runs more than one backend against the
// same store — a lost update is a matter nobody is watching).
//
// Dedup law: a matter is identified by (source, externalId, repo). A re-scan
// that sees it again REFRESHES lastSeenAt — it never duplicates it and never
// reopens a settled verdict. A matter the latest scan no longer surfaces
// keeps its record (the ledger is history).
//
// A verdict is law work, so it carries more than a word: its reasoning, the
// CITATIONS it rests on (a statute, a regulator's page, a licence text), and
// a reviewBy date — the law moves, and a settled matter is only settled
// until then. A verdict is never overwritten, only superseded (history).

import { join } from 'path';
import { randomUUID } from 'crypto';
import { getSettingsDir } from '../data-root.js';
import { withFileLock } from '../file-lock.js';
import { createWriteChain } from '../write-chain.js';
import { createLogger } from '../logger.js';
import { readDoc, saveDoc } from './legal-store-io.js';
import { journalOpinion } from './opinion-journal.js';
import { createHouseStore } from '../house-office.js';
import { legacyCloPath } from './clo-designation.js';

const log = createLogger('MatterLedger');

const DEFAULT_LEGACY_PATH = join(getSettingsDir(), 'legal-matters.json');

// The pre-2026-10-16 machine ledger, read per call so tests never touch the
// operator's live one.
const legacyMattersPath = () =>
  process.env.NEUMA_LEGAL_MATTERS_PATH || DEFAULT_LEGACY_PATH;

export const MATTER_AREAS = Object.freeze(['license', 'posture', 'product', 'regulation', 'marketing', 'commerce']);
export const MATTER_SOURCES = Object.freeze(['license-scan', 'posture-probe', 'build-watch', 'research', 'manual', 'campaign-review', 'commerce-review']);
export const MATTER_STATUSES = Object.freeze(['new', 'no_issue', 'concern', 'resolved', 'needs_counsel', 'needs_operator']);
export const MATTER_SEVERITIES = Object.freeze(['critical', 'high', 'medium', 'low', 'unknown']);

const ID_PREFIX = 'lm_';
const ASSESSMENT_MAX = 6000;
const SUMMARY_MAX = 3000;
const CITATIONS_MAX = 20;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// pure — the identity a matter is deduplicated on.
export const matterKey = ({ source, externalId, repo }) =>
  `${source}::${externalId}::${repo || ''}`;

// pure — one matter the ledger will stand behind, or a rejection reason.
export const validateMatter = (m) => {
  if (!m || typeof m !== 'object') return 'a matter is an object';
  if (!MATTER_AREAS.includes(m.area)) return `area must be one of ${MATTER_AREAS.join(' | ')}`;
  if (!MATTER_SOURCES.includes(m.source)) return `source must be one of ${MATTER_SOURCES.join(' | ')}`;
  if (typeof m.externalId !== 'string' || !m.externalId.trim()) return 'a matter needs an externalId';
  if (typeof m.title !== 'string' || !m.title.trim()) return 'a matter needs a title';
  if (m.severity !== undefined && !MATTER_SEVERITIES.includes(m.severity)) {
    return `severity must be one of ${MATTER_SEVERITIES.join(' | ')}`;
  }
  return null;
};

// pure — counts by status then area, for the posture strip.
export const matterCounts = (entries) => {
  const byStatus = {};
  const byArea = {};
  for (const e of entries) {
    byStatus[e.status] = (byStatus[e.status] || 0) + 1;
    byArea[e.area] = (byArea[e.area] || 0) + 1;
  }
  return { total: entries.length, byStatus, byArea };
};

// pure — settled matters whose reviewBy date has come (the law moved on).
export const mattersDueForReview = (entries, today = new Date().toISOString().slice(0, 10)) =>
  entries.filter((e) => e.status !== 'new' && typeof e.reviewBy === 'string' && e.reviewBy <= today);

const cleanCitations = (list) => (Array.isArray(list) ? list : [])
  .map((c) => String(c || '').trim()).filter(Boolean).slice(0, CITATIONS_MAX);

// pure — a verdict's minimum shape, or a rejection reason.
// A citation's own words that it was not read at its source.
const UNREAD_SOURCE = /\b(not|never|un)[- ]?(source[- ]?)?(verified|read|checked|confirmed)\b|from (my |the )?(clo |own )?(knowledge|memory|recall)|web access (was )?off|could not (be )?(read|fetch|reach)/i;

export const validateVerdict = (verdict) => {
  const status = verdict?.status;
  if (!MATTER_STATUSES.includes(status) || status === 'new') {
    return `a verdict needs a settling status: ${MATTER_STATUSES.filter((s) => s !== 'new').join(' | ')}`;
  }
  if (typeof verdict?.assessment !== 'string' || !verdict.assessment.trim()) {
    return 'a verdict without its reasoning is not a verdict';
  }
  // A legal reading rests on the law it read: every settled verdict but a
  // hand-off to counsel or the operator names at least one source.
  if (!['needs_counsel', 'needs_operator'].includes(status) && cleanCitations(verdict.citations).length === 0) {
    return 'cite what the verdict rests on — a statute, a regulator\'s page, the licence text (citations: [...])';
  }
  // A reading rests on law the office READ. A citation that says itself it was
  // not read (from memory, unverified, the source unreachable) cannot carry a
  // settled verdict: the honest flag becomes the honest status.
  if (!['needs_counsel', 'needs_operator'].includes(status) && cleanCitations(verdict.citations).some((c) => UNREAD_SOURCE.test(c))) {
    return 'a citation says its source was not read — read it first, or settle needs_operator (say what could not be read and why) or needs_counsel';
  }
  if (verdict.reviewBy !== undefined && verdict.reviewBy !== null
    && !(typeof verdict.reviewBy === 'string' && ISO_DATE.test(verdict.reviewBy))) {
    return 'reviewBy is a date: YYYY-MM-DD';
  }
  return null;
};

// Stamp one entry with the verdict AND record it in its history. The
// top-level fields stay the LATEST view; the history is the office's memory.
const applyVerdict = (entry, verdict) => {
  const at = new Date().toISOString();
  entry.status = verdict.status;
  entry.assessment = String(verdict.assessment).slice(0, ASSESSMENT_MAX);
  entry.citations = cleanCitations(verdict.citations);
  entry.reviewBy = verdict.reviewBy || null;
  entry.assessedAt = at;
  entry.assessedBy = typeof verdict.assessedBy === 'string' ? verdict.assessedBy : null;
  entry.history = [...(Array.isArray(entry.history) ? entry.history : []), {
    status: entry.status,
    assessment: entry.assessment,
    citations: entry.citations,
    reviewBy: entry.reviewBy,
    assessedBy: entry.assessedBy,
    assessedAt: at,
  }];
};

// impure — the journal hook, guarded: a journal failure never blocks a verdict.
const safeJournal = async (journal, entry, verdict) => {
  try {
    await journal({ entry, verdict });
  } catch (err) {
    log.warn('opinion journal failed — the verdict stands', { id: entry?.id, error: err.message });
  }
};

const findOne = (entries, id) => {
  const hits = entries.filter((e) => e.id === id || e.id.startsWith(id));
  if (!id || hits.length === 0) return { error: 'no such matter' };
  if (hits.length > 1) return { error: `ambiguous id — ${hits.length} matters match` };
  return { entry: hits[0] };
};

/**
 * @param {{ path: string|(() => string), journal?: null|((a: {entry: Object, verdict: Object}) => Promise<any>) }} opts
 */
export const createMatterLedger = ({ path, journal = null }) => {
  const target = () => (typeof path === 'function' ? path() : path);
  const serialize = createWriteChain();

  // impure — missing = empty; corrupt THROWS.
  const load = async () => {
    const parsed = await readDoc(target(), []);
    if (!Array.isArray(parsed)) throw new Error('matter-ledger: store is not an array');
    return parsed;
  };

  // impure — read-modify-write as ONE atom across processes.
  const mutate = (fn) => serialize(() => withFileLock(`${target()}.lock`, async () => {
    const entries = await load();
    const result = await fn(entries);
    await saveDoc(target(), entries);
    return result;
  }));

  return {
    /** Every matter, oldest first. impure. */
    load,

    /**
     * Ingest findings: new ones enter as `new`; re-seen ones refresh
     * lastSeenAt (and their affected list — the newest evidence). impure.
     * @param {Array<Object>} findings
     * @returns {Promise<{added: Array<Object>, seen: number}>}
     */
    ingest(findings) {
      if (!Array.isArray(findings)) return Promise.reject(new Error('ingest needs an array of findings'));
      const invalid = findings.map(validateMatter).find(Boolean);
      if (invalid) return Promise.reject(new Error(`matter-ledger: ${invalid}`));
      return mutate(async (entries) => {
        const now = new Date().toISOString();
        const index = new Map(entries.map((e, i) => [matterKey(e), i]));
        const added = [];
        let seen = 0;
        for (const f of findings) {
          const key = matterKey(f);
          const at = index.get(key);
          if (at !== undefined) {
            entries[at].lastSeenAt = now;
            if (Array.isArray(f.affected)) entries[at].affected = f.affected;
            seen += 1;
            continue;
          }
          const entry = {
            id: `${ID_PREFIX}${randomUUID()}`,
            area: f.area,
            source: f.source,
            repo: f.repo || null,
            // A campaign-review or commerce-review matter names the company it read.
            ...(typeof f.companyId === 'string' && f.companyId ? { companyId: f.companyId } : {}),
            externalId: f.externalId.trim(),
            title: f.title.trim(),
            severity: f.severity || 'unknown',
            summary: String(f.summary || '').slice(0, SUMMARY_MAX),
            regimes: Array.isArray(f.regimes) ? f.regimes.map(String) : [],
            affected: Array.isArray(f.affected) ? f.affected : [],
            status: 'new',
            assessment: null,
            citations: cleanCitations(f.citations),
            reviewBy: null,
            history: [],
            filedBy: typeof f.filedBy === 'string' ? f.filedBy : null,
            ingestedAt: now,
            lastSeenAt: now,
            assessedAt: null,
            assessedBy: null,
          };
          index.set(key, entries.length);
          entries.push(entry);
          added.push(entry);
        }
        return { added, seen };
      });
    },

    /**
     * One verdict settling one or many matters — partial success is
     * reported, never silent. impure.
     * @param {string[]} ids full ids or unambiguous prefixes
     * @param {{status: string, assessment: string, citations?: string[], reviewBy?: string, assessedBy?: string}} verdict
     * @returns {Promise<{ok: boolean, settled: Array<Object>, failed: Array<{id: string, error: string}>}>}
     */
    assess(ids, verdict) {
      if (!Array.isArray(ids) || ids.length === 0) return Promise.reject(new Error('assess needs a non-empty array of ids'));
      const invalid = validateVerdict(verdict);
      if (invalid) return Promise.reject(new Error(invalid));
      return mutate(async (entries) => {
        const settled = [];
        const failed = [];
        for (const raw of ids) {
          const id = String(raw || '');
          const { entry, error } = findOne(entries, id);
          if (error) { failed.push({ id, error }); continue; }
          applyVerdict(entry, verdict);
          settled.push(entry);
        }
        return { ok: failed.length === 0, settled, failed };
      }).then(async (result) => {
        if (journal) for (const entry of result.settled) await safeJournal(journal, entry, verdict);
        return result;
      });
    },

    /** One matter by id (full or unambiguous prefix), or null. impure. */
    async get(id) {
      return findOne(await load(), String(id || '')).entry || null;
    },
  };
};

// A house's own ledger — the routes, the watch, the reads, and the acts open
// it for the house in question, wired with the real journal (the Praetor's
// opinions drawer). The machine ledger moves home on the first open. impure.
export const matterLedgerFor = createHouseStore({
  office: 'legal',
  name: 'legal-matters.json',
  legacyPath: legacyMattersPath,
  legacySeatPath: legacyCloPath,
  create: (opts) => createMatterLedger({ ...opts, journal: journalOpinion }),
});
