// A SALES CAMPAIGN — one push with one goal, holding the audiences that serve
// it (Design note, 2026-11-15: […] — a funding campaign and a user-acquisition campaign,
// kept apart). The operator opens and closes campaigns; an audience belongs to
// at most one. A campaign's numbers are COUNTED from the house's own records,
// never kept beside them: companies gathered, companies scored, people on the
// lead list, written to, replied, qualified, won, lost — in all, and by the
// channel each lead is worked through.
//
// The record is append-only events:
//   { type: 'opened', campaign, at }   { type: 'closed', id, by, at }  (archived)
//   { type: 'reopened', id, by, at }   { type: 'updated', id, name?, goal?, by, at }
//   { type: 'deleted', id, by, at }    (only a campaign that holds no audience)
//   { type: 'email-plan', id, plan, by, at }   the campaign's email variables, proposed (email-formula.js)
//   { type: 'email-plan-review', id, verdict: 'approved'|'returned', note, by, at }   the operator locks them in or
//                                      sends them back; an approved plan stands until a newer one is approved
// PURE, but for makeCampaign's random id.

import crypto from 'crypto';
import { writtenBefore } from './first-email.js';

const clean = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '').slice(0, max);

/**
 * A campaign, or a thrown reason naming every missing field at once.
 * @param {{name: unknown, company: unknown, goal: unknown, by: string, now: string}} f
 */
export const makeCampaign = (f) => {
  const c = { name: clean(f.name, 60), company: clean(f.company, 40).toLowerCase(), goal: clean(f.goal, 300) };
  const problems = [
    ...(c.name.length < 3 ? ['name: what this campaign is called'] : []),
    ...(!c.company ? ['company: the house company this campaign is for'] : []),
    ...(c.goal.length < 10 ? ['goal: what this campaign is meant to bring in, in one sentence'] : []),
  ];
  if (problems.length) throw new Error(problems.join('; '));
  return Object.freeze({ id: `k-${crypto.randomBytes(4).toString('hex')}`, ...c, openedBy: f.by, openedAt: f.now });
};

/** The campaigns from their events, oldest first, each open or closed. pure. */
export const foldCampaigns = (events) => {
  const byId = new Map();
  for (const e of events) {
    if (e?.type === 'opened' && e.campaign?.id) byId.set(e.campaign.id, { ...e.campaign, state: 'open', closedAt: null });
    else if (e?.type === 'closed' && byId.has(e.id)) byId.set(e.id, { ...byId.get(e.id), state: 'closed', closedAt: e.at });
    else if (e?.type === 'reopened' && byId.has(e.id)) byId.set(e.id, { ...byId.get(e.id), state: 'open', closedAt: null });
    else if (e?.type === 'updated' && byId.has(e.id)) byId.set(e.id, { ...byId.get(e.id), ...(e.name ? { name: e.name } : {}), ...(e.goal ? { goal: e.goal } : {}) });
    else if (e?.type === 'deleted') byId.delete(e.id);
    else if (e?.type === 'email-plan' && byId.has(e.id)) {
      const c = byId.get(e.id);
      byId.set(e.id, { ...c, emailPlan: { ...(c.emailPlan ?? { approved: null, approvedAt: null }), proposed: e.plan, proposedBy: e.by, proposedAt: e.at, review: null } });
    } else if (e?.type === 'email-plan-review' && byId.get(e.id)?.emailPlan?.proposed) {
      const c = byId.get(e.id);
      const p = c.emailPlan;
      byId.set(e.id, { ...c, emailPlan: e.verdict === 'approved'
        ? { ...p, approved: p.proposed, approvedAt: e.at, proposed: null, review: { verdict: 'approved', note: e.note ?? '', at: e.at } }
        : { ...p, review: { verdict: 'returned', note: e.note ?? '', at: e.at } } });
    }
  }
  return [...byId.values()];
};

/** The moves a campaign can make after it is opened. */
export const CAMPAIGN_MOVES = Object.freeze(['archive', 'reopen', 'delete', 'edit']);

