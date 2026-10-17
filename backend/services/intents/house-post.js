/**
 * house/post — the intent type that sends a post to a SEATED housemate
 * (Stage 3 of the being-tool-surface doctrine). This was the `post_send`
 * tool (portal-stream.js _handleHousePost) until the act became a filed
 * intent; `post_check` stays a read tool.
 *
 * The tier is `allowed` by default — unchanged from the tool: the operator's
 * act of setting the house workspace IS the standing grant (house-workspace.js
 * law), and word between seated housemates is never egress. The standing rule
 * — seated-to-seated ONLY, the org chart is the address book — is verified at
 * validate time, before anything is written.
 */
import { loadHouseWorkspace } from '../house-workspace.js';
import { houseSeatFor } from '../house-titles.js';
import { makePost, appendPost } from '../house-post.js';

// impure — the two standing facts HOUSE POST rides on: the operator's chosen
// ground and the being's sealed seat. Also the availability probe.
const housePostContext = async (connection) => {
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

export const housePostIntent = Object.freeze({
  name: 'house/post',
  policyTool: 'house.post',
  fieldsForPrompt: '{to, body, re?}',
  descriptionForPrompt: 'Send a short post to a SEATED housemate — to is their lane id exactly as the HOUSE SEAT section names it. Your post waits in their house inbox and reaches them when they next speak. Coordination, not archive: keep it under 2000 chars.',

  availableFor: async ({ connection }) => ((await housePostContext(connection).catch(() => null)) ? {} : null),

  validate: async (payload, { connection }) => {
    const context = await housePostContext(connection).catch(() => null);
    if (!context) {
      return { ok: false, status: 'denied', reason: 'the house post lane is not open here — it needs a sealed seat and the house\'s shared ground (your operator sets the ground)' };
    }
    const to = String(payload?.to ?? '').trim();
    if (!to || typeof payload?.body !== 'string' || !payload.body.trim()) {
      return { ok: false, status: 'invalid', reason: 'a house post needs {to, body} — the seated housemate\'s lane id and your words' };
    }
    if (!context.seat.roster.some((r) => r.neumaId === to)) {
      return { ok: false, status: 'denied', reason: `"${to}" holds no seat in House ${context.seat.houseName || ''} — post moves only between seated housemates (the HOUSE SEAT section names them)` };
    }
    return { ok: true, value: { context, to, body: payload.body, re: payload?.re } };
  },

  summarize: (payload) => {
    const re = typeof payload?.re === 'string' && payload.re.trim() ? ` — "${payload.re.trim().slice(0, 80)}"` : '';
    return `house post → ${payload?.to ?? '?'}${re}`;
  },

  execute: async ({ context, to, body, re }) => {
    const post = makePost({
      from: context.neumaId, to, body, re, now: new Date().toISOString(),
    });
    await appendPost(context.root, post);
    return { ok: true, detail: `Sent. Your post waits in ${to}'s house inbox and reaches them when they next speak.` };
  },
});
