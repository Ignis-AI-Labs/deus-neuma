// THE LEAD RUN, its shapes (lead-run.js runs them). Design note, 2026-11-21: […]
//
// What the house's records showed: 13,115 companies gathered and 13,000 of them never touched, because every company
// was worked by hand inside a chat turn — read, score, classify, find the person, check the address — one at a time.
// A run does the same steps as a machine job, several companies at once, and files each through the SAME acts the
// seat files through (sales/prospect, sales/contacts, sales/lead), so every rule that binds the seat binds the run.
//
// This file is the pure part: a page as words, what the screener is asked, how its answer becomes a filing, the quote
// that proves a required sign or what a company is, and which person is written to first.
import { htmlToText } from '../html-to-text.js';
import { ENTITY_TYPES, EVIDENCE } from './company-entity.js';

export const TEXT_MAX = 5000;
const flat = (s) => String(s ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const clean = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/** pure — a page as its words, one block of the page a line (a heading never runs into the paragraph under it). */
export const pageWords = (html) => htmlToText(String(html ?? ''), 200_000).split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');

// A page's text cut at a fixed length can end in HALF a character (an emoji is two code units): the model server then
// refuses the whole request as unreadable JSON ([…] — found 2026-11-21,
// six companies in one run left unscreened by it). Every text sent to the model is made whole first.
/** pure — the text with any half character replaced, so it can always be sent. */
export const sound = (text) => String(text ?? '').toWellFormed();

/** pure — the page's sentences worth quoting: whole, between 15 and 300 characters. */
export const sentencesOf = (text) => String(text ?? '').split(/(?<=[.!?])[ \t]+|\n+/).map((s) => s.trim()).filter((s) => s.length >= 15 && s.length <= 300);

// The company's own name is never evidence: taken out before a sentence is read for a word.
const withoutName = (sentence, name) => { const n = flat(name); return n ? flat(sentence).replace(new RegExp(`\\b${n.replace(/\s+/g, '\\s+')}\\b`, 'g'), ' ') : flat(sentence); };

/**
 * pure — the first sentence on the page that holds one of the words as a whole word, the company's name set aside.
 * @returns {?string} the sentence exactly as the page has it
 */
export const sentenceWith = (text, words, name) => sentencesOf(text).find((s) => {
  const said = ` ${withoutName(s, name)} `;
  return words.some((w) => said.includes(` ${flat(w)} `));
}) ?? null;

/** pure — the first sentence on the page whose own words (the name set aside) say it invests, by the same words the entity record is judged with. */
export const investingSentence = (text, name) => sentencesOf(text).find((s) => EVIDENCE.test(withoutName(s, name))) ?? null;

// Where a company is, read from its own pages when the screener could not say: the plainest marks only.
const US_STATES = 'AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC';
const PLACES = [
  ['US', new RegExp(`\\b(United States|U\\.S\\.A?\\.?|USA)\\b|,\\s*(${US_STATES})\\s+\\d{5}\\b|\\b(New York|San Francisco|Palo Alto|Menlo Park|Boston|Chicago|Los Angeles|Austin|Seattle|Miami)\\b`)],
  ['GB', /\b(United Kingdom|England|London)\b/], ['SG', /\bSingapore\b/], ['CH', /\b(Switzerland|Zurich|Zürich|Zug|Geneva)\b/], ['AE', /\b(United Arab Emirates|UAE|Dubai|Abu Dhabi)\b/],
  ['HK', /\bHong Kong\b/], ['JP', /\b(Japan|Tokyo)\b/], ['KR', /\b(South Korea|Seoul)\b/], ['DE', /\b(Germany|Deutschland|Berlin|Munich|München)\b/], ['TH', new RegExp(`\\b(Thailand|${['Bang', 'kok'].join('')})\\b`)],
  ['MY', /\b(Malaysia|Kuala Lumpur)\b/], ['EE', /\b(Estonia|Tallinn)\b/], ['KY', /\bCayman Islands\b/], ['CA', /\b(Canada|Toronto|Vancouver)\b/], ['FR', /\b(France|Paris)\b/],
  ['NL', /\b(Netherlands|Amsterdam)\b/], ['IL', /\b(Israel|Tel Aviv)\b/], ['IN', /\b(India|Bangalore|Bengaluru|Mumbai)\b/], ['AU', /\b(Australia|Sydney|Melbourne)\b/],
];
/**
 * pure — the one country a company's pages name, or null: none named, or more than two (a firm that lists its
 * offices around the world has not said where it is).
 */
export const countryOn = (text) => {
  const named = PLACES.filter(([, re]) => re.test(String(text ?? ''))).map(([code]) => code);
  return named.length >= 1 && named.length <= 2 ? named[0] : null;
};

/**
 * pure — the audience's DEFINING sign is its first sign of fit (the one that says what the company IS: […], […]). A run pursues a person only at a company the page shows to be that: scored 3
 * or more on it. The trial that set this rule: with signs only averaged, private-equity firms with a portfolio page
 * and an allowed country came out "a fit" for an audience of crypto funds (0, 0, 5, 5).
 */
export const DEFINING_MIN = 3;
export const definingFit = (prospect) => (prospect?.match ?? 0) >= 2 && (prospect.fit?.[0]?.score ?? 0) >= DEFINING_MIN;

// THE LIKELIEST FIRST — what was gathered ABOUT a company (its name, its own description, its categories) says a lot
// about whether its page will be a fit, before a single page is read. Measured on the house's own records, 2026-11-21:
// for the two funding audiences, a company whose description names nothing an investor is called (fund, capital,
// ventures, accelerator, grant…) was a fit 0.8 and 5 times in 100; one that does, 9.6 and 20.6. For the crypto-funds and
// token audiences, a description sharing two words with the audience's first sign was a fit 51 and 67 times in 100,
// one sharing none 13 and 14. So a run reads the likeliest companies first and reaches the unlikely last, if at all.
const INVESTOR_WORDS = /\b(venture|ventures|capital|fund|funds|invest\w*|vc|accelerator|incubator|grants?|angels?|partners|holdings|equity|seed|portfolio|foundation)\b/;
const COMMON = new Set('the and for with that this from their your into over more than have has are was were will its our who what when where which not but can all any one two new use used using need needs want wants wanting running team teams company companies active within last years'.split(' '));
/** pure — the words an audience is told apart by: its first sign's and its name's, less the common ones. */
export const signWords = (segment) => [...new Set(String([segment?.positiveCriteria?.[0], segment?.name].join(' ')).toLowerCase().match(/[a-z][a-z0-9-]{2,}/g)?.filter((w) => !COMMON.has(w)) ?? [])];
/**
 * pure — how likely a gathered company is to be this audience, from what was gathered about it: 0 (nothing says so)
 * to 4. A funding audience counts an investor's words for 2; every audience counts up to 2 words shared with its
 * first sign.
 * @param {object} candidate @param {string[]} words - signWords(segment) @param {boolean} funding
 */
export const leanOf = (candidate, words, funding) => {
  const about = [candidate?.name, candidate?.description, (candidate?.categories ?? []).join(' '), String(candidate?.domain ?? '').replace(/[.-]/g, ' ')].join(' ').toLowerCase();
  const said = new Set(about.match(/[a-z][a-z0-9-]{2,}/g) ?? []);
  // A fund's address often runs the word into its name (blockchaincapital.com): read there without needing a gap.
  const investor = INVESTOR_WORDS.test(about) || /capital|ventures?|invest|holdings|equity/.test(String(candidate?.domain ?? '').toLowerCase().split('.')[0]);
  return (funding && investor ? 2 : 0) + Math.min(2, words.filter((w) => said.has(w)).length);
};

/** Does this gathered company still wait to be screened for this audience by a run? (Not passed over, not from a
 * too-wide search, its site not already found dead.) pure. */
export const screenable = (c, segmentId, tooWide) => c.segmentId === segmentId && c.state === 'waiting' && c.shortlist !== 'passed' && !tooWide.has(c.domain) && !(c.siteRead && !c.siteRead.alive);

/**
 * WHERE THE FITS COME FROM — for one audience, how the companies each source brought have screened so far: of those
 * scored, how many the page showed to be what the audience IS. A run works the best source first (found 2026-11-21 in
 * the live records: a run spent its whole look at 1,154 companies one search had brought — product companies, 4 in 100
 * a fit — while 1,343 from another source, 28 in 100 a fit, waited untouched behind them). A source nothing was scored
 * from yet stands at one in four, so it is tried before a source known to be poor. pure.
 * @param {object[]} candidates - every gathered company of the house
 * @param {object[]} prospects - every scored company of the house
 * @param {string} segmentId
 * @returns {Map<string, {scored: number, fit: number, rate: number}>} by source
 */
export const sourceYield = (candidates, prospects, segmentId) => {
  const scored = new Map(prospects.filter((p) => p.segmentId === segmentId).map((p) => [p.domain, p]));
  const by = new Map();
  for (const c of candidates) {
    if (c.segmentId !== segmentId) continue;
    const row = by.get(c.source) ?? { scored: 0, fit: 0, rate: 0 };
    const p = scored.get(c.domain);
    if (p) { row.scored += 1; if (definingFit(p)) row.fit += 1; }
    by.set(c.source, row);
  }
  for (const row of by.values()) row.rate = Math.round(((row.fit + 1) / (row.scored + 4)) * 1000) / 1000;
  return by;
};

/**
 * pure — the other audience a no-fit belongs to, by what the audience itself says: a disqualifier it scored 3 or more
 * that names where such a company goes ([…]) points at the audience or campaign of that name.
 * @param {object} prospect - scored, with its misfit scores
 * @param {object[]} others - the house's other approved audiences, each with `campaignName`
 */
export const belongsElsewhere = (prospect, others) => {
  for (const m of (prospect?.misfit ?? []).filter((x) => x.score >= 3)) {
    const to = /\(goes to ([^)]+)\)/i.exec(m.criterion)?.[1];
    if (!to) continue;
    const words = flat(to).split(' ').filter((w) => w.length > 3);
    const home = others.find((o) => words.every((w) => flat(`${o.name} ${o.campaignName ?? ''}`).includes(w)));
    if (home) return home;
  }
  return null;
};

