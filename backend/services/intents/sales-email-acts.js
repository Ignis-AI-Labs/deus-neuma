/**
 * THE EMAIL FORMULA's two acts (email-formula.js, formula-gates.js) — Design note, 2026-11-19: […]
 *
 * sales/research — what the seat learned about one person it may write to: who, what the company does, what they are
 * doing now and when, where, what they need, with the pages it read — kept for good, for every campaign after this
 * one too ([…]) — and whether they fit this campaign, and why.
 * sales/email-plan — a campaign's email variables: what it is for, what the people it writes to need from us, the
 * offer, the asks (each naming what is sent on a yes) and the sign-off. They wait for the operator to lock them in.
 * The Mercator's, like every lead-engine act; the same for the main seat and every clone.
 */
import { officeContext } from './revenue-acts.js';
import { readCampaigns, readSegments, readProspects, readCandidates, fileEmailPlan, settleProspect } from '../sales/sales-store.js';
import { evidenceEgressRefusal } from '../sales/evidence-egress.js';
import { makeEntity, verifyQuote, isInvestor, isFundingCampaign, entityWords, ENTITY_TYPES } from '../sales/company-entity.js';
import { readOutbox, withdrawDrafts } from '../sales/email-outbox.js';
import { leadOrigins } from '../sales/campaign-shape.js';
import { makeResearch, makeEmailPlan, researchFresh, OBJECTIVES, RESEARCH_FRESH_DAYS } from '../sales/email-formula.js';
import { readResearch, noteResearch, noteFit, noteEntity } from '../sales/research-store.js';
import { leadLedgerFor } from '../leads/lead-ledger.js';
import { normalizeEmail } from '../sales/suppress-shape.js';

const invalid = (reason) => ({ ok: false, status: 'invalid', reason });
const denied = (reason) => ({ ok: false, status: 'denied', reason });
const seated = async (connection) => (await officeContext(connection).catch(() => null)) || null;
const CARD = ['name', 'role', 'company', 'what', 'now', 'when', 'where', 'need', 'sources'];

// impure — the campaign a lead serves, by its audience.
const campaignOfLead = async (wallet, lead) => {
  const [campaigns, segments, prospects] = await Promise.all([readCampaigns(wallet), readSegments(wallet), readProspects(wallet)]);
  const id = leadOrigins({ campaigns, segments, prospects, leads: [lead] }).get(lead.id)?.campaignId;
  return campaigns.find((c) => c.id === id) ?? null;
};

const salesResearchIntent = Object.freeze({
  name: 'sales/research',
  policyTool: 'sales.research',
  fieldsForPrompt: '{email, name, role, company, what, now, when?, where?, need, sources, fit: {verdict, why}}',
  descriptionForPrompt: `THE LEAD ENGINE. GATE TWO AND THREE of a first email: what you learned about one person on the lead list, and whether they fit their campaign. email: their (confirmed) address. WHO — name (full), role. WHAT — company, and what it does (one sentence). WHEN/WHAT NOW — now: one specific, recent thing they are doing (a launch, a raise, a deal, a hire, a portfolio move), with when. WHERE — where they are, or the market they serve. WHY — need: what they likely need, read from all that. sources: the https pages you read it on, their own site first. fit: {verdict: "yes" | "no", why} — do they fit what their campaign is asking for (funding: does their thesis take us; customers: do they have the problem we solve; a partner: do they gain from it), in one sentence. The research is KEPT FOR GOOD, for every campaign after this one: a "no" here still keeps it. A card is fresh for ${RESEARCH_FRESH_DAYS} days — while it is, file only {email, fit} for a new campaign. No first email is written to anyone without a fresh card and a "yes".`,
  availableFor: async ({ connection }) => ((await seated(connection)) ? {} : null),
  validate: async (payload, { connection }) => {
    const context = await seated(connection);
    if (!context) return denied('the lead engine is the Mercator office\'s — only the seated Mercator files to it');
    const email = normalizeEmail(payload?.email);
    if (!email) return invalid('email: the address of the person on the lead list');
    const lead = (await (await leadLedgerFor(context.wallet)).load()).find((l) => normalizeEmail(l.contact) === email);
    if (!lead) return invalid(`${email} is not on the lead list — file them first (sales/lead), then research them`);
    const campaign = await campaignOfLead(context.wallet, lead);
    const known = (await readResearch(context.wallet)).cards.get(email) ?? null;
    const given = CARD.some((k) => payload?.[k] !== undefined);
    let card = null;
    if (given || !known || !researchFresh(known)) {
      try {
        card = makeResearch({ ...payload, email });
      } catch (err) {
        return invalid(`${!known ? 'no research on them yet' : researchFresh(known) ? 'the research' : `the research on them is older than ${RESEARCH_FRESH_DAYS} days`} — ${err.message}`);
      }
    }
    const verdict = String(payload?.fit?.verdict ?? '').toLowerCase();
    const why = String(payload?.fit?.why ?? '').replace(/\s+/g, ' ').trim();
    if (payload?.fit !== undefined || !card) {
      if (!campaign) return invalid('this lead serves no campaign yet (its audience belongs to none): keep the research without fit, and give the fit once its audience serves a campaign');
      if (!['yes', 'no'].includes(verdict) || why.length < 10) return invalid(`fit: {verdict: "yes" | "no", why} — do they fit "${campaign.name}" (${campaign.goal}), in one sentence`);
    }
    return { ok: true, value: { context, email, lead, card, campaign, fit: payload?.fit !== undefined ? { verdict, why } : null } };
  },
  summarize: (payload) => `research ${String(payload?.email ?? '?').slice(0, 80)}${payload?.fit?.verdict ? ` — fit: ${payload.fit.verdict}` : ''}`,
  execute: async ({ context, email, lead, card, campaign, fit }) => {
    if (card) await noteResearch(context.wallet, card, context.laneId);
    if (fit) await noteFit(context.wallet, { email, campaignId: campaign.id, verdict: fit.verdict, why: fit.why }, context.laneId);
    // A "no" is said on the lead too, so its history shows why no email went for that campaign.
    if (fit?.verdict === 'no') await (await leadLedgerFor(context.wallet)).touch(lead.id, { note: `not a fit for "${campaign.name}": ${fit.why}`, by: context.laneId }).catch(() => null);
    const kept = card ? `Research on ${card.name} (${card.role}, ${card.company}) kept for every campaign.` : 'Their research stands.';
    if (!fit) return { ok: true, detail: kept };
    return { ok: true, detail: fit.verdict === 'yes'
      ? `${kept} A FIT for "${campaign.name}": ${fit.why}. Next: write their first email from the formula with sales/draft-email {to: "${email}", subject, hook, why, offer, askIndex, ask}.`
      : `${kept} NOT a fit for "${campaign.name}": ${fit.why}. No email for this campaign — move on to the next person; their research stays for a later campaign.` };
  },
});