/**
 * One move on a campaign, as the event to append or the refusal. pure.
 * @param {?object} campaign - as folded
 * @param {{move: string, name?: unknown, goal?: unknown, audiences: number, others: object[], by: string, now: string}} m
 * @returns {{ok: true, event: object} | {ok: false, reason: string}}
 */
export const judgeMove = (campaign, { move, name, goal, audiences, others, by, now }) => {
  if (!campaign) return { ok: false, reason: 'no such campaign' };
  const stamp = { id: campaign.id, by, at: now };
  if (move === 'archive') return campaign.state === 'closed' ? { ok: false, reason: 'the campaign is already archived' } : { ok: true, event: { type: 'closed', ...stamp } };
  if (move === 'reopen') {
    if (campaign.state === 'open') return { ok: false, reason: 'the campaign is already open' };
    const clash = openRefusal(campaign, others);
    return clash ? { ok: false, reason: clash } : { ok: true, event: { type: 'reopened', ...stamp } };
  }
  if (move === 'delete') {
    return audiences ? { ok: false, reason: `${audiences} audience(s) still serve this campaign — move them to another campaign or archive it instead; its record is kept` } : { ok: true, event: { type: 'deleted', ...stamp } };
  }
  if (move === 'edit') {
    const next = { name: clean(name, 60), goal: clean(goal, 300) };
    if (!next.name && !next.goal) return { ok: false, reason: 'edit names a new name, a new goal, or both' };
    if (next.name && next.name.length < 3) return { ok: false, reason: 'name: what this campaign is called' };
    if (next.goal && next.goal.length < 10) return { ok: false, reason: 'goal: what this campaign is meant to bring in, in one sentence' };
    const clash = next.name && campaign.state === 'open' ? openRefusal({ name: next.name }, others) : null;
    return clash ? { ok: false, reason: clash } : { ok: true, event: { type: 'updated', ...stamp, ...(next.name ? { name: next.name } : {}), ...(next.goal ? { goal: next.goal } : {}) } };
  }
  return { ok: false, reason: `move is one of ${CAMPAIGN_MOVES.join(', ')}` };
};

/** May a new campaign open beside these? One open campaign per name. pure. */
export const openRefusal = (campaign, campaigns) => (campaigns.some((c) => c.state === 'open' && c.name.toLowerCase() === campaign.name.toLowerCase())
  ? `a campaign named "${campaign.name}" is already open` : null);

const STAGES = Object.freeze(['written', 'replied', 'qualified', 'won', 'lost']);
const zero = () => ({ leads: 0, written: 0, replied: 0, qualified: 0, won: 0, lost: 0 });
const heardFrom = (lead) => (lead.touches || []).some((t) => t.direction === 'in') || ['replied', 'qualified', 'won'].includes(lead.status);

// pure — one lead onto a tally.
const count = (tally, lead) => {
  tally.leads += 1;
  if (writtenBefore(lead)) tally.written += 1;
  if (heardFrom(lead)) tally.replied += 1;
  if (lead.status === 'qualified' || lead.status === 'won') tally.qualified += 1;
  if (lead.status === 'won') tally.won += 1;
  if (lead.status === 'lost') tally.lost += 1;
  return tally;
};

/**
 * Every campaign with its audiences and its numbers, counted now; then the
 * audiences that belong to no campaign. pure.
 * @param {{campaigns: object[], segments: object[], candidates: object[], prospects: object[], leads: object[]}} read
 * @returns {{campaigns: object[], loose: Array<{id: string, name: string, company: string}>}}
 */
