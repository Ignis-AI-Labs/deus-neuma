// The LEAD ENGINE section of the Mercator's turn briefing: how the engine is
// worked, each segment with its pool, the strongest prospects not yet on the
// ledger, and the ledger's upkeep — what is due today, most urgent first. The
// Mercator office briefing (revenue-briefing.js) carries it under its own.
// impure (store reads); the text is pure.

import { readSegments, readProspects, readSuppressions, readSalesFacts, readCandidates, readCampaigns, readContactPeople } from './sales-store.js';
import { campaignBoard, campaignLine } from './campaign-shape.js';
import { candidateLine } from './lead-sources.js';
import { SALES_DISCLOSURE } from './sales-facts.js';
import { MATCH_WORDS } from './prospect-shape.js';
import { suppressionMatcher } from './suppress-shape.js';
import { FIRST_WORDS_MAX, SUBJECT_WORDS_MAX } from './first-email.js';
import { upkeepDue, UPKEEP_ASK } from './lead-upkeep.js';
import { spendLine, spendState } from './lead-spend.js';
import { outboxText, readOutbox } from './email-outbox.js';
import { LEAD_KINDS, UNSORTED, kindOf, sourceOf } from '../leads/lead-ledger.js';
import { foldContacts, contactLine } from './contact-book.js';
import { peopleByCompany, TOP_FIRST_RULE } from './top-first.js';

const LIST_CAP = 8;
const HOW = 'How: read the house\'s own site and its competitors\', then file an audience with sales/segment (the operator approves each pitch). For a segment, gather companies in bulk with sales/gather when the LEAD SOURCES switch is on, or search the web for companies that fit; read each one\'s own pages, and file them with sales/prospect, every sign of fit scored with why. From an APPROVED segment, put a weak or strong match on the ledger with sales/lead, using an address you read on a real page. Write with email/send: the mailbox records each email on the lead itself, and a reply marks it replied. Anyone who asks to be left alone goes on sales/suppress at once.';

// The first email's shape, learned from the outbound tools this was studied
// from (lead-engine-plan.md §1.8): short, about them, one small ask.
const FIRST_EMAIL = 'A first email: four short parts. One specific thing you read on their own pages. One line on who you are and what the house does. What that could mean for them, in their terms. One small ask they can answer yes to (may I send a few short written ideas about it?), not a meeting. A plain subject of two or three words. Every claim true of the house today. Sign as yourself, the house\'s AI, under the disclosure line. '
  + `It is checked before it goes: at most ${FIRST_WORDS_MAX} words, a subject of at most ${SUBJECT_WORDS_MAX}, exactly one question, and promise: one line naming exactly what you will send when they say yes. That promise is kept on the lead. When they reply, send exactly that, the same day.`;

// pure — the facts the house may tell a buyer, and where the sheet stands.
const factLines = (facts) => {
  if (!facts?.sheet) return ['FACTS: none filed. File the house\'s facts with sales/facts first; no lead is written to before the operator approves a sheet.'];
  const waiting = facts.review ? (facts.review.verdict === 'returned' ? `RETURNED by the operator: ${facts.review.note}` : 'APPROVED') : 'waiting for the operator\'s approval';
  const head = `FACTS: sheet [${facts.sheet.id}], ${waiting}.${facts.approved && facts.approved.id !== facts.sheet.id ? ' The earlier approved sheet stands until then.' : ''}`;
  const shown = facts.approved ?? null;
  return [
    head,
    ...(shown ? ['What a buyer may be told (every number in an email to a lead must be one stated for its own company):', ...shown.facts.map((f) => `- ${f.company ? `(${f.company}) ` : ''}${f.claim}${f.figure ? ` [${f.figure.value} ${f.figure.unit}]` : ''}`)] : []),
    ...(facts.review?.held?.length ? [`NOT APPROVED by the operator (${facts.review.held.length})${facts.review.note ? `: ${facts.review.note}` : ''}. Fix each one (truer words, a better source) or drop it, and file a new sheet with sales/facts that keeps the approved facts as they are:`, ...facts.review.held.map((f) => `- ${f.company ? `(${f.company}) ` : ''}${f.claim} — source: ${f.source}`)] : []),
    `Every email to a lead carries this line above your name: "${SALES_DISCLOSURE}"`,
  ];
};

