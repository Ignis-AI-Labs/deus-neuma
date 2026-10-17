// campaign-refresh — which acts change what the campaign board is showing.
//
// Founder, live 2026-07-27, with a screenshot: a witness declared the campaign
// […] on the X space and reported it created; the CAMPAIGNS
// panel went on rendering the list it had fetched at mount and said
// […] Both were telling the truth about
// different moments, which is the worst kind of wrong: the board looked
// confident and was stale.
//
// The panel re-reads on mount and after the OPERATOR's own edits. Nothing told
// it when a BEING acted — no campaign event existed anywhere in the codebase.
// This is the same hole `files-refresh.js` closed for the Explorer, and it is
// closed the same way, deliberately: one pattern for […], not two.
//
// Pure decision, so the one-on-one portal and any future surface share one rule
// instead of drifting apart.

// Acts that CHANGE the bench or its calendar. A read never does — refreshing
// because somebody LISTED the campaigns would put the board in a loop during
// ordinary work, for no visible gain (`campaign_list` and `queue_list` are
// exactly the reads a being makes most).
const MUTATING_TOOLS = new Set([
  'campaign_create', 'campaign_update', 'campaign_remove',
  // The calendar under each campaign is drawn from the post queue, so
  // cancelling a staged post changes what this board shows too.
  'queue_cancel',
  // A settled social/queue INTENT staged a draft (Stage 2: staging is a filed
  // intent, settled by the sweep — its chip arrives as `intents/social.queue`).
  'social.queue',
]);

// The queue's remaining tools are CHANNEL-PARAMETERIZED (`queue_reply_to_<channel>`,
// bound per entry in channel-registry). Matching `queue_reply_to_x` exactly
// would have quietly stopped working the day a second poster channel shipped —
// bluesky, mastodon, discord — reintroducing the same confident-stale board
// this module exists to kill, one channel over. `queue_reply_to_<channel>` is
// the reply lane's staging tool: a staged answer changes the REPLIES tab the
// same way a staged post changes QUEUED. `queue_update_to_` /
// `queue_bulk_update_to_` are the edit lane (#208): an edited post changes
// what the board shows exactly as much as a staged one.
const MUTATING_PREFIXES = ['queue_reply_to_', 'queue_update_to_', 'queue_bulk_update_to_'];

/**
 * Did this act change the campaign board? Pure.
 *
 * @param {{tool?: string, status?: string, ok?: boolean}} act
 *   a `tool:usage` frame
 * @returns {boolean}
 */
export const changesCampaigns = (act) => {
  if (!act || typeof act !== 'object') return false;
  // A refused or errored act changed nothing — refreshing on it would make a
  // denial look like a change.
  if (act.ok === false) return false;
  if (act.status && act.status !== 'ok') return false;
  // `server/tool` or a bare tool name — both reach this from different frames.
  const tool = String(act.tool || '').split('/').pop().toLowerCase();
  return MUTATING_TOOLS.has(tool) || MUTATING_PREFIXES.some((p) => tool.startsWith(p));
};

/**
 * impure — tell every mounted campaign surface that the bench moved.
 * A no-op for acts that changed nothing, so callers can hand it every frame.
 * @param {object} act - a `tool:usage` frame
 */
export const announceCampaignChange = (act) => {
  if (!changesCampaigns(act)) return;
  window.dispatchEvent(new CustomEvent('neuma:campaigns-changed'));
};