const salesEmailPlanIntent = Object.freeze({
  name: 'sales/email-plan',
  policyTool: 'sales.email-plan',
  fieldsForPrompt: '{campaign, objective, need, offer, asks: [{ask, delivers}], signature}',
  descriptionForPrompt: `THE LEAD ENGINE. A campaign's email variables — what every first email of it is written from. campaign: its id. objective: one of ${Object.entries(OBJECTIVES).map(([k, v]) => `${k} (${v})`).join(', ')}. need: what the people it writes to need that we have, in one sentence. offer: what we offer them, in their terms (one or two sentences; every claim on the approved facts). asks: one to three concrete next steps it may ask for, each {ask: the question ("Shall I send the deck and the round's terms?"), delivers: exactly what is sent or done on a yes}. signature: the sign-off every email of it ends with. It WAITS for your operator to lock it in (POSITIONS, CHIEF REVENUE OFFICER, CAMPAIGNS); no first email of the campaign is written until then. Filing it again replaces what waits.`,
  availableFor: async ({ connection }) => ((await seated(connection)) ? {} : null),
  validate: async (payload, { connection }) => {
    const context = await seated(connection);
    if (!context) return denied('the lead engine is the Mercator office\'s — only the seated Mercator files to it');
    const campaign = (await readCampaigns(context.wallet)).find((c) => c.id === String(payload?.campaign ?? '').trim());
    if (!campaign) return invalid('campaign: the id of one of the house\'s campaigns (sales/pipeline lists them)');
    if (campaign.state !== 'open') return invalid(`"${campaign.name}" is archived`);
    try {
      return { ok: true, value: { context, campaign, plan: makeEmailPlan(payload) } };
    } catch (err) {
      return invalid(err.message);
    }
  },
  summarize: (payload) => `file the email plan of campaign ${String(payload?.campaign ?? '?').slice(0, 40)}`,
  execute: async ({ context, campaign, plan }) => {
    const filed = await fileEmailPlan(context.wallet, campaign.id, plan, context.laneId);
    if (!filed.ok) return { ok: false, reason: filed.reason };
    return { ok: true, detail: `The email plan of "${campaign.name}" (${plan.objective}, ${plan.asks.length} ask${plan.asks.length === 1 ? '' : 's'}) waits for your operator to lock it in, in POSITIONS, CHIEF REVENUE OFFICER, CAMPAIGNS. Tell them. No first email of it is written until they do.` };
  },
});

