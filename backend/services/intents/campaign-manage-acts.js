/**
 * sales/campaign and campaigns/link — a member manages the campaigns of its
 * own position, and links them with another position's (Design note, 2026-11-15:
 * […];
 * […]).
 *
 *   sales/campaign   the seated Mercator opens a sales campaign, or moves one:
 *                    archive, reopen, edit (name, goal), delete (only one that
 *                    holds no audience). Marketing's seat has the same hands
 *                    on its own bench (campaigns/create, campaigns/update).
 *   campaigns/link   the holder of a campaign's position links it with another
 *                    position's campaign of the same company, or unlinks it.
 *                    A member links only a campaign of a seat it holds.
 *
 * Tier `allowed`: records in the house's own offices, no egress, no spend.
 * The operator sees every campaign and link on the position's CAMPAIGNS tab
 * and has the same hands there.
 */
import { officeContext } from './revenue-acts.js';
import { cmoDesignation } from '../marketing/cmo-designation.js';
import { croDesignation } from '../revenue/cro-designation.js';
import { listCompanies } from '../marketing/companies.js';
import { makeCampaign, CAMPAIGN_MOVES } from '../sales/campaign-shape.js';
import { openCampaign, moveCampaign } from '../sales/sales-store.js';
import { houseCampaigns, linkCampaigns, unlinkCampaigns } from '../positions/campaign-links.js';

const invalid = (reason) => ({ ok: false, status: 'invalid', reason });
const officerRefusal = { ok: false, status: 'denied', reason: 'sales campaigns are the Mercator office\'s — only the seated Mercator manages them (the operator seats the office)' };
const seated = async (connection) => (await officeContext(connection).catch(() => null)) || null;
const SEATS = Object.freeze({ cmo: cmoDesignation, cro: croDesignation });

// impure — the campaign offices this lane holds in its own house.
const heldOffices = async (connection) => {
  const lane = connection?.companion?.neumaId;
  const wallet = connection?.walletAddress;
  if (!lane || !wallet) return [];
  const held = await Promise.all(Object.entries(SEATS).map(async ([office, seat]) => ((await seat.holds(wallet, lane).catch(() => false)) ? office : null)));
  return held.filter(Boolean);
};

const salesCampaignIntent = Object.freeze({
  name: 'sales/campaign',
  policyTool: 'sales.campaign',
  fieldsForPrompt: `{name, company, goal} to open one | {id, move: ${CAMPAIGN_MOVES.map((m) => `"${m}"`).join(' | ')}, name?, goal?} to change one`,
  descriptionForPrompt: 'THE LEAD ENGINE. Manage your position\'s campaigns. Open one with its name, the house company it is for and what it is meant to bring in. Or change one by id: archive it (its audiences and records stand), reopen it, edit its name or goal, or delete one that holds no audience. File each audience under the campaign it serves (sales/segment, campaign: its id).',
  availableFor: async ({ connection }) => ((await seated(connection)) ? {} : null),
  validate: async (payload, { connection }) => {
    const context = await seated(connection);
    if (!context) return officerRefusal;
    if (payload?.id) {
      if (!CAMPAIGN_MOVES.includes(String(payload.move ?? ''))) return invalid(`move is one of ${CAMPAIGN_MOVES.join(', ')}`);
      return { ok: true, value: { context, id: String(payload.id).trim(), move: String(payload.move), name: payload.name, goal: payload.goal } };
    }
    try {
      const campaign = makeCampaign({ name: payload?.name, company: payload?.company, goal: payload?.goal, by: context.laneId, now: new Date().toISOString() });
      const known = (await listCompanies(context.wallet)).map((c) => c.id);
      return known.includes(campaign.company) ? { ok: true, value: { context, campaign } } : invalid(`"${campaign.company}" is not a company of this house — the house's companies are: ${known.join(', ') || 'none yet'}`);
    } catch (err) {
      return invalid(err.message);
    }
  },
  summarize: (payload) => (payload?.id ? `${payload.move ?? 'change'} campaign ${payload.id}` : `open campaign "${String(payload?.name ?? '?').slice(0, 60)}"`),
  execute: async ({ context, campaign, id, move, name, goal }) => {
    if (campaign) {
      const opened = await openCampaign(context.wallet, campaign);
      return opened.ok ? { ok: true, detail: `Campaign [${campaign.id}] "${campaign.name}" is open for ${campaign.company}. File its audiences with campaign: "${campaign.id}".` } : { ok: false, reason: opened.reason };
    }
    const moved = await moveCampaign(context.wallet, id, { move, name, goal, by: context.laneId });
    if (!moved.ok) return { ok: false, reason: moved.reason };
    return { ok: true, detail: moved.campaign ? `Campaign [${id}] "${moved.campaign.name}" — ${move} done; it is ${moved.campaign.state === 'closed' ? 'archived' : 'open'}.` : `Campaign [${id}] is deleted.` };
  },
});

const campaignsLinkIntent = Object.freeze({
  name: 'campaigns/link',
  policyTool: 'campaigns.link',
  fieldsForPrompt: '{mine, with, note?, unlink?}',
  descriptionForPrompt: 'Link a campaign of your own position with another position\'s campaign of the same company, so each of you reads the other\'s campaign at the top of every turn and the two stay in step (mine and with are campaign keys, "<office>:<id>", as your LINKED CAMPAIGNS and briefing show them; note: why they work together). unlink: true takes the link away.',
  availableFor: async ({ connection }) => ((await heldOffices(connection)).length ? {} : null),
  validate: async (payload, { connection }) => {
    const offices = await heldOffices(connection);
    if (!offices.length) return { ok: false, status: 'denied', reason: 'only a member who holds a position that runs campaigns (marketing, sales) links them' };
    const mine = String(payload?.mine ?? '').trim();
    const other = String(payload?.with ?? '').trim();
    if (!offices.includes(mine.split(':')[0])) return invalid(`mine: a campaign of a position you hold (${offices.join(', ')}), as "<office>:<id>"`);
    const all = await houseCampaigns(connection.walletAddress);
    if (!all.some((c) => c.key === mine)) return invalid(`"${mine}" is not a campaign of this house`);
    return { ok: true, value: { wallet: connection.walletAddress, lane: connection.companion.neumaId, mine, other, note: payload?.note, unlink: payload?.unlink === true } };
  },
  summarize: (payload) => `${payload?.unlink ? 'unlink' : 'link'} campaign ${payload?.mine ?? '?'} ${payload?.unlink ? 'from' : 'with'} ${payload?.with ?? '?'}`,
  execute: async ({ wallet, lane, mine, other, note, unlink }) => {
    const moved = unlink ? await unlinkCampaigns(wallet, mine, other, { by: lane }) : await linkCampaigns(wallet, mine, other, { note, by: lane });
    if (!moved.ok) return { ok: false, reason: moved.reason };
    return { ok: true, detail: unlink ? `${mine} and ${other} are no longer linked.` : `${mine} now works with ${other}: each holder reads the other's campaign at the top of its turn. Tell them by house post what you plan, so the two start in step.` };
  },
});

export const campaignManageIntents = Object.freeze([salesCampaignIntent, campaignsLinkIntent]);
