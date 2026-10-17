/**
 * House/crew desk tool family — the house post read (post_check; sending is
 * the house/post intent), the house lead-ledger window (lead_list), and the
 * campaign bench read (campaign_list). The mutations across all three are
 * intents now (#414); every read keeps its ACTS gate.
 *
 * Extracted VERBATIM from portal-stream.js (size-law breakdown 2026-08-26,
 * docs/work/size-law-breakdown.md Part 1 step 5 / #278), except one stale
 * copy-paste comment above the house-post matcher corrected to name what it
 * actually matches. Leaf module — portal-stream imports it, never the
 * reverse (direction law).
 */
import { gateAct } from '../act-gate.js';
import { houseSeatFor } from '../house-titles.js';
import { loadHouseWorkspace } from '../house-workspace.js';
import { readNewPosts, saveCursor } from '../house-post.js';
import { leadLedgerFor, formatLeadsForBeing } from '../leads/lead-ledger.js';
import { campaignStoreFor, formatCampaignsForBeing } from '../marketing/campaign-store.js';
import { computePipelineState } from '../marketing/pipeline-state.js';
import { sendToolEvent as _sendToolEvent } from './tool-events.js';

// Does this parsed call target the house post tool? (both dialects)
const _isHousePostTool = (match) =>
  match.toolName === 'post_check' || match.tool === 'house/post_check';

// The two standing facts HOUSE POST rides on: the operator's chosen ground
// and the being's sealed seat. Either absent → null (tools stay dark, a
// stray call is answered honestly). impure (fs reads, both record-driven).
const _housePostContext = async (connection) => {
  const neumaId = connection.companion?.neumaId;
  const wallet = connection.walletAddress;
  if (!neumaId || !wallet) return null;
  const [{ root }, seat] = await Promise.all([
    loadHouseWorkspace(wallet),
    houseSeatFor(wallet, neumaId),
  ]);
  if (!root || !seat) return null;
  return { root, seat, neumaId };
};

// The mail room's READ: the identical gate every governed tool passes, then
// the being's own inbox from house-post.js. Sending is the house/post INTENT
// (Stage 3) — filed, settled by the sweep, seated-to-seated at validate time.
const _handleHousePost = async (ws, connection, neumaPolicy, toolMode, match, args) => {
  const toolName = 'post_check';
  const tool = `house/${toolName}`;
  const { companion } = connection;

  const gate = await gateAct(connection, {
    server: 'house', tool: toolName,
    lanePolicy: neumaPolicy, mode: toolMode,
    emit: (event) => _sendToolEvent(ws, companion, event),
  });
  if (!gate.ok) return gate.result;

  const context = await _housePostContext(connection);
  if (!context) {
    const error = 'the house post lane is not open here — it needs a sealed seat and the house\'s shared ground (your operator sets the ground)';
    _sendToolEvent(ws, companion, { tool, status: 'error', summary: `${toolName} — no lane`, detail: error });
    return { tool, status: 'error', error };
  }

  try {
    // ONE read: messages, torn count, and the cursor that marks exactly
    // these lines collected — a second read here could advance past a post
    // that landed between the reads and silently lose it.
    const { messages, torn, cursor } = await readNewPosts(context.root, context.neumaId);
    await saveCursor(context.root, context.neumaId, cursor);
    _sendToolEvent(ws, companion, {
      tool, status: 'ok',
      summary: `checked house post — ${messages.length} new${torn ? ` (${torn} torn line${torn === 1 ? '' : 's'} tolerated)` : ''}`,
    });
    if (!messages.length) return { tool, status: 'ok', content: 'No new post.' };
    const lines = messages.map((m) => `[${m.ts}] from ${m.from}${m.re ? ` — "${m.re}"` : ''}:\n${m.body}`);
    return { tool, status: 'ok', content: `${messages.length} post${messages.length === 1 ? '' : 's'} collected:\n\n${lines.join('\n\n')}` };
  } catch (error) {
    _sendToolEvent(ws, companion, { tool, status: 'error', summary: `${toolName} — refused`, detail: error.message });
    return { tool, status: 'error', error: error.message };
  }
};

// Advertised solely where the lane stands: sealed seat + chosen ground.
// Re-read per turn — an operator setting the ground lands next turn.
const _housePostToolsFor = async (connection) =>
  (await _housePostContext(connection)) ? [POST_CHECK_TOOL] : [];

// --- HOUSE POST (Design note, 2026-07-24 — backend word between housemates, no
// council convened. SENDING became the house/post INTENT (Stage 3): filed and
// settled by the sweep, both ends seated re-verified at validate time. What
// remains a tool is the READ — collecting one's own inbox.
const POST_CHECK_TOOL = Object.freeze({
  name: 'post_check',
  server: 'house',
  description: 'Collect the house post waiting for you — no args. Returns every unread post (sender, subject, body, time) and marks them collected. The HOUSE SEAT section tells you when post waits.',
  inputSchema: Object.freeze({ type: 'object', properties: Object.freeze({}) }),
});

