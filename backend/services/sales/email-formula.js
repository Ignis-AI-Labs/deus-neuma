// THE EMAIL FORMULA — one equation every first email to a lead is built from, by the main seat and every clone alike
// (Design note, 2026-11-19: […]; locked the same day: […]).
//
// THREE GATES before a word is written (sales-email-acts.js, sales/draft-email): a CONFIRMED address; a RESEARCH CARD
// on the person and the company — who, what, when, where, why, with its sources — kept for good, so a later campaign
// reads it instead of asking the outside services again; and FIT, yes or no, for this campaign.
// EACH CAMPAIGN'S VARIABLES (the email plan, the operator's to approve): what the campaign is for, what the people it
// writes to need from us, what we offer, the asks it may make (each naming exactly what is sent on a yes), and the
// sign-off.
// THE EMAIL: Subject ([…], the platform's) · "Hi {first name}," · HOOK (what they are doing, from the card) · WHY YOU (why this campaign
// concerns them, now) · OFFER (what we have for their need, in their terms, with a proof) · ASK (one concrete next
// step from the campaign's asks) · the campaign's sign-off. The platform assembles it; the checks below hold it. PURE.

import { saidTwice } from './said-twice.js';

export const OBJECTIVES = Object.freeze({
  funding: 'raising money: investors whose thesis we fit',
  customers: 'users or customers for a product or a service',
  partner: 'a partner, an integration or a distributor',
  other: 'anything else the campaign names',
});
export const BODY_WORDS_MAX = 120;
export const SUBJECT_WORDS = Object.freeze([2, 6]);
export const RESEARCH_FRESH_DAYS = 120;
export const ASKS_MAX = 3;
// What reads as a template, or as nothing at all: never in a first email.
export const BANNED = Object.freeze([
  'a few ideas', 'few short written ideas', 'some ideas', 'hope this finds you', 'hope you are well', 'hope you\'re well', 'hope all is well',
  'i came across', 'came across your', 'quick question', 'just checking in', 'touch base', 'circle back', 'reaching out because',
  'i wanted to reach out', 'pick your brain', 'game-changer', 'game changer', 'revolutionary', 'synergy', 'cutting-edge', 'cutting edge',
  'best-in-class', 'world-class', 'no-brainer', 'disrupt', 'to whom it may concern', 'dear sir', 'dear madam',
]);

