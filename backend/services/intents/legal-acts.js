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
 *
 * THE CITATION LAW (2026-10-31): a reading or a filing cites RECORDS
 * (citation-record.js), its text may quote only what a record quotes and
 * carries no unresolved [verify], and at execute — after the operator's yes,
 * before anything lands — it passes the act review (legal/act-review.js): the
 * platform re-reads every source, sweeps the official feeds for anything newer
 * the filing must answer for, and a second reader judges each passage against
 * its claim. A failure anywhere lands nothing. A hand-off is checked only.
 */
import { matterLedgerFor, validateVerdict, MATTER_SEVERITIES } from '../legal/matter-ledger.js';
import { runLegalWatch } from '../legal/legal-scheduler.js';
import { CITATION_SHAPE, citationRecordsProblem, draftProblem, citationLine } from '../legal/citation-record.js';
import { reviewFiling } from '../legal/act-review.js';
import { sweepProblem } from '../legal/recency-sweep.js';
import { seatRefusal, invalid, availableFor, SWEEP_FIELDS, SWEEP_DUTY, accountOf } from './legal-seat.js';
import { legalOpinionIntent } from './legal-opinion-act.js';

const ASSESS_BATCH_CAP = 50;
const SETTLING = Object.freeze(['no_issue', 'concern', 'resolved', 'needs_counsel', 'needs_operator']);
const HAND_OFFS = Object.freeze(['needs_counsel', 'needs_operator']);


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
  fieldsForPrompt: `{id | ids, status, assessment, citations: [${CITATION_SHAPE}], ${SWEEP_FIELDS}, reviewBy?}`,
  descriptionForPrompt: `CLO ONLY. Settle one matter or a batch (up to ${ASSESS_BATCH_CAP}) with your reading. status: ${SETTLING.join(' | ')}. citations: a record per source the reading rests on — required except for needs_counsel / needs_operator; the platform re-reads every source and a second reader judges each passage against its claim before the reading lands. Quotation marks in the assessment wrap only words a record quotes. ${SWEEP_DUTY} (A hand-off needs no sweep.) reviewBy: YYYY-MM-DD, when the reading must be checked again.`,
  availableFor,
  validate: async (payload, { connection }) => {
    const seat = await seatRefusal(connection);
    if (seat) return seat;
    const ids = Array.isArray(payload?.ids) ? payload.ids.map(String) : (payload?.id ? [String(payload.id)] : []);
    if (ids.length === 0) return invalid('name the matter(s): {id} or {ids}');
    if (ids.length > ASSESS_BATCH_CAP) return invalid(`a batch settles at most ${ASSESS_BATCH_CAP} matters — split it`);
    const records = payload?.citations ?? [];
    const handOff = HAND_OFFS.includes(payload?.status);
    const shape = citationRecordsProblem(records, { required: !handOff })
      || (handOff ? null : sweepProblem(payload?.sweep, String(payload?.assessment ?? '')));
    if (shape) return invalid(shape);
    const verdict = {
      status: payload?.status,
      assessment: typeof payload?.assessment === 'string' ? payload.assessment : '',
      citations: records.map((r) => citationLine(r)),
      ...(payload?.reviewBy ? { reviewBy: String(payload.reviewBy) } : {}),
    };
    const bad = validateVerdict(verdict) || draftProblem(verdict.assessment, records);
    return bad ? invalid(bad) : { ok: true, value: { ids, verdict, records, handOff, sweep: payload?.sweep ?? null, account: accountOf(payload?.recency, verdict.assessment) } };
  },
  summarize: (payload) => {
    const count = Array.isArray(payload?.ids) ? payload.ids.length : 1;
    return `settle ${count} legal matter(s) → ${payload?.status ?? '?'}: "${String(payload?.assessment ?? '').slice(0, 100)}"`;
  },
  execute: async ({ ids, verdict, records, handOff, sweep, account }, { connection }) => {
    const checked = await reviewFiling({ records, sweep, account, handOff, what: 'Nothing was settled' }, { connection });
    if (!checked.ok) return { ok: false, reason: checked.reason };
    const result = await (await matterLedgerFor(connection.walletAddress)).assess(ids, {
      ...verdict, citations: checked.lines, assessedBy: connection.companion?.neumaId || 'clo',
    });
    if (!result.settled.length) return { ok: false, reason: result.failed.map((f) => `${f.id}: ${f.error}`).join('; ') };
    const failures = result.failed.length ? `\nFailed (${result.failed.length}): ${result.failed.map((f) => `${f.id}: ${f.error}`).join('; ')}` : '';
    return {
      ok: true,
      detail: `Settled ${result.settled.length} matter(s) → ${verdict.status}:\n${result.settled.map((m) => `[${m.id.slice(0, 10)}] ${m.title}`).join('\n')}${failures}${checked.note}`,
    };
  },
});