/**
 * pure — what the screener is asked: the audience, the company, the page, and the one JSON object to answer with.
 * Criteria are numbered so the answer names them by number, never by a paraphrase.
 */
export const screenMessages = ({ segment, company, text, funding }) => {
  const fit = segment.positiveCriteria ?? [];
  const misfit = segment.negativeCriteria ?? [];
  const types = Object.entries(ENTITY_TYPES).map(([id, t]) => `"${id}" (${t.words})`).join(', ');
  return [
    { role: 'system', content: 'You screen one company for a sales audience. Use ONLY the page text given: never what you know of the company from elsewhere, never a guess. A sign the page does not show scores 0 or 1 and says so. A SIGN THAT NAMES SEVERAL THINGS HAS A CORE: what the company IS, in the sign\'s most specific word (the field, the chain, the kind of customer). For "a crypto fund with a portfolio of DeFi or token projects" the core is A FUND THAT INVESTS IN CRYPTO. Score 4-5 only when the page shows every part. Score 3 when the page shows the core in its own words and only a detail is not on this page ("a venture firm investing in crypto", its portfolio not listed here). Score 0-2 WHEN THE FIELD ITSELF IS MISSING: the sign is NOT met by a fund with a portfolio whose page names nothing crypto, however large its portfolio. To score 3 or more you must be able to QUOTE THE PAGE\'S OWN WORD FOR THE FIELD, and the reason gives that word; if the page has no such word the score is 0-2. The reason says what the page shows and names any part that is missing. Answer with ONE JSON object and nothing else.' },
    { role: 'user', content: [
      `AUDIENCE: ${segment.name}`,
      `WHO IT IS FOR: ${segment.customerProblem ?? ''} — offered: ${segment.offer ?? ''}`,
      'SIGNS OF FIT (score each 0-5 from the page):', ...fit.map((c, i) => `  F${i + 1}. ${c}`),
      ...(misfit.length ? ['DISQUALIFIERS (score each 0-5: 0 = not at all, 5 = clearly true):', ...misfit.map((c, i) => `  D${i + 1}. ${c}`)] : []),
      '', `COMPANY: ${company.name} (${company.domain})`, 'PAGE TEXT:', sound(String(text).slice(0, TEXT_MAX)), '',
      'Answer exactly this JSON:',
      `{"name": "the company's name as its page writes it", "what": "one sentence: what the company does, from the page", "country": "two-letter ISO code of where it is based if the page says (an address, a city, 'based in'), else null", "scores": {${[...fit.map((_, i) => `"F${i + 1}"`), ...misfit.map((_, i) => `"D${i + 1}"`)].map((k) => `${k}: {"score": 0, "why": "what on the page shows it, or that the page does not show it"}`).join(', ')}}${funding ? `, "type": "what the company IS, one of ${types}", "typeQuote": "one whole sentence copied EXACTLY from the page that shows what it is"` : ''}}`,
    ].join('\n') },
  ];
};

