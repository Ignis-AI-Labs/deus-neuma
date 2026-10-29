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
import { campaignStoreFor, validateCampaign } from '../marketing/campaign-store.js';
import { campaignContextFor } from '../marketing/campaign-context.js';
import { cmoDesignation } from '../marketing/cmo-designation.js';
import { requireReadyKit } from '../branding/kit-gate.js';

// THE BRAND KIT COMES FIRST (Design note, 2026-08-30: […]). A campaign is where
// marketing work BEGINS, so this is the earliest honest place to stand the gate
// — earlier than the first post, which is already too late to be setting up a
// brand. The refusal carries the whole checklist; see kit-gate.js. The kit IS
// the company (campaign plan §2.4).
const brandGate = async (company, connection) => {
  const gate = await requireReadyKit(company, connection?.walletAddress || null);
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

// The declared fields a being may pass — the store's shape law judges them.
const DECLARED = Object.freeze(['name', 'company', 'companyId', 'brand', 'status', 'goal', 'kpi', 'window', 'budget',
  'angles', 'pillars', 'subs', 'channelId', 'cadence', 'marketingPlan', 'funnelPlan', 'notes']);
const declaredOf = (fields) => Object.fromEntries(DECLARED.filter((k) => fields?.[k] !== undefined).map((k) => [k, fields[k]]));
const laneOf = (connection) => connection?.companion?.neumaId || '';

const SHAPE_WORDS = 'company: the brand kit it speaks for. goal: {kind: downloads|bookings|purchases|followers|signups|visits|custom, label}. '
  + 'kpi: {metric: conversions|clicks|reach|followers, target: n, by: YYYY-MM-DD}. window: {start, end} (days). '
  + 'budget: {hours?, money?, note} — a planning number, nothing spends it. angles: [{name, thesis, audience}] — what each piece argues and to whom (angles replace pillars). '
  + 'subs: [{account: "x-1", role, cadence, angles: [angle names]}] — one sub per account, each an account of the campaign\'s own company.';

export const campaignCreateIntent = campaignIntent({
  name: 'campaigns/create',
  policyTool: 'campaigns.create',
  fieldsForPrompt: '{name, company, status?, goal?, kpi?, window?, budget?, angles?, subs?, cadence?, marketingPlan?, funnelPlan?, notes?}',
  descriptionForPrompt: `Declare a marketing campaign of ONE company on the HOUSE bench. status: draft | active | paused | done (default active). ${SHAPE_WORDS} Declare only campaigns the house is actually running. Marketing is the CMO's office: if you are not on the marketing team, leave campaign work to them — feed them what they need, help only when it objectively makes sense.`,
  validate: async (payload, { connection } = {}) => {
    const name = typeof payload?.name === 'string' ? payload.name.trim() : '';
    const company = String(payload?.company ?? payload?.companyId ?? payload?.brand ?? '').trim();
    if (!name || !company) return { ok: false, status: 'invalid', reason: 'campaigns/create needs {name, company}' };
    const blocked = await brandGate(company, connection);
    if (blocked) return blocked;
    const ctx = await campaignContextFor(connection?.walletAddress);
    const fields = { ...declaredOf(payload), name, companyId: company };
    delete fields.company;
    const invalid = validateCampaign(fields, ctx);
    if (invalid) return { ok: false, status: 'invalid', reason: invalid };
    return { ok: true, value: fields };
  },
  summarize: (payload) => `declare campaign "${String(payload?.name ?? '?').slice(0, 120)}" for ${String(payload?.company ?? payload?.companyId ?? payload?.brand ?? '?').slice(0, 60)}`,
  execute: async (fields, { connection } = {}) => {
    const ctx = await campaignContextFor(connection?.walletAddress);
    const campaign = await (await benchOf(connection)).add(declaredOf(fields), ctx, laneOf(connection));
    return { ok: true, detail: `Declared [${campaign.id.slice(0, 8)}] ${campaign.name} (${campaign.companyId}) — ${campaign.status}; ${campaign.angles.length} angle(s), ${campaign.subs.length} sub(s).` };
  },
});

export const campaignUpdateIntent = campaignIntent({
  name: 'campaigns/update',
  policyTool: 'campaigns.update',
  fieldsForPrompt: '{id, name?, company?, status?, goal?, kpi?, window?, budget?, angles?, subs?, cadence?, marketingPlan?, funnelPlan?, notes?}',
  descriptionForPrompt: `Edit a campaign on the house bench — only the fields you pass change; angles and subs are replaced whole when passed. ${SHAPE_WORDS} cadence is the SCHEDULE in one line (max 200 chars); reasoning and research belong in marketingPlan/notes. The id campaign_list shows — its first 8 characters are enough. Every change lands in the campaign's change log. Marketing is the CMO's office: if you are not on the marketing team, leave campaign work to them.`,
  validate: async (payload) => {
    const id = typeof payload?.id === 'string' ? payload.id.trim() : '';
    if (!id) return { ok: false, status: 'invalid', reason: 'campaigns/update needs the campaign id (campaign_list shows them; a prefix is enough)' };
    return { ok: true, value: { ...payload, id } };
  },
  summarize: (payload) => `update campaign ${String(payload?.id ?? '?').slice(0, 12)}${payload?.status ? ` → ${payload.status}` : ''}`,
  execute: async (fields, { connection } = {}) => {
    const bench = await benchOf(connection);
    const ctx = await campaignContextFor(connection?.walletAddress);
    const result = await bench.update(await resolveCampaignId(bench, fields.id), declaredOf(fields), ctx, laneOf(connection));
    if (!result.ok) return { ok: false, reason: result.error };
    const c = result.campaign;
    return { ok: true, detail: `Updated [${c.id.slice(0, 8)}] ${c.name} (${c.companyId || 'UNSORTED'}) — now ${c.status}.` };
  },
});

// THE SHARED PAGE (campaign plan §3.2): the CMO's asks to the operator land on
// the campaign and wait in WAITING ON YOU; the operator's asks to the CMO are
// answered here. A word to the operator, nothing outward — no card — but the
// side is the CMO's, so only the house's seated CMO files it.
export const campaignAskIntent = campaignIntent({
  name: 'campaigns/ask',
  policyTool: 'campaigns.ask',
  fieldsForPrompt: '{id, text} to ask the operator · {id, askId, answer} to answer an ask the operator put to you',
  // Offered to the house's seated CMO alone — no other lane carries its words.
  availableFor: async ({ laneId, connection }) => (laneId && await cmoDesignation.holds(connection?.walletAddress, laneId) ? {} : null),
  descriptionForPrompt: 'The campaign as the shared page between you and your operator. {id, text}: ask the operator something this campaign needs (a decision, a fact, a file) — it waits in their WAITING ON YOU until answered. {id, askId, answer}: answer an ask your operator put to you (campaign_list shows open asks). CMO\'s office: only the designated CMO files asks.',
  validate: async (payload, { connection } = {}) => {
    if (!(await cmoDesignation.holds(connection?.walletAddress, laneOf(connection) || null))) {
      return { ok: false, status: 'denied', reason: 'only the designated CMO speaks on a campaign\'s asks — ask your operator who holds the office' };
    }
    const id = typeof payload?.id === 'string' ? payload.id.trim() : '';
    const askId = typeof payload?.askId === 'string' ? payload.askId.trim() : '';
    const words = String((askId ? payload?.answer : payload?.text) ?? '').trim();
    if (!id || (!askId && !words)) return { ok: false, status: 'invalid', reason: 'campaigns/ask needs {id, text} to ask, or {id, askId, answer} to answer' };
    return { ok: true, value: { id, askId, words } };
  },
  summarize: (payload) => (payload?.askId ? `answer ask ${String(payload.askId).slice(0, 8)}` : `ask the operator: ${String(payload?.text ?? '').slice(0, 80)}`),
  execute: async ({ id, askId, words }, { connection } = {}) => {
    const bench = await benchOf(connection);
    const campaignId = await resolveCampaignId(bench, id);
    const result = askId
      ? await bench.settleAsk(campaignId, askId, { side: 'cmo', by: laneOf(connection), answer: words })
      : await bench.ask(campaignId, { from: 'cmo', text: words, by: laneOf(connection) });
    if (!result.ok) return { ok: false, reason: result.error };
    return { ok: true, detail: askId ? 'Answered — the operator sees it on the campaign.' : 'Asked — it waits in your operator\'s WAITING ON YOU until answered.' };
  },
});
