// formula-gates — before a first email to a lead is written, the three gates and the campaign's email plan; then the
// email is built from the formula (email-formula.js). Design note, 2026-11-19: […] The same for the main
// seat and every clone: sales/draft-email asks here. impure (the house's records; an address check when none stands).

import { firstEmailScreen } from './lead-screen.js';
import { readAddressChecks, readCampaigns, readSegments, readProspects } from './sales-store.js';
import { checkBeforeSending } from './address-check.js';
import { settledWords } from './address-confirm.js';
import { readResearch } from './research-store.js';
import { readNeverList } from '../legal/never-list.js';
import { readOutbox } from './email-outbox.js';
import { leadOrigins } from './campaign-shape.js';
import { isFundingCampaign, entityRefusal } from './company-entity.js';
import { checkFormula, assembleEmail, researchFresh, subjectLine, RESEARCH_FRESH_DAYS } from './email-formula.js';
import { listCompanies } from '../marketing/companies.js';
import { writtenBefore } from './first-email.js';
import { kindOf, UNSORTED, personTouches } from '../leads/lead-ledger.js';
import { normalizeEmail } from './suppress-shape.js';

/** pure — is this the house's first email to a lead it sells to: the formula's to write. */
// `followUp` does not decide it: an email is a follow-up when an earlier one is on record, never because it was
// called one (2026-11-20: a lead never written to, marked followUp, skipped every gate).
export const needsFormula = (lead) => Boolean(lead) && ['buyer', UNSORTED].includes(kindOf(lead))
  && !writtenBefore({ touches: personTouches(lead) }) && !personTouches(lead).some((t) => t.direction === 'in');

const FIELDS = '{to, subject, hook, why, offer, askIndex, ask}';

/** impure — the name a campaign's company goes by, as its record has it ("deus-neuma" → "Deus Neuma"); read from the id when no record stands. */
const companyNameOf = async (wallet, id) => {
  const record = (await listCompanies(wallet).catch(() => [])).find((c) => c.id === id);
  return record?.name?.trim() || String(id ?? '').split(/[-_\s]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ') || 'Our Company';
};

/**
 * @param {string} wallet
 * @param {{lead: object, to: string, payload: object, by: string}} q payload: the seat's draft
 * @returns {Promise<{refusal: string} | {subject: string, text: string, promise: string, formula: object}>}
 */
export const formulaEmail = async (wallet, { lead, to, payload, by }) => {
  const email = normalizeEmail(to);
  // GATE ONE — a confirmed address: nothing is written to one no database confirmed.
  const checkOf = async () => (await readAddressChecks(wallet)).find((c) => c.email === email) ?? null;
  let check = await checkOf();
  // Never checked, or standing only on a provider's stored flag: asked live now (a live answer outranks the flag).
  if (!check || !check.live) { await checkBeforeSending(wallet, [email], { by }); check = await checkOf(); }
  if (check?.status !== 'valid') {
    return { refusal: check?.settled ? `${settledWords(email, check.settled)} No email is written to an address no database confirmed.`
      : `${email} is not confirmed (${check ? `${check.checker}: ${check.status}` : 'it could not be checked'}) — no email is written to an unconfirmed address. Run sales/confirm-address {email: "${email}"} once (every database, then another address for them), or write to someone else at the company.` };
  }
  // The campaign the lead serves, and its email plan, locked in by the operator.
  const [campaigns, segments, prospects] = await Promise.all([readCampaigns(wallet), readSegments(wallet), readProspects(wallet)]);
  const origin = leadOrigins({ campaigns, segments, prospects, leads: [lead] }).get(lead.id);
  const campaign = campaigns.find((c) => c.id === origin?.campaignId) ?? null;
  if (!campaign) return { refusal: 'this lead serves no campaign: its audience must belong to one (sales/campaign) — a first email is written from its campaign\'s email plan' };
  const plan = campaign.emailPlan?.approved ?? null;
  if (!plan) {
    return { refusal: campaign.emailPlan?.proposed ? `the email plan of "${campaign.name}" waits for your operator to lock it in — no first email is written until then`
      : `"${campaign.name}" has no email plan: file it with sales/email-plan {campaign: "${campaign.id}", objective, need, offer, asks, signature}, and your operator locks it in` };
  }
  const prospect = prospects.find((p) => p.leadId === lead.id) ?? null;
  const segment = prospect ? segments.find((s) => s.id === prospect.segmentId) ?? null : null;
  const research = await readResearch(wallet);
  // A FUNDING campaign writes only to investors (company-entity.js): what the company IS, from its own site, on record.
  if (isFundingCampaign(campaign)) {
    const domain = prospects.find((p) => p.leadId === lead.id)?.domain ?? email.split('@')[1];
    const notAnInvestor = entityRefusal(research.entities.get(domain), domain);
    if (notAnInvestor) return { refusal: notAnInvestor };
  }
  // THE SCREEN (lead-screen.js): scored a fit for an approved audience, every required sign met — whatever source the lead came from.
  const unscreened = firstEmailScreen({ lead, prospect, segment, segments, never: (await readNeverList(wallet)).codes });
  if (unscreened) return { refusal: unscreened };
  // GATE TWO — research on who they are, fresh.
  const card = research.cards.get(email) ?? null;
  if (!card || !researchFresh(card)) {
    return { refusal: `${card ? `the research on ${email} is older than ${RESEARCH_FRESH_DAYS} days` : `there is no research on ${email}`} — research them first: sales/research {email, name, role, company, what, now, when, where, need, sources, fit: {verdict, why}}. It is kept for every campaign after this one.` };
  }
  // GATE THREE — a fit for this campaign.
  const fit = research.fits.get(`${email}|${campaign.id}`) ?? null;
  if (!fit) return { refusal: `say whether ${card.name} fits "${campaign.name}" (${campaign.goal}): sales/research {email: "${email}", fit: {verdict: "yes" | "no", why}}` };
  if (fit.verdict !== 'yes') return { refusal: `${card.name} is NOT a fit for "${campaign.name}" (${fit.why}) — no email for this campaign. Their research stays for the next one.` };
  // THE FORMULA.
  if (typeof payload?.text === 'string' && payload.text.trim()) return { refusal: `a first email to a lead is built from the formula, not written whole: give ${FIELDS} — the greeting (Hi ${card.name.split(' ')[0]},) and "${campaign.name}"'s sign-off are added for you` };
  const fields = { subject: payload?.subject, hook: payload?.hook, why: payload?.why, offer: payload?.offer, ask: payload?.ask, askIndex: Number(payload?.askIndex) };
  const others = (await readOutbox(wallet)).drafts
    .filter((d) => d.formula?.campaignId === campaign.id && !d.to.includes(email) && ['waiting', 'returned', 'sent', 'uncertain'].includes(d.state))
    .map((d) => ({ hook: d.formula.hook, offer: d.formula.offer, to: d.to }));
  const company = await companyNameOf(wallet, campaign.company);
  const problems = checkFormula(fields, { card, plan, company, others });
  if (problems.length) return { refusal: `it does not follow the formula yet: ${problems.join('; ')}` };
  const chosen = plan.asks[fields.askIndex];
  return {
    // The subject is the platform's to write: the company's name first, then why we write, in title case.
    subject: subjectLine(company, fields.subject),
    text: assembleEmail({ card, plan, ...fields }),
    promise: chosen.delivers,
    formula: { campaignId: campaign.id, hook: String(fields.hook).trim(), why: String(fields.why).trim(), offer: String(fields.offer).trim(), ask: String(fields.ask).trim(), askIndex: fields.askIndex, researchAt: card.at },
  };
};
