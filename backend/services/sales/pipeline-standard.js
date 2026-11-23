// THE STANDARD — what every lead is held to at every stage of the pipeline, written down, one line a check.
//
// Design note, 2026-11-22: […] And the day
// before: […].
//
// A check is a sentence the operator can read and disagree with, and a test of one lead's own records. It is a MUST
// (failing it, the lead FAILS the stage: it should not have got through) or a SHOULD (failing it, the lead is WEAK
// there: it got through, and a better one was possible). Nothing here asks a model: every check reads what the
// pipeline itself put on record, so the same batch graded twice gets the same grade, and a grade that moves between
// two runs moved because the pipeline did. pipeline-review.js grades a batch with it.
// PURE.

import { definingFit } from './lead-run-shape.js';
import { requiredState } from './required-signs.js';
import { isInvestor } from './company-entity.js';
import { rankOf, domainOfAddress } from './top-first.js';
import { typoOf } from './address-typo.js';
import { checkFormula, researchFresh, subjectReason, RESEARCH_FRESH_DAYS } from './email-formula.js';
import { saidTwice } from './said-twice.js';
import { neverSign } from './never-countries.js';
import { checkSalesEmail } from './sales-facts.js';

export const STAGES = Object.freeze([
  { id: 'filter', name: 'FILTER', asks: 'Is this company what the audience is for?' },
  { id: 'address', name: 'ADDRESS', asks: 'Is this the right person to write to?' },
  { id: 'validate', name: 'VALIDATION', asks: 'Will an email to this address arrive?' },
  { id: 'research', name: 'RESEARCH', asks: 'Do we know them well enough to write?' },
  { id: 'email', name: 'EMAIL', asks: 'Is the email right for them, and right by the formula?' },
]);
export const CHECK_FRESH_DAYS = 90;
const DAY = 86_400_000;

const GENERAL = /^(info|hello|hi|hey|contact|contacts|team|admin|office|support|help|general|enquir(y|ies)|inquir(y|ies)|mail|email|invest|investors?|ir|partners?|partnerships?|bd|sales|press|media|pr|careers?|jobs|pitch(es)?|deals?|ventures?|fund|capital|founders?|apply|submissions?|business|marketing|community|gm|hq|us)$/i;
/** pure — is this a mailbox nobody in particular reads (info@, hello@), by its own name. */
export const generalMailbox = (email) => GENERAL.test(String(email ?? '').split('@')[0].replace(/[._+-]?\d*$/, ''));
/** pure — the role a lead's own name line carries ([…] → "Partner"). */
export const roleOfLead = (lead) => String(lead?.name ?? '').split(', ').slice(1).join(', ').replace(/\s+at\s+.*$/i, '').trim();
const NOT_SHOWN = /\b(does not|doesn't|do not|not (explicitly|clearly|directly|verified|shown|stated|mentioned|confirmed)|no (evidence|mention|indication|sign)|unclear|cannot|can't|unverified|held as a claim)\b/i;
const NOBODY = /\b(team|inbox|mailbox|general (address|inbox|mailbox|inquir\w*|enquir\w*|contact)|inquiries|enquiries|contact us|support)\b/i;
const aimedAt = (role, targetRole) => {
  const aim = String(targetRole ?? '').toLowerCase().match(/[a-z]{4,}/g) ?? [];
  return aim.some((w) => String(role ?? '').toLowerCase().includes(w));
};
// One company under two endings (hashkey.com, hashkey.capital) is still its own domain.
const label = (domain) => String(domain).split('.').slice(-2, -1)[0] ?? '';
const hostOf = (url) => { try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } };
// A name in the middle of a sentence that is not the company's own: a portfolio company, a product, a fund, a person.
const named = (now, company) => { const own = new Set(String(company ?? '').toLowerCase().split(/\s+/)); return String(now ?? '').split(/\s+/).slice(1).some((w) => /^[A-Z][A-Za-z0-9]{2,}/.test(w) && !own.has(w.toLowerCase().replace(/[^a-z0-9]/g, ''))); };
const DATED = /\b(19|20)\d{2}\b|\b(january|february|march|april|may|june|july|august|september|october|november|december|q[1-4])\b|\$\s?\d|\d+\s?(%|million|billion|m\b|k\b)/i;