export const legalFileIntent = Object.freeze({
  name: 'legal/file',
  policyTool: 'legal.file',
  fieldsForPrompt: `{title, summary, citations: [${CITATION_SHAPE}], ${SWEEP_FIELDS}, severity?, regimes?}`,
  descriptionForPrompt: `CLO ONLY. File a matter your research found — a new regulation, a ruling, a platform's changed terms — that reaches the house. Cite it with records; the platform re-reads each source and a second reader judges each passage before the matter is filed. ${SWEEP_DUTY} It enters the ledger as new; settle it with legal/assess once read.`,
  availableFor,
  validate: async (payload, { connection }) => {
    const seat = await seatRefusal(connection);
    if (seat) return seat;
    const title = typeof payload?.title === 'string' ? payload.title.trim() : '';
    const summary = typeof payload?.summary === 'string' ? payload.summary.trim() : '';
    const records = payload?.citations ?? [];
    if (!title) return invalid('a matter needs a title');
    if (!summary) return invalid('say what you found and why it reaches the house (summary)');
    const bad = citationRecordsProblem(records, { required: true }) || draftProblem(summary, records)
      || sweepProblem(payload?.sweep, `${title}\n${summary}`);
    if (bad) return invalid(bad);
    if (payload?.severity !== undefined && !MATTER_SEVERITIES.includes(payload.severity)) {
      return invalid(`severity must be one of ${MATTER_SEVERITIES.join(' | ')}`);
    }
    return {
      ok: true,
      value: {
        title: title.slice(0, 200), summary, records, sweep: payload.sweep, account: accountOf(payload?.recency, summary),
        severity: payload?.severity || 'unknown',
        regimes: Array.isArray(payload?.regimes) ? payload.regimes.map(String) : [],
      },
    };
  },
  summarize: (payload) => `file a legal matter: "${String(payload?.title ?? '').slice(0, 120)}"`,
  execute: async (value, { connection }) => {
    const checked = await reviewFiling({ records: value.records, sweep: value.sweep, account: value.account, what: 'Nothing was filed' }, { connection });
    if (!checked.ok) return { ok: false, reason: checked.reason };
    const filedBy = connection.companion?.neumaId || 'clo';
    const { added, seen } = await (await matterLedgerFor(connection.walletAddress)).ingest([{
      area: 'regulation', source: 'research', repo: null,
      externalId: `research:${value.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 120)}`,
      title: value.title, summary: value.summary, severity: value.severity,
      regimes: value.regimes, citations: checked.lines, filedBy,
    }]);
    return added.length
      ? { ok: true, detail: `Filed [${added[0].id.slice(0, 10)}] ${added[0].title}${checked.note}` }
      : { ok: true, detail: `Already on the ledger (${seen} known) — a matter with this title stands; read it with legal_matters_list.` };
  },
});

export const legalIntents = Object.freeze([legalScanIntent, legalAssessIntent, legalFileIntent, legalOpinionIntent]);
