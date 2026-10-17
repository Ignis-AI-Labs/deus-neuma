/**
 * campaigns/* — the campaign-bench mutations as INTENTS (Stage 3 batch 4,
 * #357). The bench is SHARED house state (the house's own office,
 * offices/marketing/marketing-campaigns.json), so shaping it is a filed act,
 * never a raw write — and it lands in the filer's own house (the connection's
 * wallet), never another house's bench. campaign_list stays a read
 * tool this batch. Marketing is the CMO's office BY PROTOCOL (the
 * descriptions, the briefing, the playbook), never a hard gate.
 *
 * The executors are the campaign tool handler's own logic, relocated unchanged.
 */
import { campaignStoreFor } from '../marketing/campaign-store.js';
import { requireReadyKit } from '../branding/kit-gate.js';

// THE BRAND KIT COMES FIRST (Design note, 2026-08-30: […]). A campaign is where
// marketing work BEGINS, so this is the earliest honest place to stand the gate
// — earlier than the first post, which is already too late to be setting up a
// brand. The refusal carries the whole checklist; see kit-gate.js.
const brandGate = async (brand, connection) => {
  const gate = await requireReadyKit(brand, connection?.walletAddress || null);
  return gate.ok ? null : { ok: false, status: 'invalid', reason: gate.reason };
};

// The prefix-8 id a being reads in campaign_list is accepted alongside the
// full id — the being should never have to transcribe hex.
const resolveCampaignId = async (bench, given) => {
  const campaigns = await bench.load();
  const matches = campaigns.filter((c) => c.id === given || (given && c.id.startsWith(given)));
  if (matches.length > 1) {
    throw new Error(`the id "${given}" matches several campaigns — use more of the id (campaign_list shows them).`);
  }
  return matches.length === 1 ? matches[0].id : given;
};

// impure — the filer's own house's bench.
const benchOf = (connection) => campaignStoreFor(connection?.walletAddress);

const campaignIntent = (spec) => Object.freeze({
  // A lane with no house has no bench to file onto.
  availableFor: ({ laneId, connection }) => (laneId && connection?.walletAddress ? {} : null),
  ...spec,
});

export const campaignCreateIntent = campaignIntent({
  name: 'campaigns/create',
  policyTool: 'campaigns.create',
  fieldsForPrompt: '{name, brand, status?, channelId?, pillars?, cadence?, marketingPlan?, funnelPlan?, notes?}',
  descriptionForPrompt: 'Declare a marketing campaign on the HOUSE bench. status: active | paused | done (default active). channelId: the ONE platform this campaign runs on; omit only for a deliberately house-wide push. pillars: content pillars (at most 12). cadence: how often it publishes, in plain words. Declare only campaigns the house is actually running. Marketing is the CMO\'s office: if you are not on the marketing team, leave campaign work to them — feed them what they need, help only when it objectively makes sense.',
  validate: async (payload, { connection } = {}) => {
    const name = typeof payload?.name === 'string' ? payload.name.trim() : '';
    const brand = typeof payload?.brand === 'string' ? payload.brand.trim() : '';
    if (!name || !brand) return { ok: false, status: 'invalid', reason: 'campaigns/create needs {name, brand}' };
    const blocked = await brandGate(brand, connection);
    if (blocked) return blocked;
    return { ok: true, value: { ...payload, name, brand } };
  },
  summarize: (payload) => `declare campaign "${String(payload?.name ?? '?').slice(0, 120)}"`,
  execute: async (fields, { connection } = {}) => {
    const campaign = await (await benchOf(connection)).add({
      name: fields.name, brand: fields.brand, status: fields.status,
      channelId: fields.channelId, pillars: fields.pillars, cadence: fields.cadence,
      marketingPlan: fields.marketingPlan, funnelPlan: fields.funnelPlan, notes: fields.notes,
    });
    return { ok: true, detail: `Declared [${campaign.id.slice(0, 8)}] ${campaign.name} (${campaign.brand}) — ${campaign.status}.` };
  },
});

export const campaignUpdateIntent = campaignIntent({
  name: 'campaigns/update',
  policyTool: 'campaigns.update',
  fieldsForPrompt: '{id, name?, brand?, status?, channelId?, pillars?, cadence?, marketingPlan?, funnelPlan?, notes?}',
  descriptionForPrompt: 'Edit a campaign on the house bench — only the fields you pass change. cadence is the SCHEDULE in one line (max 200 chars); reasoning and research belong in marketingPlan/notes. The id campaign_list shows — its first 8 characters are enough. Marketing is the CMO\'s office: if you are not on the marketing team, leave campaign work to them.',
  validate: async (payload) => {
    const id = typeof payload?.id === 'string' ? payload.id.trim() : '';
    if (!id) return { ok: false, status: 'invalid', reason: 'campaigns/update needs the campaign id (campaign_list shows them; a prefix is enough)' };
    return { ok: true, value: { ...payload, id } };
  },
  summarize: (payload) => `update campaign ${String(payload?.id ?? '?').slice(0, 12)}${payload?.status ? ` → ${payload.status}` : ''}`,
  execute: async (fields, { connection } = {}) => {
    const bench = await benchOf(connection);
    const result = await bench.update(await resolveCampaignId(bench, fields.id), {
      name: fields.name, brand: fields.brand, status: fields.status,
      channelId: fields.channelId, pillars: fields.pillars, cadence: fields.cadence,
      marketingPlan: fields.marketingPlan, funnelPlan: fields.funnelPlan, notes: fields.notes,
    });
    if (!result.ok) return { ok: false, reason: result.error };
    const c = result.campaign;
    return { ok: true, detail: `Updated [${c.id.slice(0, 8)}] ${c.name} (${c.brand}) — now ${c.status}.` };
  },
});