/**
 * pure — the second, narrow question, asked only for a fit whose country the first reading could not say: where is it
 * based, from its contact and about pages. (The first live run left 8 of 13 fits unfiled for want of a country.)
 */
export const whereMessages = ({ company, text }) => [
  { role: 'system', content: 'You read where a company is based from its own page text. Use ONLY the text given. Answer with ONE JSON object and nothing else.' },
  { role: 'user', content: `COMPANY: ${company.name} (${company.domain})\nPAGE TEXT (its contact, about and home pages):\n${sound(String(text).slice(0, TEXT_MAX))}\n\nWhere is its head office? A street address, a city, "based in", "headquartered in", or a phone country code on the page decides it. If it lists several offices, the first one or the one called headquarters. On a legal page (privacy, terms, imprint), where the company itself is registered or whose law governs it decides it: "a Delaware limited partnership" is US, "the laws of the Cayman Islands" is KY, "Zug, Switzerland" is CH. A law named only for the reader's own rights (GDPR, California residents) says nothing. Answer exactly: {"country": "two-letter ISO code, or null if the text does not say", "from": "the words on the page that show it"}` },
];
/** pure — the country in an answer to whereMessages, or null. */
export const readWhere = (raw) => { const c = String(readAnswer(raw)?.country ?? '').trim(); return /^[A-Za-z]{2}$/.test(c) ? c.toUpperCase() : null; };

