// waiting-fold.js — everything waiting on the operator, as one list: what it
// is, who asks, where it lives, how long it has waited. Pure.
//
// The sources (waiting-sources.js) each speak their own store's shape; these
// functions turn each into ONE item shape the desk draws, and fold the lot
// into the count and the order the desk shows (SHINKEI: the count is the
// true count — every item counted is an item listed). Oldest first: the
// longest wait stands at the top.

const TEXT_MAX = 280;

/**
 * @typedef {object} WaitingItem
 * @property {string} id - unique across sources (`<source>:<id>`)
 * @property {string} kind - approval | ask | plan | seal | house-ask | charter | post | reply | proposal | campaign-ask | link-change
 * @property {string} title - what is asked, in the asker's words
 * @property {?{laneId: string, name: ?string}} who - the being that asks (null: the house itself)
 * @property {object} where - the deep link: `app` plus what that window needs to land on it
 * @property {string} at - ISO time the wait began
 * @property {?string} [text] - the copy a decision approves, whole (queue entries)
 * @property {boolean} [oneTap] - approval is one press with nothing hidden (queue entries)
 */

const who = (laneId, names) => (laneId ? { laneId, name: names.get(laneId) ?? null } : null);
const isoOr = (value, fallback) => (typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : fallback);

/**
 * A live chat card (live-cards.js) as an item. A council card lives in the
 * council room; every other one in the sitting that raised it.
 * @param {object} card
 * @returns {WaitingItem}
 */
export const liveCardItem = (card) => Object.freeze({
  id: `card:${card.id}`,
  kind: card.kind,
  title: card.title,
  who: card.laneId ? { laneId: card.laneId, name: card.name ?? null } : null,
  where: card.surface === 'council'
    ? { app: 'council', cardId: card.id }
    : { app: 'chat', cardId: card.id, sessionId: card.sessionId, neumaId: card.laneId, name: card.name, beingKind: card.beingKind },
  at: card.at,
});

const ASK_TITLE = Object.freeze({
  act: (a) => `${a.tool || 'an act'}${a.why ? ` — ${a.why}` : ''}`,
  plan: (a) => `a plan${a.why ? ` — ${a.why}` : ''}`,
  decision: (a) => a.question || a.why || 'a decision',
});

/**
 * An open house ask (house-clock/wake-ledger.js) as an item.
 * @param {object} ask
 * @param {Map<string, string>} names - laneId → name
 * @returns {WaitingItem}
 */
export const houseAskItem = (ask, names) => Object.freeze({
  id: `house-ask:${ask.id}`,
  kind: 'house-ask',
  title: String((ASK_TITLE[ask.kind] || ASK_TITLE.decision)(ask)).slice(0, TEXT_MAX),
  who: who(ask.seat, names),
  where: { app: 'houseclock', tab: 'asks', askId: ask.id },
  at: isoOr(ask.at, new Date(0).toISOString()),
});

/**
 * A charter version written and not yet approved, as an item.
 * @param {object} charter
 * @returns {WaitingItem}
 */
export const charterItem = (charter) => Object.freeze({
  id: `charter:${charter.version}`,
  kind: 'charter',
  title: `the house charter, version ${charter.version}${charter.goal ? ` — ${String(charter.goal).slice(0, 160)}` : ''}`,
  who: null,
  where: { app: 'houseclock', tab: 'charter' },
  at: isoOr(charter.updatedAt, new Date(0).toISOString()),
});

/**
 * Whether approving this queue draft is one press with nothing hidden: no
 * platform card of choices (TikTok), no image the approver would not see, no
 * thread whose other posts ride the decision. Pure.
 * @param {object} entry
 * @param {ReadonlyArray<object>} entries - the house's queue (to find thread children)
 * @returns {boolean}
 */
export const queueOneTap = (entry, entries) => entry.channelId !== 'tiktok'
  && !(Array.isArray(entry.media) && entry.media.length)
  && entry.kind !== 'self-reply'
  && !entry.thread
  && !entries.some((e) => e.thread?.parentId === entry.id);

