/**
 * legal/opinion — a written legal answer the seated CLO delivers to the
 * operator, landing only once the platform has re-read every source it cites.
 *
 * Why an act and not a chat reply (2026-10-31): the answer that taught the
 * citation law (citation-record.js) was given in conversation, so nothing
 * stood between its invented quotation and the operator. An opinion is the
 * office's deliverable: its text may quote only what a citation record
 * quotes and may carry no unresolved [verify]. It passes the act review
 * (legal/act-review.js: the platform's re-read, the app's recency sweep, the
 * second reader) and is written into the office's opinions drawer with all
 * three beside it — the reader sees what was confirmed, what the app found
 * newer and what the office made of it, and what the second reader judged,
 * row by row.
 */
import fs from 'fs/promises';
import path from 'path';
import neumaWorkspace from '../../../core/workspace/neuma-workspace.js';
import { CITATION_SHAPE, citationRecordsProblem, draftProblem } from '../legal/citation-record.js';
import { NOT_CHECKED } from '../legal/cite-check.js';
import { reviewFiling } from '../legal/act-review.js';
import { sweepProblem } from '../legal/recency-sweep.js';
import { seatRefusal, invalid, availableFor, SWEEP_FIELDS, SWEEP_DUTY, accountOf } from './legal-seat.js';

const TITLE_MAX = 200;
const QUESTION_MAX = 4000;
const ANSWER_MAX = 60_000;
const RECENCY_MAX = 20;

// pure — a markdown table cell.
const cell = (s) => String(s ?? '').replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim() || '—';

/** The platform's check and the second reading as the opinion's table. Pure. */
const checkTable = (check, reading) => [
  '| # | Claim | Authority · pin cite | Heading on the source | Quote | Source | Platform | Second reader |',
  '| --- | --- | --- | --- | --- | --- | --- | --- |',
  ...check.rows.map((r) => {
    const read = reading?.readings.get(r.n);
    return `| ${r.n} | ${cell(r.record.claim)} | ${cell(`${r.record.authority}, ${r.record.pinCite}`)} | ${cell(r.record.heading)} | ${r.record.quote ? cell(`"${r.record.quote}"`) : 'paraphrase'} | ${cell(r.record.sourceUrl)} | ${r.verdict === 'verified' ? 'confirmed' : cell(r.note)} | ${read ? cell(`${read.verdict.replace(/_/g, ' ')}: ${read.why}`) : '—'} |`;
  }),
].join('\n');

/** What the app's sweep found, and the office's own account of it. Pure. */
const sweepSection = (sweep, recency) => [
  `The app searched the official feeds for ${sweep.terms.map((t) => `"${t}"`).join(', ')} from ${sweep.since} to ${sweep.until} (${sweep.jurisdictions.join(', ')}): ${sweep.items.length} action(s) found.`,
  '',
  ...(sweep.items.length ? sweep.items.map((i) => `- ${i.owed ? '' : '(listed only) '}[${i.ref.length > 40 ? i.source : i.ref}] ${i.date ?? 'undated'} — ${i.title}${i.link ? ` <${i.link}>` : ''}`) : ['- nothing in the window']),
  '',
  ...sweep.feeds.filter((f) => !f.ok || (f.reach && f.reach > sweep.since)).map((f) => `- ${f.name}: ${f.ok ? `reaches back only to ${f.reach}` : 'could not be read'}`),
  ...(sweep.jurisdictions.includes('EU') ? ['- EUR-Lex and the Official Journal refuse automated reads: the app could not search them.'] : []),
  '',
  'What the office made of it:',
  ...(recency.length ? recency.map((line) => `- ${line}`) : ['- (nothing owed an answer)']),
].join('\n');