/** pure — the JSON object in a model's answer, or null. */
export const readAnswer = (raw) => {
  const s = String(raw ?? '');
  const from = s.indexOf('{');
  const to = s.lastIndexOf('}');
  if (from < 0 || to <= from) return null;
  try { const v = JSON.parse(s.slice(from, to + 1)); return v && typeof v === 'object' && !Array.isArray(v) ? v : null; } catch { return null; }
};

/**
 * pure — the filing for sales/prospect from a screener's answer, or why there is none. What a required sign needs is
 * proved here from the page itself, never by the model: the page's own sentence holding an evidence word, or "not met".
 * @param {{segment: object, company: {domain: string, name: string, country?: ?string, size?: ?string}, answer: object, text: string, url: string, funding: boolean, all?: string}} f
 *   text: the words of the page at `url` (every quote is taken from it, so it stands when the page is read again); all: every page read
 * @returns {{ok: true, company: object} | {ok: false, why: string}}
 */
export const filingOf = ({ segment, company, answer, text, url, funding, all = text, pages = [{ url, text }] }) => {
  if (!answer?.scores || typeof answer.scores !== 'object') return { ok: false, why: 'the screener gave no scores' };
  const fit = segment.positiveCriteria ?? [];
  const misfit = segment.negativeCriteria ?? [];
  const one = (key, criterion) => {
    const got = answer.scores[key];
    const score = Math.round(Number(got?.score));
    const why = clean(got?.why, 300);
    return Number.isInteger(score) && score >= 0 && score <= 5 && why.length >= 10 ? { criterion, score, reasoning: why } : null;
  };
  const scores = [...fit.map((c, i) => one(`F${i + 1}`, c)), ...misfit.map((c, i) => one(`D${i + 1}`, c))];
  if (scores.slice(0, fit.length).some((s) => !s)) return { ok: false, why: 'the screener left a sign of fit without a score and a reason' };
  const name = clean(answer.name, 120).length >= 2 ? clean(answer.name, 120) : company.name;
  const country = /^[A-Za-z]{2}$/.test(String(answer.country ?? '').trim()) ? String(answer.country).trim().toUpperCase() : company.country ?? countryOn(all);
  const proofs = (segment.required ?? []).map((r) => {
    // The first page first, then each other page read (its contact, about, team): the quote is filed with the page it stands on.
    const hit = pages.map((p) => ({ quote: sentenceWith(p.text, r.evidence, name), source: p.url })).find((h) => h.quote);
    return hit ? { sign: r.sign, met: true, quote: hit.quote, source: hit.source } : { sign: r.sign, met: false, reasoning: `nothing on ${url}${pages.length > 1 ? ` or the ${pages.length - 1} other page(s) read` : ''} says it: none of its sentences holds ${r.evidence.map((w) => `"${w}"`).join(' or ')}` };
  });
  let entity = {};
  if (funding) {
    const type = ENTITY_TYPES[String(answer.type ?? '').trim().toLowerCase()] ? String(answer.type).trim().toLowerCase() : null;
    const said = clean(answer.typeQuote, 400);
    const onPage = said.length >= 15 && flat(text).includes(flat(said));
    const investing = investingSentence(text, name);
    // An investor must be shown by the page's own investing words; without them it is filed as what the page does show.
    if (type && ENTITY_TYPES[type].investor) entity = investing ? { entityType: type, entityEvidence: { quote: onPage && investingSentence(said, name) ? said : investing, source: url } } : null;
    else entity = { entityType: type ?? 'other', entityEvidence: { quote: onPage ? said : sentencesOf(text)[0] ?? '', source: url } };
    if (entity === null) entity = { entityType: 'other', entityEvidence: { quote: sentencesOf(text)[0] ?? '', source: url } };
    if (entity.entityEvidence.quote.length < 15) return { ok: false, why: 'its page has no sentence that says what it is' };
  }
  return { ok: true, company: { domain: company.domain, name, description: clean(answer.what, 300) || undefined, ...(country ? { country } : {}), ...(company.size ? { size: company.size } : {}), scores: scores.filter(Boolean), source: url, ...(proofs.length ? { proofs } : {}), ...entity } };
};

