/**
 * sales/place — a lead already on the ledger put under an audience (Founder,
 * 2026-11-18). A lead's campaign is never a field on the lead or on an email:
 * it comes from the audience the lead stands under. A lead registered by hand
 * stands under none, so it and every email staged to it showed NO CAMPAIGN, and
 * the only way to fix it was to drop the lead and file it again — which the
 * ledger refuses. This act ties (or re-ties) the lead to an audience; the lead,
 * and the emails staged to it, read that audience's campaign from then on.
 *
 * THE OFFICE LAW holds as for every sales act: only the seated Mercator files.
 * Tier `allowed`: a record in the house's own office, no egress, no spend. A
 * lead placed this way is on NO approved list: every email to it still asks the
 * operator (sales-cover.js), and a lead moved between audiences loses the list
 * approval it had under the old one.
 */
import { officeContext } from './revenue-acts.js';
import { readSegments, readCampaigns, placeLead } from '../sales/sales-store.js';
import { normalizeEmail } from '../sales/suppress-shape.js';
import { domainOfAddress } from '../sales/top-first.js';
import { leadLedgerFor } from '../leads/lead-ledger.js';

const officerRefusal = { ok: false, status: 'denied', reason: 'the lead engine is the Mercator office\'s — only the seated Mercator files to it (house/post reaches them; the operator seats the office)' };
const invalid = (reason) => ({ ok: false, status: 'invalid', reason });
const seated = async (connection) => (await officeContext(connection).catch(() => null)) || null;

const salesPlaceIntent = Object.freeze({
  name: 'sales/place',
  policyTool: 'sales.place',
  fieldsForPrompt: '{lead, segment}',
  descriptionForPrompt: 'THE LEAD ENGINE. Put a lead that is ALREADY on the ledger under an audience: `lead` is its id or its email address, `segment` the audience id (s-…). The lead and every email staged to it then read that audience\'s campaign. Use it for a lead filed with no audience, or one filed under the wrong one — never drop and re-file a lead to change its campaign.',
  availableFor: async ({ connection }) => ((await seated(connection)) ? {} : null),
  validate: async (payload, { connection }) => {
    const context = await seated(connection);
    if (!context) return officerRefusal;
    const wanted = String(payload?.lead ?? '').trim();
    const segmentId = String(payload?.segment ?? '').trim();
    if (!wanted) return invalid('lead: the lead\'s id, or its email address');
    if (!segmentId) return invalid('segment: the audience id (s-…) to put the lead under');
    const leads = await (await leadLedgerFor(context.wallet)).load();
    const lead = leads.find((l) => l.id === wanted) ?? leads.find((l) => normalizeEmail(l.contact) && normalizeEmail(l.contact) === normalizeEmail(wanted));
    if (!lead) return invalid(`"${wanted}" is not a lead on the ledger — give its id or the address it is filed under`);
    const segment = (await readSegments(context.wallet)).find((s) => s.id === segmentId);
    if (!segment) return invalid(`"${segmentId}" is not an audience of this house`);
    return { ok: true, value: { context, lead: { id: lead.id, name: lead.name, contact: lead.contact }, segment: { id: segment.id, name: segment.name, campaign: segment.campaign ?? null } } };
  },
  summarize: (payload) => `put lead ${payload?.lead ?? '?'} under audience ${payload?.segment ?? '?'}`,
  execute: async ({ context, lead, segment }) => {
    const placed = await placeLead(context.wallet, { leadId: lead.id, segmentId: segment.id, name: lead.name, domain: domainOfAddress(lead.contact) || null, by: context.laneId });
    if (!placed.ok) return { ok: false, reason: placed.reason };
    const campaign = segment.campaign ? (await readCampaigns(context.wallet)).find((c) => c.id === segment.campaign) : null;
    const under = campaign ? `campaign "${campaign.name}" [${campaign.id}]` : 'no campaign yet (the audience itself stands under none — the operator puts an audience under a campaign)';
    return { ok: true, detail: `Lead ${lead.name} [${lead.id}] now stands under audience "${segment.name}" [${segment.id}] — ${under}. Emails staged to it read the same; none needs staging again.` };
  },
});

export const salesPlaceIntents = Object.freeze([salesPlaceIntent]);