/**
 * A queue draft awaiting the operator (social/post-queue.js) as an item.
 * @param {object} entry
 * @param {ReadonlyArray<object>} entries
 * @param {Map<string, string>} names
 * @returns {WaitingItem}
 */
export const queueItem = (entry, entries, names) => {
  const reply = entry.kind === 'reply';
  const text = String(entry.text || '').slice(0, TEXT_MAX);
  return Object.freeze({
    id: `queue:${entry.id}`,
    kind: reply ? 'reply' : 'post',
    title: reply && entry.reply?.toUsername ? `answer to @${entry.reply.toUsername}` : text.slice(0, 120),
    who: who(entry.authorNeumaId, names),
    where: { app: entry.channelId, channelId: entry.channelId, entryId: entry.id, section: reply ? 'replies' : 'posts' },
    at: isoOr(entry.createdAt, new Date(0).toISOString()),
    text,
    oneTap: queueOneTap(entry, entries),
  });
};

/** A queue entry that waits on the operator: a real draft, never a placeholder. Pure. */
export const isQueueDecision = (entry) => entry?.status === 'draft' && !entry.placeholder;

/**
 * An open sovereignty proposal (sovereignty/proposal-store.js) as an item.
 * @param {object} proposal
 * @param {string} neumaId
 * @param {Map<string, string>} names
 * @returns {WaitingItem}
 */
export const proposalItem = (proposal, neumaId, names) => Object.freeze({
  id: `proposal:${neumaId}:${proposal.id}`,
  kind: 'proposal',
  title: String(proposal.title || 'a proposal about itself').slice(0, TEXT_MAX),
  who: who(neumaId, names),
  where: { app: 'sovereignty', neumaId, proposalId: proposal.id },
  at: isoOr(proposal.submittedAt, new Date(0).toISOString()),
});

/**
 * The CMO's open ask on a campaign (marketing/campaign-asks.js) as an item —
 * the campaign is the shared page, and an ask on it waits on the operator.
 * @param {object} ask
 * @param {{id: string, name: string}} campaign
 * @param {Map<string, string>} names
 * @returns {WaitingItem}
 */
export const campaignAskItem = (ask, campaign, names) => Object.freeze({
  id: `campaign-ask:${campaign.id}:${ask.id}`,
  kind: 'campaign-ask',
  title: `${String(campaign.name || 'a campaign').slice(0, 80)}: ${String(ask.text || '')}`.slice(0, TEXT_MAX),
  who: who(ask.by, names),
  where: { app: 'marketing', campaignId: campaign.id, askId: ask.id },
  at: isoOr(ask.at, new Date(0).toISOString()),
});

/**
 * The CMO's proposed change to a company's links (marketing/link-changes.js)
 * as an item — it lands on that company's SITE & CODE, where its card shows
 * the change before → after.
 * @param {{id: string, at: string, laneId: string, companyId: string, title: string}} change
 * @param {Map<string, string>} names
 * @returns {WaitingItem}
 */
export const linkChangeItem = (change, names) => Object.freeze({
  id: `link-change:${change.id}`,
  kind: 'link-change',
  title: String(change.title || 'a company\'s links').slice(0, TEXT_MAX),
  who: who(change.laneId, names),
  where: { app: 'marketing', tab: 'brand', companyId: change.companyId, section: 'sources', changeId: change.id },
  at: isoOr(change.at, new Date(0).toISOString()),
});

/**
 * The whole account: the true count, the oldest wait, and every item, the
 * longest-waiting first (ties by id, so the order never shuffles).
 * @param {ReadonlyArray<WaitingItem>} items
 * @returns {{count: number, oldestAt: ?string, items: WaitingItem[]}}
 */
export const foldWaiting = (items) => {
  const sorted = [...items].sort((a, b) => (Date.parse(a.at) - Date.parse(b.at)) || a.id.localeCompare(b.id));
  return Object.freeze({ count: sorted.length, oldestAt: sorted[0]?.at ?? null, items: sorted });
};
