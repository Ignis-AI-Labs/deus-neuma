// A SALES CAMPAIGN — one push with one goal, holding the audiences that serve
// it (Design note, 2026-11-15: […] — a funding campaign and a user-acquisition campaign,
// kept apart). The operator opens and closes campaigns; an audience belongs to
// at most one. A campaign's numbers are COUNTED from the house's own records,
// never kept beside them: companies gathered, companies scored, people on the
// lead list, written to, replied, qualified, won, lost — in all, and by the
// channel each lead is worked through.
//
// The record is append-only events:
//   { type: 'opened', campaign, at }   { type: 'closed', id, by, at }
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
  }
  return [...byId.values()];
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

/** pure — one campaign as the sales seat reads it. */
export const campaignLine = (c) => `- [${c.id}] ${c.name} (for ${c.company}, ${c.state}) — goal: ${c.goal} — ${c.audiences.length} audience(s), ${c.gathered} gathered, ${c.scored} scored, ${c.leads} on the lead list, ${STAGES.map((s) => `${c[s]} ${s}`).join(', ')}`;