// NOTHING IS EVER CUT TO FIT (Design note, 2026-11-20, on a plan whose offer ended […]: […]). A field over its length used to be sliced without a word, mid-sentence, and the
// cut text was what got approved and written from. Now a field is kept whole or refused with its length said.
const text = (v) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');
/** The longest each field may be, in characters. A plan's offer is the whole of what we offer, so it has room. */
export const FIELD_MAX = Object.freeze({ need: 600, offer: 1500, ask: 300, delivers: 300, signature: 600, subject: 200, hook: 600, why: 400, emailOffer: 800 });
const CARD_MAX = Object.freeze({ email: 200, name: 80, role: 160, company: 160, what: 600, now: 700, when: 60, where: 160, need: 600 });
const tooLong = (name, value, max) => (value.length > max ? [`${name}: ${value.length} characters, and the most it may be is ${max} — shorten it; nothing is cut for you`] : []);
const words = (s) => String(s ?? '').trim().split(/\s+/).filter(Boolean);
const https = (u) => /^https:\/\/[^\s/]+\.[^\s]+$/i.test(String(u ?? ''));
const STOP = new Set(['about', 'after', 'their', 'there', 'these', 'those', 'which', 'while', 'where', 'would', 'could', 'should', 'other', 'every', 'being', 'since', 'still', 'just', 'with', 'from', 'that', 'this', 'what', 'have', 'into', 'over', 'your', 'they', 'them', 'were', 'been', 'more', 'most', 'some', 'than', 'very', 'also', 'only']);
/** pure — the words that carry meaning (five letters or more, not filler), lowercased. */
const keyWords = (s) => new Set((String(s ?? '').toLowerCase().match(/[a-z0-9][a-z0-9'-]{3,}/g) ?? []).filter((w) => w.length >= 5 && !STOP.has(w)));
const shares = (a, b) => [...keyWords(a)].some((w) => keyWords(b).has(w));

/**
 * pure — a campaign's email variables, or a thrown reason naming every missing one at once.
 * @param {{objective, need, offer, asks: Array<{ask, delivers}>, signature}} f
 */
export const makeEmailPlan = (f) => {
  const given = Array.isArray(f?.asks) ? f.asks : [];
  const asks = given.slice(0, ASKS_MAX).map((a) => ({ ask: text(a?.ask), delivers: text(a?.delivers) }));
  const plan = { objective: text(f?.objective).toLowerCase(), need: text(f?.need), offer: text(f?.offer), asks, signature: String(f?.signature ?? '').trim() };
  const problems = [
    ...tooLong('need', plan.need, FIELD_MAX.need), ...tooLong('offer', plan.offer, FIELD_MAX.offer), ...tooLong('signature', plan.signature, FIELD_MAX.signature),
    ...asks.flatMap((a, i) => [...tooLong(`asks[${i}].ask`, a.ask, FIELD_MAX.ask), ...tooLong(`asks[${i}].delivers`, a.delivers, FIELD_MAX.delivers)]),
    ...(given.length > ASKS_MAX ? [`asks: ${given.length} were given and a campaign has at most ${ASKS_MAX} — choose which ${ASKS_MAX}`] : []),
    ...(!OBJECTIVES[plan.objective] ? [`objective: one of ${Object.keys(OBJECTIVES).join(', ')}`] : []),
    ...(plan.need.length < 15 ? ['need: what the people this campaign writes to need that we have, in one sentence'] : []),
    ...(plan.offer.length < 20 ? ['offer: what we offer them, in their terms, in one or two sentences'] : []),
    ...(!asks.length ? [`asks: 1 to ${ASKS_MAX} concrete next steps, each {ask, delivers}`] : []),
    ...asks.flatMap((a, i) => [
      ...(!a.ask.endsWith('?') ? [`asks[${i}].ask: one question they can say yes to ("Shall I send the deck and the round's terms?")`] : []),
      ...(a.delivers.length < 5 ? [`asks[${i}].delivers: exactly what is sent or done on a yes ("the deck and the round's terms")`] : []),
      ...(BANNED.some((b) => a.ask.toLowerCase().includes(b)) ? [`asks[${i}].ask: name the actual thing — never "${BANNED.find((b) => a.ask.toLowerCase().includes(b))}"`] : []),
    ]),
    ...(plan.signature.length < 3 || plan.signature.includes('?') ? ['signature: the sign-off every email of this campaign ends with (name, role, company), no question'] : []),
  ];
  if (problems.length) throw new Error(problems.join('; '));
  return Object.freeze(plan);
};

/**
 * pure — a research card (who, what, when, where, why), or a thrown reason naming every missing part at once.
 * @param {{email, name, role, company, what, now, when?, where?, need, sources: string[]}} f
 */
export const makeResearch = (f) => {
  const card = {
    email: text(f?.email).toLowerCase(), name: text(f?.name), role: text(f?.role), company: text(f?.company),
    what: text(f?.what), now: text(f?.now), when: text(f?.when), where: text(f?.where), need: text(f?.need),
    sources: [...new Set((Array.isArray(f?.sources) ? f.sources : []).map((s) => text(s)))],
  };
  const nameWords = words(card.name).length;
  const problems = [
    // Kept whole or refused, never cut (FIELD_MAX above says why).
    ...Object.entries(CARD_MAX).flatMap(([field, max]) => tooLong(field, card[field], max)),
    ...(card.sources.length > 6 ? [`sources: ${card.sources.length} pages, and a card holds at most 6 — keep the ones each part was read on`] : []),
    ...card.sources.flatMap((src, i) => tooLong(`sources[${i}]`, src, 500)),
    ...(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(card.email) ? ['email: the address this card is about'] : []),
    ...(nameWords < 2 || nameWords > 5 ? ['name: WHO — the person\'s full name, as their own pages write it'] : []),
    ...(card.role.length < 2 ? ['role: WHO — what they are at the company'] : []),
    ...(card.company.length < 2 ? ['company: the company\'s name'] : []),
    ...(card.what.length < 15 ? ['what: WHAT the company does, in one sentence'] : []),
    ...(card.now.length < 25 ? ['now: WHAT they are doing NOW — one specific, recent thing (a launch, a raise, a deal, a hire, a portfolio move), as their pages say it'] : []),
    ...(card.need.length < 15 ? ['need: WHY we write — what they likely need, read from the above, in one sentence'] : []),
    ...(!card.sources.length || !card.sources.every(https) ? ['sources: the https pages each part was read on (their own site first)'] : []),
  ];
  if (problems.length) throw new Error(problems.join('; '));
  return Object.freeze(card);
};

/** pure — is a card fresh enough to write from. */
export const researchFresh = (card, now = Date.now()) => Boolean(card?.at) && now - Date.parse(card.at) <= RESEARCH_FRESH_DAYS * 86_400_000;

/** pure — the first name an email greets. */
// A mailbox nobody in particular reads is greeted as the team it is ([…]), never by the
// company's first word as if it were a person ("Hi Mint,").
const firstName = (card) => (/\bteam$/i.test(String(card?.name ?? '').trim()) ? String(card.name).trim() : words(card?.name)[0] ?? '');

// THE SUBJECT (Design note, 2026-11-20: […]).
// The platform writes it: the company's name as its record has it, then the reason the seat gives, in title case —
// […]. Articles, and/but/or, and prepositions of three letters or fewer stay small
// mid-line; a word that already carries its own capitals (AI, DeFi, iOS) is kept as written.
const MINOR = new Set(['a', 'an', 'the', 'and', 'but', 'or', 'nor', 'for', 'so', 'yet', 'as', 'at', 'by', 'in', 'of', 'on', 'to', 'up', 'via', 'per', 'off', 'out', 'vs']);
const RAISE = /\b(rais(e|es|ed|ing)|round|seed|pre-seed|series [a-d]|safe|funding|fundraise|invest(ment|ing|ors?)?|capital)\b/i;
const ownCapitals = (w) => /\p{Lu}/u.test(w.slice(1)) || !/\p{Ll}/u.test(w);
const capital = (w) => w.split('-').map((part) => (ownCapitals(part) ? part : part.replace(/^(\P{L}*)(\p{Ll})/u, (_, pre, c) => pre + c.toUpperCase()))).join('-');
/** pure — title case: each major word capitalized; the first word, the last, and the first after a colon always. */
export const titleCase = (s) => {
  const ws = words(s);
  return ws.map((w, i) => {
    const bare = w.toLowerCase().replace(/[^\p{L}]/gu, '');
    const edge = i === 0 || i === ws.length - 1 || /[:—–]$/.test(ws[i - 1]);
    return !edge && MINOR.has(bare) && !/\p{Lu}.*\p{Lu}/u.test(w) ? w.toLowerCase() : capital(w);
  }).join(' ');
};
/** pure — the reason a subject gives, without the company's name if the seat put it in front itself. */
export const subjectReason = (company, subject) => {
  const name = String(company ?? '').trim();
  const s = text(subject);
  return name && s.toLowerCase().startsWith(name.toLowerCase()) ? s.slice(name.length).replace(/^\s*[:|—–-]?\s*/, '') : s;
};
/** pure — the subject as it leaves: […]. */
export const subjectLine = (company, subject) => `${String(company).trim()}: ${titleCase(subjectReason(company, subject))}`;

/**
 * pure — the email, assembled in the formula's order.
 * @returns {string}
 */
export const assembleEmail = ({ card, plan, hook, why, offer, ask }) => [
  `Hi ${firstName(card)},`, `${text(hook)} ${text(why)}`, text(offer), text(ask), plan.signature,
].join('\n\n');

/** pure — the email's own words, without the greeting and the sign-off. */
const bodyOf = ({ hook, why, offer, ask }) => [hook, why, offer, ask].map((s) => text(s)).join(' ');
const opening = (s) => words(String(s ?? '').toLowerCase()).slice(0, 6).join(' ');

/**
 * pure — what must change before a formula email may be staged (empty: it may).
 * @param {{subject, hook, why, offer, ask, askIndex: number}} fields
 * @param {{card: object, plan: object, company?: string, others?: Array<{hook: string, offer: string, to: string[]}>}} ctx
 *   company: the name the subject opens with; others: the campaign's other emails, staged or sent
 * @returns {string[]}
 */
export const checkFormula = (fields, { card, plan, company = 'the company', others = [] }) => {
  const f = { subject: text(fields.subject), hook: text(fields.hook), why: text(fields.why), offer: text(fields.offer), ask: text(fields.ask) };
  const chosen = plan.asks[fields.askIndex] ?? null;
  const all = `${f.subject} ${bodyOf(f)}`.toLowerCase();
  const banned = BANNED.filter((b) => all.includes(b));
  const reason = subjectReason(company, f.subject);
  const subjectWords = words(reason).length;
  const funding = plan.objective === 'funding';
  const bodyWords = words(bodyOf(f)).length;
  const twin = others.find((o) => (o.hook && opening(o.hook) === opening(f.hook)) || (o.offer && text(o.offer).toLowerCase() === f.offer.toLowerCase()));
  return [
    ...tooLong('subject', f.subject, FIELD_MAX.subject), ...tooLong('hook', f.hook, FIELD_MAX.hook), ...tooLong('why', f.why, FIELD_MAX.why),
    ...tooLong('offer', f.offer, FIELD_MAX.emailOffer), ...tooLong('ask', f.ask, FIELD_MAX.ask),
    ...(subjectWords < SUBJECT_WORDS[0] || subjectWords > SUBJECT_WORDS[1] ? [`subject: why we are writing, in ${SUBJECT_WORDS[0]} to ${SUBJECT_WORDS[1]} words — "${company}:" goes in front of it for you, with a capital on each major word ("${company}: ${funding ? 'Raising Our Seed Round' : 'Local AI for Your Team'}")`] : []),
    ...(funding && reason && !RAISE.test(reason) ? [`subject: a funding campaign's subject says we are raising, so they see it at once ("${company}: Raising Our Seed Round") — "${reason}" does not`] : []),
    ...(words(f.hook).length < 8 ? ['hook: one sentence on what they are doing now — it shows we know who they are'] : []),
    ...(f.hook && !shares(f.hook, `${card.now} ${card.what} ${card.company}`) ? ['hook: say what THEY are doing, from your research card (its "now" or "what") — it shares no word with it'] : []),
    ...(words(f.why).length < 6 ? ['why: one sentence on why this concerns them, now — the reason they fit this campaign'] : []),
    ...(words(f.offer).length < 8 ? ['offer: what we have for their need, in their terms, with one proof from the approved facts'] : []),
    ...(!chosen ? [`askIndex: which of the campaign's asks this is (0 to ${plan.asks.length - 1})`] : []),
    ...(chosen && !f.ask.endsWith('?') ? ['ask: one question, ending in "?"'] : []),
    ...(chosen && !shares(f.ask, `${chosen.ask} ${chosen.delivers}`) ? [`ask: name the campaign's ask — "${chosen.ask}" (what is sent on a yes: ${chosen.delivers}) — in your words for them`] : []),
    ...([f.hook, f.why, f.offer].some((s) => s.includes('?')) ? ['the ask is the only question: the hook, the why and the offer say, they do not ask'] : []),
    ...(bodyWords > BODY_WORDS_MAX ? [`at most ${BODY_WORDS_MAX} words from hook to ask, and this is ${bodyWords} — cut to what they need to say yes`] : []),
    ...(banned.length ? [`never "${banned.join('", "')}" — say the real thing`] : []),
    ...saidTwice([f.hook, f.why, f.offer, f.ask]),
    ...(twin ? [`another email of this campaign (to ${twin.to?.join(', ') ?? 'someone else'}) opens or offers the same way — write this one for this person`] : []),
  ];
};