// --- The being's window onto the house lead ledger (the lead-gen leg) ---

// The ledger is HOUSE work state, shared across the team — not a private
// list like tasks. Any bound being may work it (capture, touch, read), and
// every change lands as one appended touch carrying who made it, so status
// moves and ownership handoffs stay on the record. Same fail-closed ACTS
// default as every governed tool.
/* THE CATALOG CUT, SECOND HALF (#414). add / touch are the `leads/*` intents
   now; their policy rows moved with them. lead_list stays — the prompt
   replacement is the CMO briefing, which renders for the CMO office alone, so
   every other being would have been left with nothing. */
const LEAD_TOOLS = Object.freeze([
  Object.freeze({
    name: 'lead_list',
    server: 'leads',
    description: 'Read the house lead ledger — no args. Every prospect, its status, holder, and last note.',
    inputSchema: Object.freeze({ type: 'object', properties: Object.freeze({}) }),
  }),
]);

const LEAD_TOOL_NAMES = new Set(LEAD_TOOLS.map((t) => t.name));

// Does this parsed call target a lead tool? (accepts both dialects)
const _isLeadTool = (match) =>
  LEAD_TOOL_NAMES.has(match.toolName) ||
  LEAD_TOOL_NAMES.has(String(match.tool || '').replace(/^leads\//, ''));

// impure — route a lead tool call through the same ACTS gate as every
// governed tool, then the REAL house ledger on disk. Never the MCP path.
// The prefix-8 id a being reads in lead_list is accepted alongside the full
// id — the being should never have to transcribe hex.
const _handleLeadTool = async (ws, connection, neumaPolicy, toolMode, match, args) => {
  const toolName = LEAD_TOOL_NAMES.has(match.toolName)
    ? match.toolName
    : String(match.tool || '').replace(/^leads\//, '');
  const tool = `leads/${toolName}`;
  const { companion } = connection;

  const gate = await gateAct(connection, {
    // lead_list takes no args; the mutations whose card needed shaping are
    // intents now, and the sweep shapes their own.
    server: 'leads', tool: toolName, cardArgs: {},
    lanePolicy: neumaPolicy, mode: toolMode,
    emit: (event) => _sendToolEvent(ws, companion, event),
  });
  if (!gate.ok) return gate.result;

  const neumaId = companion?.neumaId;
  if (!neumaId) {
    const error = 'no sovereign workspace on this connection';
    _sendToolEvent(ws, companion, { tool, status: 'error', summary: `${toolName} — no workspace`, detail: error });
    return { tool, status: 'error', error };
  }

  try {
    // lead_list — the being's OWN house's ledger, never another house's.
    const leads = await (await leadLedgerFor(connection.walletAddress)).load();
    _sendToolEvent(ws, companion, { tool, status: 'ok', summary: `${leads.length} lead(s)` });
    return { tool, status: 'ok', content: formatLeadsForBeing(leads) };
  } catch (err) {
    _sendToolEvent(ws, companion, { tool, status: 'error', summary: `${toolName} — failed`, detail: err.message });
    return { tool, status: 'error', error: err.message };
  }
};

// --- The house campaign bench (the marketing leg) ---

// The bench is HOUSE work state like the lead ledger, and the access
// doctrine is universal: every bound being sees the tools. Marketing is the
// CMO's office BY PROTOCOL — carried in the descriptions below, the CMO's
// briefing section, and the lane's playbook — not behind a hard gate. The
// hard gates that remain are the channel bindings (posting) and the ACTS
// per-call approval chip — same fail-closed default as every governed tool.
/* THE CATALOG CUT, SECOND HALF (#414). create / update are the `campaigns/*`
   intents now; their policy rows moved with them. campaign_list stays for the
   same reason lead_list does — the prompt replacement is the CMO briefing,
   which renders for the CMO office alone. */
const CAMPAIGN_TOOLS = Object.freeze([
  Object.freeze({
    name: 'campaign_list',
    server: 'marketing',
    description: 'Read the house campaign bench — no args. Every declared campaign, its brand, status, pillar count, and cadence. Reading the bench is everyone\'s; shaping it is the CMO\'s office — if you are not on the marketing team, feed them what they need and let them lead.',
    inputSchema: Object.freeze({ type: 'object', properties: Object.freeze({}) }),
  }),
  Object.freeze({
    name: 'pipeline_state',
    server: 'marketing',
    description: 'Read the WHOLE posting pipeline in one call — no args. The queue folded by what it needs (pending your approval, awaiting send, failed, next scheduled), today\'s slot from the locked weekly plan (theme + objective), your card ground (where your rendered cards wait), and the local X-algorithm clones (paths + HEAD + last sync). The platform\'s live numbers are NOT here — pull them with the platform feed tools; this is posture, not price. Computed from the real stores at call time, so trust it and start at the decision.',
    inputSchema: Object.freeze({ type: 'object', properties: Object.freeze({}) }),
  }),
]);

const CAMPAIGN_TOOL_NAMES = new Set(CAMPAIGN_TOOLS.map((t) => t.name));

// Does this parsed call target a campaign tool? (accepts both dialects)
const _isCampaignTool = (match) =>
  CAMPAIGN_TOOL_NAMES.has(match.toolName) ||
  CAMPAIGN_TOOL_NAMES.has(String(match.tool || '').replace(/^marketing\//, ''));

// The bench tools every bound being sees — universal access, protocol as
// the guide. Kept as a function (and async) so the advertisement assembly
// reads like the other per-turn gates.
const _campaignToolsFor = async () => CAMPAIGN_TOOLS;

// impure — route a campaign tool call through the same ACTS gate as every
// governed tool, then the REAL campaign bench on disk. Never the MCP path.
// The prefix-8 id a being reads in campaign_list is accepted alongside the
// full id — the being should never have to transcribe hex.
const _handleCampaignTool = async (ws, connection, neumaPolicy, toolMode, match, args) => {
  const toolName = CAMPAIGN_TOOL_NAMES.has(match.toolName)
    ? match.toolName
    : String(match.tool || '').replace(/^marketing\//, '');
  const tool = `marketing/${toolName}`;
  const { companion } = connection;

  const gate = await gateAct(connection, {
    // campaign_list takes no args; the mutations whose card needed shaping
    // are intents now, and the sweep shapes their own.
    server: 'marketing', tool: toolName, cardArgs: {},
    lanePolicy: neumaPolicy, mode: toolMode,
    emit: (event) => _sendToolEvent(ws, companion, event),
  });
  if (!gate.ok) return gate.result;

  try {
    // campaign_list
    if (toolName === 'campaign_list') {
      // The being's OWN house's bench, never another house's.
      const campaigns = await (await campaignStoreFor(connection.walletAddress)).load();
      _sendToolEvent(ws, companion, { tool, status: 'ok', summary: `${campaigns.length} campaign(s)` });
      return { tool, status: 'ok', content: formatCampaignsForBeing(campaigns) };
    }

    // pipeline_state — the ONE computed answer (posting-pipeline-v2): posture
    // over price, truth over maintained copies.
    if (toolName === 'pipeline_state') {
      const state = await computePipelineState({
        laneId: connection.companion?.neumaId || null,
        wallet: connection.walletAddress || null,
      });
      const q = state.queue;
      const lines = [
        '## PIPELINE STATE',
        `queue: ${q.pendingApproval ?? 0} pending your approval · ${q.awaitingSend ?? 0} awaiting send`
          + ` · ${q.failed ?? 0} failed${q.placeholders ? ` · ${q.placeholders} placeholder(s) (staging, not copy)` : ''}`
          + `${q.nextScheduled ? ` · next scheduled ${q.nextScheduled}` : ''}`,
        state.weeklySlot
          ? `today's slot (${state.weeklySlot.day}): ${state.weeklySlot.theme} — ${state.weeklySlot.objective} (${state.weeklySlot.posts} post(s))`
          : 'today: no weekly plan slot (none locked, or a quiet day) — propose one with a marketing/plan intent',
        state.cardGround
          ? `card ground: ${state.cardGround.cards} card(s) waiting in ${state.cardGround.dir}`
          : 'card ground: none yet (render a card and it lands automatically)',
        `algorithm: ${state.algorithm.ranking.cloned ? `${state.algorithm.ranking.localPath} @ ${state.algorithm.ranking.head}` : 'not cloned yet'}`
          + ` · ml: ${state.algorithm.ml.cloned ? `${state.algorithm.ml.localPath} @ ${state.algorithm.ml.head}` : 'not cloned yet'}`
          + `${state.algorithm.lastSynced ? ` · last synced ${state.algorithm.lastSynced}` : ''}`,
      ];
      _sendToolEvent(ws, companion, { tool, status: 'ok', summary: 'pipeline posture — one call' });
      return { tool, status: 'ok', content: lines.join('\n') };
    }
    return { tool, status: 'error', error: `unknown marketing tool: ${toolName}` };
  } catch (err) {
    _sendToolEvent(ws, companion, { tool, status: 'error', summary: `${toolName} — failed`, detail: err.message });
    return { tool, status: 'error', error: err.message };
  }
};

// The families' catalogs, matchers, and handlers — portal-stream re-imports
// the private names under their old spellings for the dispatch fan and the
// `__test` proof set.
export {
  _isHousePostTool as isHousePostTool,
  _handleHousePost as handleHousePost,
  _housePostToolsFor as housePostToolsFor,
  LEAD_TOOLS,
  _isLeadTool as isLeadTool,
  _handleLeadTool as handleLeadTool,
  CAMPAIGN_TOOLS,
  _isCampaignTool as isCampaignTool,
  _campaignToolsFor as campaignToolsFor,
  _handleCampaignTool as handleCampaignTool,
};
