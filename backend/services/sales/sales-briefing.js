// The LEAD ENGINE section of the Mercator's turn briefing: how the engine is
// worked, each segment with its pool, the strongest prospects not yet on the
// ledger, and the ledger's upkeep — what is due today, most urgent first. The
// Mercator office briefing (revenue-briefing.js) carries it under its own.
// impure (store reads); the text is pure.

import { readSegments, readProspects, readSuppressions, readSalesFacts } from './sales-store.js';
import { SALES_DISCLOSURE } from './sales-facts.js';
import { MATCH_WORDS } from './prospect-shape.js';
import { suppressionMatcher } from './suppress-shape.js';
import { upkeepDue, UPKEEP_ASK } from './lead-upkeep.js';

const LIST_CAP = 8;
const HOW = 'How: read the house\'s own site and its competitors\', then file an audience with sales/segment (the operator approves each pitch). For a segment, search the web for companies that fit, read each one\'s own pages, and file them with sales/prospect, every sign of fit scored with why. From an APPROVED segment, put a weak or strong match on the ledger with sales/lead, using an address you read on a real page. Write with email/send: the mailbox records each email on the lead itself, and a reply marks it replied. Anyone who asks to be left alone goes on sales/suppress at once.';

// The first email's shape, learned from the outbound tools this was studied
// from (lead-engine-plan.md §1.8): short, about them, one small ask.
const FIRST_EMAIL = 'A first email: four short parts. One specific thing you read on their own pages. One line on who you are and what the house does. What that could mean for them, in their terms. One small ask they can answer yes to (may I send a few short written ideas about it?), not a meeting. A plain subject of two or three words. Every claim true of the house today. Sign as yourself, the house\'s AI, under the disclosure line.';

// pure — the facts the house may tell a buyer, and where the sheet stands.
const factLines = (facts) => {
  if (!facts?.sheet) return ['FACTS: none filed. File the house\'s facts with sales/facts first; no lead is written to before the operator approves a sheet.'];
  const waiting = facts.review ? (facts.review.verdict === 'returned' ? `RETURNED by the operator: ${facts.review.note}` : 'APPROVED') : 'waiting for the operator\'s approval';
  const head = `FACTS: sheet [${facts.sheet.id}], ${waiting}.${facts.approved && facts.approved.id !== facts.sheet.id ? ' The earlier approved sheet stands until then.' : ''}`;
  const shown = facts.approved ?? null;
  return [
    head,
    ...(shown ? ['What a buyer may be told (every number in an email to a lead must be one of these):', ...shown.facts.map((f) => `- ${f.claim}${f.figure ? ` [${f.figure.value} ${f.figure.unit}]` : ''}`)] : []),
    `Every email to a lead carries this line above your name: "${SALES_DISCLOSURE}"`,
  ];
};

const mean = (p) => p.fit.reduce((n, s) => n + s.score, 0) / (p.fit.length || 1);

// pure — one line per segment: its state and its pool by match.
const segmentLines = (segments, prospects) => segments.filter((s) => s.state !== 'retired').slice(-LIST_CAP).map((s) => {
  const mine = prospects.filter((p) => p.segmentId === s.id);
  const open = mine.filter((p) => p.stage === 'found');
  const by = (m) => open.filter((p) => p.match === m).length;
  const state = s.state === 'draft' ? 'DRAFT, waiting for the operator\'s approval' : s.state.toUpperCase();
  return `- [${s.id}] ${s.name} — ${state} — role: ${s.targetRole} — pool ${open.length} (strong ${by(3)}, weak ${by(2)}, none ${by(1)}), on the ledger ${mine.filter((p) => p.stage === 'promoted').length}`;
});

/**
 * pure — the section text.
 * @param {{segments: object[], prospects: object[], leads: object[], suppressions: object[], now: number}} state
 */
export const leadEngineText = ({ segments, prospects, leads, suppressions, facts = null, now }) => {
  const approved = new Set(segments.filter((s) => s.state === 'approved').map((s) => s.id));
  const ready = prospects
    .filter((p) => p.stage === 'found' && p.match >= 2 && approved.has(p.segmentId))
    .sort((a, b) => b.match - a.match || mean(b) - mean(a))
    .slice(0, LIST_CAP);
  const due = upkeepDue({ leads, now, suppressed: suppressionMatcher(suppressions).email });
  return [
    '## LEAD ENGINE — find them, score them, keep the ledger clean',
    HOW,
    FIRST_EMAIL,
    ...factLines(facts),
    ...(segments.length ? ['Segments:', ...segmentLines(segments, prospects)] : ['No segments yet: start by filing the first one.']),
    ...(ready.length ? ['Ready for the ledger (approved segment, not yet contacted):', ...ready.map((p) => `- [${p.id}] ${p.name} (${p.domain}) — ${MATCH_WORDS[p.match]}, ${p.people.length} person(s) read`)] : []),
    ...(due.length
      ? [`Upkeep due (${due.length}):`, ...due.slice(0, LIST_CAP * 2).map((d) => `- ${d.kind.toUpperCase()} [${d.leadId.slice(0, 8)}] ${d.name}${d.days ? `, ${d.days} days` : ''}${d.with ? ` (same as [${d.with.slice(0, 8)}])` : ''} — ${UPKEEP_ASK[d.kind]}`)]
      : ['Upkeep: nothing due on the ledger.']),
    `Do-not-contact list: ${suppressions.length} entr${suppressions.length === 1 ? 'y' : 'ies'}.`,
  ].join('\n');
};

/** The section for the house at `wallet`, with its ledger already read. impure. */
export const leadEngineSection = async (wallet, leads) => {
  const [segments, prospects, suppressions, facts] = await Promise.all([readSegments(wallet), readProspects(wallet), readSuppressions(wallet), readSalesFacts(wallet)]);
  return leadEngineText({ segments, prospects, leads, suppressions, facts, now: Date.now() });
};