// pure — the lead list counted by kind: a buyer is sold to; anyone else is answered, never pitched.
const kindLines = (leads) => [...unsortedLines(leads), ...LEAD_KINDS.map((k) => [k, leads.filter((l) => kindOf(l) === k)]).filter(([, of]) => of.length)
  .map(([k, of]) => `- ${k.toUpperCase()}: ${of.length} (${of.filter((l) => ['cold', 'contacted', 'replied', 'qualified'].includes(l.status)).length} open)${k === 'buyer' ? '' : ' — answered plainly; the sales pitch and its follow-ups are for buyers only'}`)];

// pure — the leads nobody has sorted, each with what is known of it, so the seat can sort them all in one filing.
const unsortedLines = (leads) => {
  const of = leads.filter((l) => kindOf(l) === UNSORTED);
  return of.length ? [`- NOT SORTED YET: ${of.length}. Nobody is a buyer until someone says so. Sort them all now in ONE sales/kind filing (leads: [{id, kind, why}, …]):`,
    ...of.slice(0, 30).map((l) => `  · [${l.id.slice(0, 8)}] ${l.name || l.contact}${l.contact && l.name ? ` (${l.contact})` : ''} — came from ${sourceOf(l)}${l.touches?.at(-1)?.note ? ` — ${String(l.touches.at(-1).note).slice(0, 220)}` : ''}`)] : [];
};