// WHAT A COMPANY IS (company-entity.js; 2026-11-19, […] — a robotics company — scored a fit for a
// FUNDING audience on its name). Filed once a company, kept for every campaign; a funding campaign writes only to an
// investor. A company found NOT to be one leaves every funding audience by itself, with the reason, its records kept,
// and the funding email waiting for it is withdrawn.
const salesEntityIntent = Object.freeze({
  name: 'sales/entity',
  policyTool: 'web.fetch',
  fieldsForPrompt: '{domain, name, entityType, quote, source}',
  descriptionForPrompt: `THE LEAD ENGINE. What a company IS, read from its OWN site, never from its name: entityType, one of ${Object.entries(ENTITY_TYPES).map(([k, v]) => `${k} (${v.words})`).join(', ')}; quote: its own words, copied exactly from the page; source: that https page on its own domain; name: the company's name. An investor's quote must say it invests ("we invest", "portfolio", "fund", "AUM", "LPs", "we back", "seed") — a name with Ventures, Capital, Holdings or Partners in it is NOT evidence: if its site shows it builds or sells something, it is a product-company. The page is read again and the quote must be on it. Kept for every campaign. A FUNDING campaign writes only to investors: filed as anything else, the company leaves every funding audience by itself, and the funding email waiting for it is withdrawn — its lead may suit a customer campaign (sales/place).`,
  availableFor: async ({ connection }) => ((await seated(connection)) ? {} : null),
  validate: async (payload, { connection }) => {
    const context = await seated(connection);
    if (!context) return denied('the lead engine is the Mercator office\'s — only the seated Mercator files to it');
    let entity;
    try { entity = makeEntity(payload); } catch (err) { return invalid(err.message); }
    const egress = evidenceEgressRefusal(entity);
    if (egress) return denied(egress);
    const [prospects, candidates] = await Promise.all([readProspects(context.wallet), readCandidates(context.wallet)]);
    if (![...prospects, ...candidates].some((p) => p.domain === entity.domain)) return invalid(`${entity.domain} is not a prospect or candidate of this house — file it through the lead pipeline before classifying it`);
    return { ok: true, value: { context, entity } };
  },
  summarize: (payload) => `${String(payload?.domain ?? '?').slice(0, 60)} is ${String(payload?.entityType ?? '?').slice(0, 30)}`,
  execute: async ({ context, entity }, { signal } = {}) => {
    const checked = await verifyQuote(entity, { signal });
    if (!checked.ok) return { ok: false, reason: checked.why };
    entity = { ...entity, verified: checked.verified, why: checked.why };
    await noteEntity(context.wallet, entity, context.laneId);
    if (isInvestor(entity)) return { ok: true, detail: `Kept: ${entityWords(entity)}. A funding campaign may write to it.` };
    // Not an investor: out of every funding audience, and its funding email taken back.
    const [campaigns, segments, prospects] = await Promise.all([readCampaigns(context.wallet), readSegments(context.wallet), readProspects(context.wallet)]);
    const funding = new Set(segments.filter((sg) => isFundingCampaign(campaigns.find((c) => c.id === sg.campaign))).map((sg) => sg.id));
    const out = prospects.filter((p) => p.domain === entity.domain && funding.has(p.segmentId) && p.stage !== 'dropped');
    for (const p of out) await settleProspect(context.wallet, p.id, { type: 'dropped', reason: `not an investor (${entity.entityType}) — no fit for a funding campaign`, by: context.laneId });
    const leads = await (await leadLedgerFor(context.wallet)).load();
    const origins = leadOrigins({ campaigns, segments, prospects, leads });
    const fundingLeadAt = (address) => leads.some((l) => normalizeEmail(l.contact) === address && address.endsWith(`@${entity.domain}`) && isFundingCampaign(campaigns.find((c) => c.id === origins.get(l.id)?.campaignId)));
    const waiting = (await readOutbox(context.wallet)).drafts.filter((d) => d.state === 'waiting' && d.to.some(fundingLeadAt)).map((d) => d.id);
    if (waiting.length) await withdrawDrafts(context.wallet, { to: fundingLeadAt, why: `${entity.domain} is not an investor (${entity.entityType})`, by: context.laneId });
    return { ok: true, detail: `Kept: ${entityWords(entity)}. NOT AN INVESTOR — no fit for any funding campaign${out.length ? `: taken out of ${out.length} funding audience${out.length === 1 ? '' : 's'}` : ''}${waiting.length ? `; the funding email waiting for it [${waiting.join(', ')}] is withdrawn` : ''}. Its research stays: if it suits a customer campaign, place its lead there (sales/place).` };
  },
});

export const salesEmailIntents = Object.freeze([salesResearchIntent, salesEmailPlanIntent, salesEntityIntent]);
