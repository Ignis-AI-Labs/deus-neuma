/**
 * The legal intents — the CLO office's ACTS as filed intents (the security
 * acts' shape): run the watch now, settle matters with a cited reading, and
 * file what research found.
 *
 * THE SEAT LAW, at validate time: legal acts belong to the seated CLO alone,
 * re-read per act — refused BEFORE any card, so the operator is never asked
 * for an act this lane may not hold. The READS stay house-visible. The seat
 * and the ledger are the filing connection's OWN house's (its operator's
 * wallet), never a lane id matched against another house's seat.
 */
import { cloDesignation } from '../legal/clo-designation.js';
import { matterLedgerFor, validateVerdict, MATTER_SEVERITIES } from '../legal/matter-ledger.js';
import { runLegalWatch } from '../legal/legal-scheduler.js';

const ASSESS_BATCH_CAP = 50;
const SETTLING = Object.freeze(['no_issue', 'concern', 'resolved', 'needs_counsel', 'needs_operator']);

// impure — the seat, re-read per act.
const seatRefusal = async (connection) =>
  ((await cloDesignation.holds(connection.walletAddress, connection.companion?.neumaId))
    ? null
    : { ok: false, status: 'denied', reason: 'legal acts belong to the seated CLO alone' });

const invalid = (reason) => ({ ok: false, status: 'invalid', reason });

const availableFor = async ({ laneId, connection }) =>
  ((await cloDesignation.holds(connection?.walletAddress, laneId)) ? {} : null);

export const legalScanIntent = Object.freeze({
  name: 'legal/scan',
  policyTool: 'legal.scan',
  fieldsForPrompt: '{}',
  descriptionForPrompt: 'CLO ONLY. Run the legal watch now — licences shipped, the house\'s papers, and new commits against the regulated areas. The scheduler already runs at least every 24 hours.',
  availableFor,
  validate: async (_payload, { connection }) => (await seatRefusal(connection)) || { ok: true, value: {} },
  summarize: () => 'run the legal watch now',
  execute: async (_value, { connection }) => {
    const s = await runLegalWatch({ wallet: connection.walletAddress, trigger: 'clo' });
    return {
      ok: true,
      detail: [
        `Legal watch complete (${s.startedAt}).`,
        ...s.repos.map((r) => `- ${r.repo}: ${r.shipped} shipped packages, ${r.commits} new commits, ${r.matters} finding(s)${r.error ? ` — ERROR: ${r.error}` : ''}`),
        `Ledger: ${s.added} new, ${s.seen} known.${s.error ? ` ERROR: ${s.error}` : ''}`,
      ].join('\n'),
    };
  },
});

export const legalAssessIntent = Object.freeze({
  name: 'legal/assess',
  policyTool: 'legal.assess',
  fieldsForPrompt: '{id | ids, status, assessment, citations, reviewBy?}',
  descriptionForPrompt: `CLO ONLY. Settle one matter or a batch (up to ${ASSESS_BATCH_CAP}) with your reading. status: ${SETTLING.join(' | ')}. citations: the sources the reading rests on (statute + section, regulator page, licence text) — required except for needs_counsel / needs_operator. reviewBy: YYYY-MM-DD, when the reading must be checked again.`,
  availableFor,
  validate: async (payload, { connection }) => {
    const seat = await seatRefusal(connection);
    if (seat) return seat;
    const ids = Array.isArray(payload?.ids) ? payload.ids.map(String) : (payload?.id ? [String(payload.id)] : []);
    if (ids.length === 0) return invalid('name the matter(s): {id} or {ids}');
    if (ids.length > ASSESS_BATCH_CAP) return invalid(`a batch settles at most ${ASSESS_BATCH_CAP} matters — split it`);
    const verdict = {
      status: payload?.status,
      assessment: typeof payload?.assessment === 'string' ? payload.assessment : '',
      citations: Array.isArray(payload?.citations) ? payload.citations.map(String) : [],
      ...(payload?.reviewBy ? { reviewBy: String(payload.reviewBy) } : {}),
    };
    const bad = validateVerdict(verdict);
    return bad ? invalid(bad) : { ok: true, value: { ids, verdict } };
  },
  summarize: (payload) => {
    const count = Array.isArray(payload?.ids) ? payload.ids.length : 1;
    return `settle ${count} legal matter(s) → ${payload?.status ?? '?'}: "${String(payload?.assessment ?? '').slice(0, 100)}"`;
  },
  execute: async ({ ids, verdict }, { connection }) => {
    const result = await (await matterLedgerFor(connection.walletAddress)).assess(ids, { ...verdict, assessedBy: connection.companion?.neumaId || 'clo' });
    if (!result.settled.length) return { ok: false, reason: result.failed.map((f) => `${f.id}: ${f.error}`).join('; ') };
    const failures = result.failed.length ? `\nFailed (${result.failed.length}): ${result.failed.map((f) => `${f.id}: ${f.error}`).join('; ')}` : '';
    return {
      ok: true,
      detail: `Settled ${result.settled.length} matter(s) → ${verdict.status}:\n${result.settled.map((m) => `[${m.id.slice(0, 10)}] ${m.title}`).join('\n')}${failures}`,
    };
  },
});

export const legalFileIntent = Object.freeze({
  name: 'legal/file',
  policyTool: 'legal.file',
  fieldsForPrompt: '{title, summary, citations, severity?, regimes?}',
  descriptionForPrompt: 'CLO ONLY. File a matter your research found — a new regulation, a ruling, a platform\'s changed terms — that reaches the house. It enters the ledger as new; settle it with legal/assess once read.',
  availableFor,
  validate: async (payload, { connection }) => {
    const seat = await seatRefusal(connection);
    if (seat) return seat;
    const title = typeof payload?.title === 'string' ? payload.title.trim() : '';
    const summary = typeof payload?.summary === 'string' ? payload.summary.trim() : '';
    const citations = Array.isArray(payload?.citations) ? payload.citations.map(String).filter((c) => c.trim()) : [];
    if (!title) return invalid('a matter needs a title');
    if (!summary) return invalid('say what you found and why it reaches the house (summary)');
    if (!citations.length) return invalid('cite where you found it (citations: [...])');
    if (payload?.severity !== undefined && !MATTER_SEVERITIES.includes(payload.severity)) {
      return invalid(`severity must be one of ${MATTER_SEVERITIES.join(' | ')}`);
    }
    return {
      ok: true,
      value: {
        title: title.slice(0, 200), summary, citations,
        severity: payload?.severity || 'unknown',
        regimes: Array.isArray(payload?.regimes) ? payload.regimes.map(String) : [],
      },
    };
  },
  summarize: (payload) => `file a legal matter: "${String(payload?.title ?? '').slice(0, 120)}"`,
  execute: async (value, { connection }) => {
    const filedBy = connection.companion?.neumaId || 'clo';
    const { added, seen } = await (await matterLedgerFor(connection.walletAddress)).ingest([{
      area: 'regulation', source: 'research', repo: null,
      externalId: `research:${value.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 120)}`,
      title: value.title, summary: value.summary, severity: value.severity,
      regimes: value.regimes, citations: value.citations, filedBy,
    }]);
    return added.length
      ? { ok: true, detail: `Filed [${added[0].id.slice(0, 10)}] ${added[0].title}` }
      : { ok: true, detail: `Already on the ledger (${seen} known) — a matter with this title stands; read it with legal_matters_list.` };
  },
});

export const legalIntents = Object.freeze([legalScanIntent, legalAssessIntent, legalFileIntent]);