// pure — where the leads came from, most first: the channel each was recorded on (email, x, linkedin, …).
const sourceLine = (leads) => {
  const by = new Map();
  for (const l of leads) by.set(sourceOf(l), (by.get(sourceOf(l)) ?? 0) + 1);
  return `Where they came from: ${[...by].sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c} ${n}`).join(', ')}. Record each new lead on the channel it really came through.`;
};

const mean = (p) => p.fit.reduce((n, s) => n + s.score, 0) / (p.fit.length || 1);

// pure — gathered companies, the most addresses Hunter holds first (the rest in gathered order).
const mostAddressesFirst = (rows) => [...rows].sort((a, b) => (Number(b.hunterEmails?.total) || 0) - (Number(a.hunterEmails?.total) || 0));

// pure — one line per segment: its state and its pool by match.
const segmentLines = (segments, prospects) => segments.filter((s) => s.state !== 'retired').slice(-LIST_CAP).map((s) => {
  const mine = prospects.filter((p) => p.segmentId === s.id);
  const open = mine.filter((p) => p.stage === 'found');
  const by = (m) => open.filter((p) => p.match === m).length;
  const state = s.state === 'draft' ? 'DRAFT, waiting for the operator\'s approval' : s.state.toUpperCase();
  return `- [${s.id}] ${s.name}${s.company ? ` (for ${s.company})` : ''} — ${state} — role: ${s.targetRole} — sends only to ${s.countries.join(', ')} — pool ${open.length} (strong ${by(3)}, weak ${by(2)}, none ${by(1)}), on the ledger ${mine.filter((p) => p.stage === 'promoted').length}`;
});

/**
 * pure — the section text.
 * @param {{segments: object[], prospects: object[], leads: object[], suppressions: object[], now: number}} state
 */
export const leadEngineText = ({ segments, prospects, leads, suppressions, facts = null, candidates = [], campaigns = [], spend = null, lookups = [], outbox = null, now }) => {
  const board = campaignBoard({ campaigns: campaigns.filter((c) => c.state === 'open'), segments, candidates, prospects, leads });
  const waiting = candidates.filter((c) => c.state === 'waiting');
  const approved = new Set(segments.filter((s) => s.state === 'approved').map((s) => s.id));
  const ready = prospects
    .filter((p) => p.stage === 'found' && p.match >= 2 && approved.has(p.segmentId))
    .sort((a, b) => b.match - a.match || mean(b) - mean(a))
    .slice(0, LIST_CAP);
  const due = upkeepDue({ leads, now, suppressed: suppressionMatcher(suppressions).email, held: peopleByCompany(lookups) });
  return [
    '## LEAD ENGINE — find them, score them, keep the ledger clean',
    HOW,
    TOP_FIRST_RULE,
    FIRST_EMAIL,
    ...factLines(facts),
    ...(spend ? [spendLine(spend)] : []),
    ...(outbox ? [outboxText(outbox)] : []),
    ...(board.campaigns.length ? ['Your campaigns (sales/campaign opens, edits, archives or deletes one; file each audience under the one it serves, campaign: its id; campaigns/link ties one to a marketing campaign):', ...board.campaigns.map(campaignLine), ...(board.loose.length ? [`Audiences under no campaign: ${board.loose.map((s) => s.name).join('; ')}`] : [])] : ['No campaign is open: open one with sales/campaign (name, company, goal) before filing audiences, so each push is counted on its own.']),
    ...(segments.length ? ['Segments:', ...segmentLines(segments, prospects)] : ['No segments yet: start by filing the first one.']),
    ...(waiting.length ? [`Candidates gathered, waiting for your score (${waiting.length}; the ${Math.min(LIST_CAP, waiting.length)} with the most addresses at Hunter below — sales/candidates shows and filters them ALL; sales/prospect for the ones that fit, sales/contacts for their people):`, ...mostAddressesFirst(waiting).slice(0, LIST_CAP).map((c) => `- [${c.id}] ${candidateLine(c)}`)] : []),
    ...(ready.length ? ['Ready for the ledger (approved segment, not yet contacted):', ...ready.map((p) => `- [${p.id}] ${p.name} (${p.domain}) — ${MATCH_WORDS[p.match]}, ${p.people.length} person(s) read`)] : []),
    ...(due.length
      ? [`Upkeep due (${due.length}):`, ...due.slice(0, LIST_CAP * 2).map((d) => `- ${d.kind.toUpperCase()} [${d.leadId.slice(0, 8)}] ${d.name}${d.kind === 'answer' ? `, waiting ${d.hours} h${d.promised ? `, you promised: "${d.promised}"` : ''}` : (d.days ? `, ${d.days} days` : '')}${d.with ? ` (same as [${d.with.slice(0, 8)}])` : ''} — ${UPKEEP_ASK[d.kind]}${d.next ? `: ${d.next.name}, ${d.next.role} — ${d.next.email} (at ${d.domain}; found on ${d.next.sourceUrl ?? 'the lookup'})` : ''}`)]
      : ['Upkeep: nothing due on the ledger.']),
    ...(kindLines(leads).length ? ['The lead list, by what each lead is to the house (sales/kind re-files one; sales/mail-scan finds people who wrote in and are on no list; sales/inbound files one of them):', ...kindLines(leads), sourceLine(leads)] : ['Nobody is on the lead list. People who wrote to the house on their own are found with sales/mail-scan and filed with sales/inbound.']),
    contactLine(foldContacts({ leads, prospects, lookups, suppressions, segments, candidates })),
    `Do-not-contact list: ${suppressions.length} entr${suppressions.length === 1 ? 'y' : 'ies'}.`,
  ].join('\n');
};

/** The section for the house at `wallet`, with its ledger already read. impure. */
export const leadEngineSection = async (wallet, leads) => {
  const [segments, prospects, suppressions, facts, candidates, campaigns, lookups] = await Promise.all([readSegments(wallet), readProspects(wallet), readSuppressions(wallet), readSalesFacts(wallet), readCandidates(wallet), readCampaigns(wallet), readContactPeople(wallet)]);
  return leadEngineText({ segments, prospects, leads, suppressions, facts, candidates, campaigns, lookups, spend: await spendState(wallet).catch(() => null), outbox: await readOutbox(wallet).catch(() => null), now: Date.now() });
};