export const campaignBoard = ({ campaigns, segments, candidates, prospects, leads }) => {
  const leadById = new Map(leads.map((l) => [l.id, l]));
  const live = segments.filter((s) => s.state !== 'retired');
  const board = campaigns.map((c) => {
    const mine = live.filter((s) => s.campaign === c.id);
    const ids = new Set(mine.map((s) => s.id));
    const pooled = prospects.filter((p) => ids.has(p.segmentId));
    const myLeads = pooled.map((p) => leadById.get(p.leadId)).filter(Boolean);
    const channels = {};
    for (const lead of myLeads) count(channels[lead.channelId || 'other'] ??= zero(), lead);
    return {
      ...c,
      audiences: mine.map((s) => ({ id: s.id, name: s.name, state: s.state })),
      gathered: candidates.filter((x) => ids.has(x.segmentId)).length,
      scored: pooled.length,
      ...myLeads.reduce(count, zero()),
      channels: Object.entries(channels).map(([channel, tally]) => ({ channel, ...tally })).sort((a, b) => b.leads - a.leads),
    };
  });
  const known = new Set(campaigns.map((c) => c.id));
  return { campaigns: board, loose: live.filter((s) => !known.has(s.campaign)).map((s) => ({ id: s.id, name: s.name, company: s.company })) };
};

/**
 * Where each lead came from: the audience that found it and the campaign that audience serves (Design note, 2026-11-16:
 * […]). A lead is tied through the scored company it was made from; one made before that link was kept
 * is tied through the audience its own source names ([…]). A lead nobody's audience found
 * (it wrote in, or was added by hand) has no entry. pure.
 * @param {{campaigns: object[], segments: object[], prospects: object[], leads: object[]}} read
 * @returns {Map<string, {audienceId: string, audience: string, company: ?string, campaignId: ?string, campaign: ?string, country: ?string, countryOpen: boolean}>}
 */
export const leadOrigins = ({ campaigns = [], segments = [], prospects = [], leads = [] }) => {
  const segmentById = new Map(segments.map((s) => [s.id, s]));
  const campaignById = new Map(campaigns.map((c) => [c.id, c]));
  const viaProspect = new Map(prospects.filter((p) => p.leadId).map((p) => [p.leadId, p.segmentId]));
  const scoredFor = new Map(prospects.filter((p) => p.leadId && !p.placed).map((p) => [p.leadId, p]));
  const origins = new Map();
  for (const lead of leads) {
    const segment = segmentById.get(viaProspect.get(lead.id) ?? /^lead engine \[([^\]]+)\]/.exec(String(lead.source ?? ''))?.[1]);
    if (!segment) continue;
    const campaign = campaignById.get(segment.campaign) ?? null;
    origins.set(lead.id, { audienceId: segment.id, audience: segment.name, company: segment.company ?? null, campaignId: campaign?.id ?? null, campaign: campaign?.name ?? null, country: scoredFor.get(lead.id)?.country ?? null, countryOpen: Boolean(scoredFor.has(lead.id) && !scoredFor.get(lead.id).country && segment.countries?.length) });
  }
  return origins;
};

/** pure — one campaign as the sales seat reads it. */
export const campaignLine = (c) => `- [${c.id}] ${c.name} (for ${c.company}, ${c.state}) — goal: ${c.goal} — ${c.audiences.length} audience(s), ${c.gathered} gathered, ${c.scored} scored, ${c.leads} on the lead list, ${STAGES.map((s) => `${c[s]} ${s}`).join(', ')}`;

/** pure — a campaign's email plan as the sales seat reads it: locked in (its asks, numbered for askIndex), waiting, or
 *  missing (email-formula.js). */
export const emailPlanLine = (c) => {
  const p = c.emailPlan ?? null;
  const waits = p?.proposed ? (p.review?.verdict === 'returned' ? ` A newer plan was RETURNED by your operator: ${p.review.note} — file it again with sales/email-plan.` : ' A newer plan waits for your operator.') : '';
  if (p?.approved) return `    EMAIL PLAN, LOCKED IN (${p.approved.objective}): they need — ${p.approved.need} · we offer — ${p.approved.offer} · asks: ${p.approved.asks.map((a, i) => `[${i}] ${a.ask} (on a yes: ${a.delivers})`).join(' ')}.${waits}`;
  return p?.proposed ? `    EMAIL PLAN: waits for your operator to lock it in — no first email of this campaign until then.${waits}` : `    EMAIL PLAN: none — file it with sales/email-plan {campaign: "${c.id}", …} before any first email of this campaign.`;
};