/** The opinion as it lands in the drawer. Pure. */
const opinionText = ({ title, question, answer, recency, review, laneId }) => [
  `# Opinion — ${title}`,
  '',
  `- delivered: ${review.check.checkedAt} by ${laneId} (CLO)`,
  `- law as of: ${review.check.checkedAt.slice(0, 10)} · ${review.check.rows.length} citation(s), every source re-read by the platform${review.reading ? `, every passage second-read by ${review.reading.reader}` : ''}`,
  '- this is the house\'s legal watch, not counsel: anything the house will stake money or a filing on goes to a lawyer',
  '',
  '## The question', '', question.trim(), '',
  '## The answer', '', answer.trim(), '',
  `## Citation check — run by the platform at ${review.check.checkedAt}, not by the office`, '',
  checkTable(review.check, review.reading), '',
  NOT_CHECKED, '',
  '## Anything newer? — the app\'s own sweep', '',
  sweepSection(review.sweep, recency),
  '',
].join('\n');

// pure — a filename from the title and the instant.
const fileNameFor = (title, at) =>
  `${at.slice(0, 16).replace(':', '')}-opinion-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'untitled'}.md`;

export const legalOpinionIntent = Object.freeze({
  name: 'legal/opinion',
  policyTool: 'legal.opinion',
  fieldsForPrompt: `{title, question, answer, citations: [${CITATION_SHAPE}], ${SWEEP_FIELDS}}`,
  descriptionForPrompt: `CLO ONLY. Deliver a written legal answer to the operator. Before it lands the platform re-reads every cited source, a second reader judges each passage against its claim, and the app sweeps the official feeds; it delivers nothing that fails. The answer quotes only words a citation record quotes (language you propose goes in a \`\`\` block) and carries no [verify]. ${SWEEP_DUTY} It lands in legal/opinions/ with all three beside it.`,
  availableFor,
  validate: async (payload, { connection }) => {
    const seat = await seatRefusal(connection);
    if (seat) return seat;
    const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
    const title = text(payload?.title, TITLE_MAX);
    const question = text(payload?.question, QUESTION_MAX);
    const answer = typeof payload?.answer === 'string' ? payload.answer.trim() : '';
    if (!title) return invalid('an opinion needs a title');
    if (!question) return invalid('say the question the opinion answers (question)');
    if (!answer) return invalid('an opinion needs its answer');
    if (answer.length > ANSWER_MAX) return invalid(`an answer runs at most ${ANSWER_MAX} characters — split the opinion`);
    const recency = Array.isArray(payload?.recency) ? payload.recency.map((l) => String(l ?? '').trim()).filter(Boolean).slice(0, RECENCY_MAX) : [];
    const records = payload?.citations ?? [];
    const bad = citationRecordsProblem(records, { required: true }) || draftProblem(answer, records)
      || sweepProblem(payload?.sweep, `${title}\n${question}\n${answer}`);
    return bad ? invalid(bad) : { ok: true, value: { title, question, answer, records, recency, sweep: payload.sweep } };
  },
  summarize: (payload) => `deliver a legal opinion: "${String(payload?.title ?? '').slice(0, 120)}" (${Array.isArray(payload?.citations) ? payload.citations.length : 0} citations — re-read, second-read and swept for anything newer before it lands)`,
  execute: async (value, { connection }) => {
    const review = await reviewFiling({
      records: value.records, sweep: value.sweep, account: accountOf(value.recency, value.answer), what: 'The opinion was not delivered',
    }, { connection });
    if (!review.ok) return { ok: false, reason: review.reason };
    const laneId = connection.companion?.neumaId;
    const dir = path.join(neumaWorkspace.pathFor(laneId), 'legal', 'opinions');
    await fs.mkdir(dir, { recursive: true });
    const name = fileNameFor(value.title, review.check.checkedAt);
    await fs.writeFile(path.join(dir, name), opinionText({ ...value, review, laneId }), { encoding: 'utf8', flag: 'wx' });
    return {
      ok: true,
      detail: `Delivered: legal/opinions/${name}.${review.note} Tell the operator where it is; the check, the sweep and the second reading ride with it.`,
    };
  },
});