/**
 * pure — a sign that only asks WHERE a company is ([…]) is scored by the record, not by
 * the model: its country is one the audience writes to (5), is not (0), or is not known yet (3: the pipeline files
 * such a lead COUNTRY TO FIND, and an unknown country is never counted against a company that is otherwise a fit —
 * the first sales bench lost Hack VC to exactly that: a 0 for […] sank its match).
 * @param {{country?: ?string, scores: object[]}} company - as filingOf made it
 * @param {{countries?: string[]}} segment
 */
export const whereScored = (company, segment) => {
  const allowed = segment?.countries ?? [];
  if (!allowed.length) return company;
  const is = company.country ?? null;
  return { ...company, scores: company.scores.map((s) => (!/\bcountr(y|ies)\b/i.test(s.criterion) || /\b(not|outside|sanction)/i.test(s.criterion) ? s
    : is ? { ...s, score: allowed.includes(is) ? 5 : 0, reasoning: `it is in ${is}, ${allowed.includes(is) ? 'a country this audience writes to' : 'not a country this audience writes to'}` }
      : { ...s, score: 3, reasoning: 'its pages do not say where it is: country still to find, not counted against it' })) };
};

// A partner decides at a fund: above a director or a head of something (the second live run wrote to a director over a partner).
const SENIOR = [/\b(founder|co-?founder|ceo|chief executive|partner|owner|president|managing director)\b/i, /\b(principal|cto|coo|cfo|chief|head|director|vp|vice president)\b/i, /\b(lead|manager|investor|associate)\b/i];

/**
 * pure — the people at a company, the one to write to first on top: an address already confirmed, then the role the
 * audience is aimed at, then seniority; a named person before a general mailbox.
 * @param {Array<{name?: string, role?: string, email?: string, checked?: string, sourceUrl?: string}>} people
 * @param {string} targetRole
 */
export const firstToWrite = (people, targetRole = '') => {
  const aimed = flat(targetRole).split(' ').filter((w) => w.length > 3);
  const rank = (p) => {
    const role = flat(p.role);
    const senior = SENIOR.findIndex((re) => re.test(String(p.role ?? '')));
    // A general mailbox is the last resort: it has no role to be aimed at.
    if (p.general) return p.checked === 'valid' ? 100 : 0;
    return 5 + (p.checked === 'valid' ? 100 : 0) + (aimed.some((w) => role.includes(w)) ? 40 : 0) + (senior < 0 ? 0 : 30 - senior * 10);
  };
  return people.filter((p) => /^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/.test(String(p.email ?? ''))).map((p, i) => ({ p, i, r: rank(p) })).sort((a, b) => b.r - a.r || a.i - b.i).map((x) => x.p);
};

/** pure — one run's count line, as the desk and the seat read it. */
export const runWords = (c) => `${c.checked ? `${c.checked} waiting validated (${c.held} hold, ${c.out} out, ${c.left} left as they stood) · ` : ''}${c.looked} looked at · ${c.dead} dead or unreadable · ${c.screened} screened (${c.fit} a fit, ${c.weak ?? 0} a fit only on the side signs, ${c.nofit} no fit${c.moved ? `, ${c.moved} moved to the audience they belong to` : ''}) · ${c.unclear} could not be screened${c.beside ? ` · ${c.beside} left to the run working beside this one` : ''} · ${c.leads} lead(s) with a confirmed address${c.countryOpen ? ` (${c.countryOpen} with the country still to find)` : ''} · ${c.noAddress} a fit with no confirmed address yet${c.elsewhere ? ` · ${c.elsewhere} a fit in a country this audience is not sent to (nobody looked up)` : ''}${c.written || c.researched || c.notMatch || c.unwritten || c.heldCountry ? ` · ${c.written ?? 0} email(s) researched and staged for review${c.notMatch ? `, ${c.notMatch} researched and not a match` : ''}${c.unwritten ? `, ${c.unwritten} left for the sales member to write` : ''}` : ''}${c.never ? ` · ${c.never} in a place the house never writes to` : ''}`;