/**
 * THE CHECKS. Each: { id, stage, must, says, fails(x) → the reason in words, or null }; `needs(x)` false means the
 * check does not apply to this lead (it is not counted for or against it).
 * x is one lead with everything on record about it (pipeline-review.js gathers it):
 *   { lead, email, prospect, segment, campaign, plan, check, card, fit, entity, draft, approved, company, twins, now }
 */
export const STANDARD = Object.freeze([
  // ── FILTER
  { id: 'fit.first-sign', stage: 'filter', must: true, says: 'It meets the audience\'s FIRST sign (3 of 5 or more) and matches the audience overall.',
    fails: (x) => (definingFit(x.prospect) ? null : `first sign scored ${x.prospect?.fit?.[0]?.score ?? 'nothing'}, match ${x.prospect?.match ?? 'none'}`) },
  { id: 'fit.required', stage: 'filter', must: true, says: 'Every hard condition of the audience is proved from the company\'s own page.',
    needs: (x) => (x.segment?.required ?? []).length > 0,
    fails: (x) => { const s = requiredState(x.segment, x.prospect); return s.state === 'failed' ? `fails: ${s.failed.map((r) => r.sign).join('; ')}` : s.state === 'unproved' ? `not proved yet: ${s.unproved.map((r) => r.sign).join('; ')}` : null; } },
  { id: 'fit.investor', stage: 'filter', must: true, says: 'For a funding campaign: its own page says it invests, and that sentence is on record.',
    needs: (x) => x.funding === true,
    fails: (x) => (!x.entity ? 'nothing on record says what this company is' : !isInvestor(x.entity) ? `on record as ${x.entity.entityType}, not an investor` : x.entity.verified === false ? 'its investing sentence was never found on its page' : null) },
  { id: 'fit.never', stage: 'filter', must: true, says: 'Nothing places it where the house never writes to (the never-list its legal office keeps): not its record, its domain, or the address.',
    fails: (x) => neverSign({ country: x.prospect?.country ?? null, domain: x.prospect?.domain ?? '', emails: x.email ? [x.email] : [] }, x.never ?? [])?.why ?? null },
  { id: 'fit.country', stage: 'filter', must: true, says: 'It is not in a country the audience does not write to.',
    needs: (x) => (x.segment?.countries ?? []).length > 0 && Boolean(x.prospect?.country),
    fails: (x) => (x.segment.countries.includes(x.prospect.country) ? null : `it is in ${x.prospect.country}`) },
  { id: 'fit.firm', stage: 'filter', must: false, says: 'The first sign is met firmly (4 or 5), not on a bare 3.',
    fails: (x) => ((x.prospect?.fit?.[0]?.score ?? 0) >= 4 ? null : `first sign scored ${x.prospect?.fit?.[0]?.score ?? 0}`) },
  { id: 'fit.shown', stage: 'filter', must: false, says: 'A first sign scored 4 or 5 stands on what the page SHOWS: its reason does not say a part is missing.',
    needs: (x) => (x.prospect?.fit?.[0]?.score ?? 0) >= 4,
    fails: (x) => { const r = x.prospect?.fit?.[0]?.reasoning ?? ''; return NOT_SHOWN.test(r) ? `its own reason hedges: "${r.slice(0, 140)}"` : null; } },
  { id: 'fit.screened', stage: 'filter', must: false, says: 'Its fit was confirmed by a screening of its own page (it is on the approved list).',
    fails: (x) => (x.prospect?.listApproved ? null : 'never confirmed by a screening') },
  // ── ADDRESS
  { id: 'who.person', stage: 'address', must: false, says: 'The address is a named person\'s, never a general mailbox.',
    fails: (x) => (generalMailbox(x.email) || NOBODY.test(roleOfLead(x.lead)) ? `${x.email} is a general mailbox` : null) },
  { id: 'who.top', stage: 'address', must: false, says: 'The person is at the top of the company, or in the role the audience aims at.',
    needs: (x) => !generalMailbox(x.email) && !NOBODY.test(roleOfLead(x.lead)),
    fails: (x) => { const role = roleOfLead(x.lead); return !role ? 'no role on record' : rankOf({ role }) <= 3 || aimedAt(role, x.segment?.targetRole) ? null : `"${role}" is neither the top nor the role aimed at`; } },
  { id: 'who.domain', stage: 'address', must: false, says: 'The address is at the company\'s own domain.',
    fails: (x) => { const d = domainOfAddress(x.email); const own = x.prospect?.domain ?? ''; return !own || d === own || d.endsWith(`.${own}`) || own.endsWith(`.${d}`) || label(d) === label(own) ? null : `${d} is not ${own}`; } },
  { id: 'who.one', stage: 'address', must: false, says: 'One lead a company in an audience.',
    fails: (x) => (x.twins > 0 ? `${x.twins} other lead(s) at the same company in this audience` : null) },
  // ── VALIDATION
  { id: 'addr.valid', stage: 'validate', must: true, says: 'A checker confirmed the address exists (valid).',
    fails: (x) => (x.check?.status === 'valid' ? null : x.check ? `${x.check.checker}: ${x.check.status}` : 'never checked') },
  { id: 'addr.typo', stage: 'validate', must: true, says: 'The address is not a mistyped one.',
    fails: (x) => { const t = typoOf(x.email); return t ? `${t.why} (meant ${t.meant})` : null; } },
  { id: 'addr.live', stage: 'validate', must: false, says: 'The checker was asked live, not read from a provider\'s stored flag.',
    needs: (x) => x.check?.status === 'valid',
    fails: (x) => (x.check.live ? null : 'confirmed only by a stored flag') },
  { id: 'addr.fresh', stage: 'validate', must: false, says: `The check is no older than ${CHECK_FRESH_DAYS} days.`,
    needs: (x) => x.check?.status === 'valid',
    fails: (x) => (x.now - Date.parse(x.check.at) <= CHECK_FRESH_DAYS * DAY ? null : `checked ${Math.round((x.now - Date.parse(x.check.at)) / DAY)} days ago`) },
  // ── RESEARCH
  { id: 'card.fresh', stage: 'research', must: true, says: `There is a research card on them, no older than ${RESEARCH_FRESH_DAYS} days.`,
    fails: (x) => (researchFresh(x.card, x.now) ? null : 'the card is too old') },
  { id: 'card.fit', stage: 'research', must: true, says: 'Whether they fit THIS campaign is on record, and it says yes.',
    fails: (x) => (!x.fit ? 'no fit on record for this campaign' : x.fit.verdict !== 'yes' ? `on record as NOT a fit: ${x.fit.why}` : null) },
  { id: 'card.person', stage: 'research', must: false, says: 'The card is about a person, by name.',
    fails: (x) => (NOBODY.test(`${x.card?.name} ${x.card?.role}`) ? `it is about "${x.card.name}, ${x.card.role}"` : null) },
  { id: 'card.own-site', stage: 'research', must: false, says: 'The company\'s own site is among the pages it was read on.',
    fails: (x) => { const own = x.prospect?.domain ?? domainOfAddress(x.email); return (x.card?.sources ?? []).some((s) => { const h = hostOf(s); return h === own || h.endsWith(`.${own}`); }) ? null : 'no source is their own site'; } },
  { id: 'card.dated', stage: 'research', must: false, says: 'NOW names one specific thing: a name, a date, a sum or a figure is in it, not a slogan.',
    fails: (x) => (DATED.test(`${x.card?.now} ${x.card?.when}`) || named(x.card?.now, x.card?.company) ? null : `nothing named, dated or counted: "${String(x.card?.now).slice(0, 120)}"`) },
  // ── EMAIL
  { id: 'mail.campaign', stage: 'email', must: true, says: 'It was written for the campaign its audience serves (never one campaign\'s pitch to another\'s lead).',
    fails: (x) => (x.draft.formula.campaignId === x.campaign?.id ? null : `written for campaign ${x.draft.formula.campaignId}, and its audience serves ${x.campaign?.name ?? 'no campaign'}`) },
  { id: 'mail.formula', stage: 'email', must: true, says: 'It passes the formula as the formula stands today.',
    needs: (x) => Boolean(x.plan && x.card),
    fails: (x) => {
      const f = x.draft.formula;
      const problems = checkFormula({ subject: subjectReason(x.company, x.draft.subject), hook: f.hook, why: f.why, offer: f.offer, ask: f.ask, askIndex: f.askIndex }, { card: x.card, plan: x.plan, company: x.company })
        .filter((p) => !/make the same point|stated twice/.test(p)); // said twice is its own check, below
      return problems.length ? problems.join('; ') : null;
    } },
  { id: 'mail.once', stage: 'email', must: true, says: 'Nothing is said twice: no figure stated twice, no two sentences making one point.',
    fails: (x) => { const f = x.draft.formula; const t = saidTwice([f.hook, f.why, f.offer, f.ask]); return t.length ? t.join('; ') : null; } },
  { id: 'mail.facts', stage: 'email', must: true, says: 'Every figure in it is on the approved facts sheet.',
    needs: (x) => Boolean(x.approved),
    fails: (x) => { const v = checkSalesEmail({ subject: x.draft.subject, text: x.draft.text, approved: x.approved }); return v.ok ? null : v.problems.join('; '); } },
  { id: 'mail.research', stage: 'email', must: true, says: 'It was written from research: a card stood when it was staged.',
    fails: (x) => (x.card ? null : 'no research card stands for this address') },
  { id: 'mail.greeting', stage: 'email', must: false, says: 'It greets a person by their first name, or a general mailbox as the team, never a company as if it were a person.',
    fails: (x) => { const hi = /^Hi ([^,\n]+),/.exec(x.draft.text)?.[1] ?? ''; const co = String(x.prospect?.name ?? '').split(/\s+/)[0]; return !hi ? 'no greeting' : co && hi.toLowerCase() === co.toLowerCase() ? `it greets "${hi}" as if the company were a person` : null; } },
  { id: 'mail.first-draft', stage: 'email', must: false, says: 'It was right the first time: staged without being sent back or rewritten more than once.',
    fails: (x) => ((x.draft.revised ?? 0) <= 1 ? null : `rewritten ${x.draft.revised} times before it stood`) },
]);

/** pure — has this lead reached a stage (is there anything of that stage on record to grade). */
export const reached = (stage, x) => ({
  filter: Boolean(x.prospect), address: Boolean(x.email), validate: Boolean(x.email),
  research: Boolean(x.card), email: Boolean(x.draft?.formula),
}[stage] ?? false);

/**
 * Grade one lead at every stage.
 * @param {object} x - the lead with everything on record about it
 * @returns {{grades: Record<string, 'meets'|'weak'|'fails'|'none'>, fails: Array<{stage, check, must, why}>}}
 */
export const gradeLead = (x) => {
  const grades = {};
  const fails = [];
  for (const { id: stage } of STAGES) {
    if (!reached(stage, x)) { grades[stage] = 'none'; continue; }
    const hits = STANDARD.filter((c) => c.stage === stage && (c.needs ? c.needs(x) : true))
      .map((c) => ({ c, why: c.fails(x) })).filter((h) => h.why);
    for (const h of hits) fails.push({ stage, check: h.c.id, must: h.c.must, why: h.why });
    grades[stage] = hits.some((h) => h.c.must) ? 'fails' : hits.length ? 'weak' : 'meets';
  }
  return { grades, fails };
};
