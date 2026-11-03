// THE COMPANY LINE briefing — what every seated being of a house founding a
// company reads at the top of its turn: where each company's founding line
// stands, and — first — the moves that wait on THIS being, as master or as
// inspector. A house with no company on its line gives '' (the section is
// absent and the prompt byte-identical — the empty-string law), and so does a
// lane outside its operator's own house.
// impure (store reads); the text itself is pure.

import { houseSeatFor } from '../house-titles.js';
import { createLogger } from '../logger.js';
import { listCompanies, readLine } from './company-store.js';
import { seatHolders } from './stage-holders.js';
import { lineView } from './company-view.js';
import { readHands } from './hands-store.js';
import { FOUNDING_LINE } from './line-stages.js';
import { readRaise } from '../raise/raise-store.js';
import { raiseForBeings, raised } from '../raise/raise-shape.js';

// The worksheet shape each stage hands on, as its master reads it.
const SHEETS = Object.freeze(Object.fromEntries(FOUNDING_LINE.filter((s) => s.sheet).map((s) => [s.id, s.sheet])));

const log = createLogger('Company.Briefing');

const statusWords = (v) => (v.status === 'inspecting'
  ? `under inspection, ${v.step + 1} of ${v.handed.inspections.length}`
  : v.status === 'returned' ? 'returned to its master' : 'with its master');

const upWords = (up, laneId) => {
  if (up.kind === 'unheld') return `nobody holds the ${up.seat} seat`;
  if (up.holder === 'operator') return 'the operator';
  return `${up.as ?? up.seat} — ${up.holder === laneId ? 'YOU' : up.holder}`;
};

const moveLine = (v) => {
  const stage = v.stages.find((s) => s.id === v.stage);
  if (v.up.kind === 'inspector') {
    const work = SHEETS[stage.id] ? `the worksheet: ${v.handed.artifact} on the house ground — open it and check every source` : `the work: ${v.handed.artifact}`;
    return `- ${v.name} [${v.id}] ${stage.name}: inspect it as ${v.up.as} — ${work}${v.handed.note ? ` ("${v.handed.note}")` : ''}. Answer with company/inspect {company, stage, verdict, flaw?}.`;
  }
  const how = SHEETS[stage.id]
    ? `Hand it on with company/hand-on {company, stage, worksheet, note?} — worksheet: ${SHEETS[stage.id]}. A source is an https link, a repos/ path on the house ground, or "interview: who, when".`
    : 'Hand it on with company/hand-on {company, stage, artifact, note?}.';
  return `- ${v.name} [${v.id}] ${stage.name}: yours to master — ${stage.handsOn}.${v.flaw ? ` It came back: "${v.flaw}".` : ''} ${how}`;
};

// What the operator's hands answered for this being, newest first — the fact
// it asked for, or why it will not be done — and how many of its asks still wait.
const handsLines = (views, laneId) => {
  const mine = views.flatMap((v) => v.hands.filter((i) => i.raisedBy === laneId).map((i) => ({ ...i, company: v })));
  const answered = mine.filter((i) => i.status !== 'open').slice(-5).reverse();
  const waiting = mine.filter((i) => i.status === 'open').length;
  return [
    ...(answered.length ? ['THE OPERATOR ANSWERED YOUR HANDS ASKS:', ...answered.map((i) => `- ${i.company.name} [${i.id}] "${i.what}": ${i.status === 'done' ? `done${i.text ? ` — ${i.text}` : ''}` : `declined — ${i.text}`}`)] : []),
    ...(waiting ? [`${waiting} of your HANDS asks still wait on the operator.`] : []),
  ];
};

// The raise room, one line per company raising: where the mandate and the facts sheet stand.
const raiseLines = (views) => views.filter((v) => v.raise && v.raise.draft).map((v) => {
  const r = v.raise;
  const mandate = r.status === 'none' ? 'drafted, waiting for the operator\'s signature' : `${r.status}${r.draft.id !== r.mandate?.id ? ' (a newer draft waits for signature)' : ''}`;
  const facts = !r.sheet ? 'no facts sheet yet (raise/facts, the Numerarius)' : !r.review ? 'facts sheet waiting for counsel' : r.review.verdict === 'approved' ? 'facts sheet approved by counsel' : `facts sheet returned by counsel: "${r.review.note}"`;
  const tally = ['listed', 'cleared', 'contacted', 'interested', 'terms', 'sound', 'closed', 'declined', 'refused'].map((s) => [s, r.investors.filter((i) => i.status === s).length]).filter(([, n]) => n);
  const money = r.mandate ? ` Raised ${raised(r).closed} of ${r.mandate.amount} ${r.mandate.currency} (${raised(r).promised} more in terms).` : '';
  const investors = tally.length ? ` Investors: ${tally.map(([s, n]) => `${n} ${s}`).join(', ')}.${money}` : '';
  return `- ${v.name} [${v.id}] RAISE: mandate ${mandate}; ${facts}.${investors} No investor is asked until the mandate is signed and counsel has approved the facts.`;
});

/**
 * The briefing text for one lane over its house's live lines. pure.
 * '' when no line is being founded and no answer of the operator's waits to be read.
 * @param {ReadonlyArray<ReturnType<typeof lineView>>} views - every company of the house
 * @param {string} laneId
 * @returns {string}
 */
const briefingText = (views, laneId) => {
  const live = views.filter((v) => v.status !== 'standing');
  const hands = handsLines(views, laneId);
  const raising = raiseLines(views);
  if (!live.length && !hands.length && !raising.length) return '';
  const mine = live.filter((v) => v.up.holder === laneId);
  return [
    '## COMPANY LINE — one stage, one master',
    ...(live.length ? (mine.length ? ['YOUR MOVE:', ...mine.map(moveLine)] : ['Nothing on the line waits on you right now.']) : []),
    ...hands,
    ...(raising.length ? ['THE RAISE ROOM:', ...raising] : []),
    ...(live.length ? ['Where each company stands:', ...live.map((v) => `- ${v.name} [${v.id}] — round ${v.round}, at ${v.stages.find((s) => s.id === v.stage).name} (${statusWords(v)}); up: ${upWords(v.up, laneId)}`)] : []),
    'The law: do your own stage\'s work and only that; the next master inspects it; never inspect your own work. Pass anything else to its seat by house post.',
  ].join('\n');
};

/**
 * @param {{companion?: {neumaId?: string}, walletAddress?: string}} connection
 * @returns {Promise<string>}
 */
export const companyLineBriefing = async (connection) => {
  const laneId = connection.companion?.neumaId;
  const wallet = connection.walletAddress;
  if (!laneId || !wallet) return '';
  try {
    const { companies } = await listCompanies(wallet);
    if (!companies.length || !(await houseSeatFor(wallet, laneId))) return '';
    const holders = await seatHolders(wallet);
    const views = await Promise.all(companies.map(async (c) => {
      const line = await readLine(wallet, c.id);
      const view = lineView(c, line, holders, (await readHands(wallet, c.id)).items);
      return line.status === 'standing' ? { ...view, raise: raiseForBeings(await readRaise(wallet, c.id)) } : view;
    }));
    return briefingText(views, laneId);
  } catch (err) {
    log.warn('Company line briefing unavailable — the turn stands without it', { laneId, err: err.message });
    return '';
  }
};
