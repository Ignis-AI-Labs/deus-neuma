// queue-board.js — the campaigns board's ordering law: the operator's board
// order, the sections and lanes, the lane groups, and the inbound reply
// ordering. Pure throughout. Split from campaigns-helpers.js (size law),
// which re-exports everything here so readers and path-pinned tests hold.

// THE OPERATOR'S BOARD ORDER.
//
// Design note, 2026-07-27, looking at two withdrawn posts sitting above the one post
// actually waiting on him: […]
// The board did not sort at all — it rendered whatever order the array arrived
// in, which is the order things were staged, which puts the oldest dead copy
// first and pushes the live decision below the fold.
//
// The being's view already ranks (formatQueueForBeing) but answers a DIFFERENT
// question — […] — so it leads with `approved`. The
// operator's board answers […], so it leads with the drafts. The
// two orders are deliberately not the same, and neither is a copy of the other.
// (They cannot literally share a module: this is frontend, that is backend.)

/** Is this entry finished — history rather than a task? Pure. */
export const isSettled = (status) =>
  ['sent', 'failed', 'rejected', 'withdrawn', 'retracted'].includes(String(status || ''));

// Lower sorts first. `failed` sits with the settled deliberately: it is history
// carrying its own reason, not a task, and promoting it would push the decision
// the operator actually owes back down the page.
const STANDING_RANK = Object.freeze({
  draft: 0,     // AWAITS YOUR DECISION — the only thing blocked on a human
  approved: 1,  // will send on its own
  sending: 2,   // in flight
});
const SETTLED_RANK = 3;

/**
 * Order the queue for the operator's board: what needs a decision first, what
 * is finished last. Within a group, by scheduled time then creation time, so
 * the order is TOTAL and stable rather than dependent on array arrival.
 *
 * Pure — returns a new array; the input is never mutated.
 * @param {Array<object>} entries
 * @returns {Array<object>}
 */
export const orderQueueForBoard = (entries) => {
  const rank = (e) => STANDING_RANK[e?.status] ?? SETTLED_RANK;
  const at = (e) => {
    const t = Date.parse(e?.scheduledFor || e?.createdAt || '');
    return Number.isNaN(t) ? Infinity : t; // undated sinks within its group
  };
  return [...(entries || [])].sort((a, b) =>
    rank(a) - rank(b) || at(a) - at(b) || String(a?.id).localeCompare(String(b?.id)));
};

// THE SECTIONS, then THE LANES.
//
// Design note, 2026-08-06: […] KIND is the first split — a reply is a different
// act from a post (it answers a person, it rides no calendar, approving it IS
// the send) — and STANDING is the second, inside each section. The old strip
// mixed the two axes in one row of five tabs (QUEUED/REPLIES/UNAPPROVED/
// WITHDRAWN/SENT), which is exactly the confusion this removes.
//
// Ordering answered […]. Lanes answer […]. Sections answer […].

/** The two sections — the board's primary split. Every entry belongs to
 *  exactly one. */
export const QUEUE_SECTIONS = Object.freeze([
  { id: 'posts', label: 'POSTS' },
  { id: 'replies', label: 'REPLIES' },
]);

/** Which section an entry belongs to (pure). A self-reply is house-authored
 *  THREAD copy riding its parent's calendar — POSTS, not an answer to
 *  inbound. Only kind==='reply' is the replies section's. */
export const sectionOf = (entry) => (entry?.kind === 'reply' ? 'replies' : 'posts');

/** The POSTS lane strip, in order. `note`/`empty` are keyed by section;
 *  REPLIES speaks through its own buckets (reply-board.js). */
export const QUEUE_LANES = Object.freeze([
  {
    id: 'queued',
    label: 'QUEUED',
    note: Object.freeze({
      posts: 'Nothing goes out until you approve it — an approved post then sends at its own time.',
    }),
    empty: Object.freeze({
      posts: 'Nothing staged. Write one below.',
    }),
  },
  {
    id: 'sent',
    label: 'SENT',
    note: Object.freeze({
      posts: 'Delivery is over, one way or the other. This history is permanent.',
    }),
    empty: Object.freeze({
      posts: 'Nothing has gone out yet.',
    }),
  },
  {
    id: 'withdrawn',
    label: 'WITHDRAWN',
    note: Object.freeze({
      posts: 'Pulled back or declined before it sent. REVISE reopens copy as a fresh draft; the record itself stands.',
    }),
    empty: Object.freeze({
      posts: 'Nothing withdrawn or declined.',
    }),
  },
]);

// `sending` and `failed` are the two standings the three lanes do not name.
// Both are defaults, both deliberate, both one line to move:
//   sending  → QUEUED. It IS decided and in flight — not history yet. It
//     keeps its own SENDING… tag, so the group never misreads it.
//   failed   → SENT. It was not withdrawn (nobody pulled it) and not queued
//     (it is terminal). SENT is the DELIVERY OUTCOME lane, so a failed
//     delivery belongs to it — and it leads that lane rather than sinking
//     under the successes, because a failure usually means keys or rate
//     limits and wants an eye.
//   rejected → WITHDRAWN (2026-08-06, with the section split): both are
//     […]; the DECLINED group header
//     and the entry's own chip keep the two acts distinct in the record.
const LANE_OF = Object.freeze({
  draft: 'queued',
  approved: 'queued',
  sending: 'queued',
  rejected: 'withdrawn',
  withdrawn: 'withdrawn',
  // A post taken back after it went out (queue-retract.js) sits with what was pulled.
  retracted: 'withdrawn',
  sent: 'sent',
  failed: 'sent',
});

/** Which lane a standing belongs to. An unrecognised status lands in QUEUED
 *  rather than vanishing — a lane the operator watches beats a silent drop. */
// pure
export const laneOf = (status) => LANE_OF[String(status || '')] || 'queued';

/**
 * Split the queue into its two sections, each split into its lanes, each in
 * board order.
 *
 * TOTAL by construction: every entry lands in exactly one (section, lane), so
 * switching tabs can never lose a post — the property the old single-level
 * split proved, carried up a level.
 *
 * Pure — the input is never mutated.
 * @param {Array<object>} entries
 * @returns {Record<string, Record<string, Array<object>>>} sections[sectionId][laneId]
 */
export const splitQueueIntoSections = (entries) => {
  const sections = Object.fromEntries(QUEUE_SECTIONS.map((s) => [
    s.id, Object.fromEntries(QUEUE_LANES.map((l) => [l.id, []])),
  ]));
  for (const entry of orderQueueForBoard(entries)) {
    sections[sectionOf(entry)][laneOf(entry?.status)].push(entry);
  }
  return sections;
};

/** The one name for the decision group — the board's decision block carries
 *  the same words, from the same constant, so the two can never drift. */
export const AWAITING_LABEL = 'AWAITING YOUR APPROVAL';

// A lane's inner headings, per (section, lane). `named` groups are matched in
// order and `rest` catches everything else — so the split stays total even
// for a standing nobody has thought of yet, without a branch that can never
// run. A lane with no spec is one list with no header — a header over the
// only group is noise.
const LANE_GROUPS = Object.freeze({
  // Founder: […]
  'posts/queued': {
    named: [{ key: 'awaiting', label: AWAITING_LABEL, has: (s) => s === 'draft' }],
    rest: 'APPROVED — sends on its own',
  },
  // A reply's queued lane holds the answers that need you, then whatever is
  // mid-flight this instant (or a legacy pre-law slot — the card's own meta
  // line names that honestly).
  'replies/queued': {
    named: [{ key: 'awaiting', label: AWAITING_LABEL, has: (s) => s === 'draft' }],
    rest: 'IN FLIGHT',
  },
  'posts/sent': {
    named: [{ key: 'failed', label: 'DID NOT SEND', has: (s) => s === 'failed' }],
    rest: 'SENT',
  },
  'replies/sent': {
    named: [{ key: 'failed', label: 'DID NOT SEND', has: (s) => s === 'failed' }],
    rest: 'SENT',
  },
  // The two distinct acts share the lane, never a header: declined was the
  // operator's verdict, withdrawn was a pull-back (or the system's expiry).
  'posts/withdrawn': {
    named: [{ key: 'declined', label: 'DECLINED', has: (s) => s === 'rejected' }],
    rest: 'WITHDRAWN',
  },
  'replies/withdrawn': {
    named: [{ key: 'declined', label: 'DECLINED', has: (s) => s === 'rejected' }],
    rest: 'WITHDRAWN',
  },
});

/**
 * Split one (section, lane)'s entries into its labelled groups, dropping
 * empty ones. Relative order is preserved, so the lane stays in board order
 * inside a group.
 *
 * Pure.
 * @param {string} sectionId
 * @param {string} laneId
 * @param {Array<object>} entries already ordered
 * @returns {Array<{key: string, label: string|null, entries: Array<object>}>}
 */
export const splitLaneIntoGroups = (sectionId, laneId, entries) => {
  const spec = LANE_GROUPS[`${sectionId}/${laneId}`] || { named: [], rest: null };
  const buckets = [
    ...spec.named.map((g) => ({ key: g.key, label: g.label, entries: [] })),
    { key: 'rest', label: spec.rest, entries: [] },
  ];
  for (const entry of entries || []) {
    const at = spec.named.findIndex((g) => g.has(String(entry?.status || '')));
    buckets[at === -1 ? buckets.length - 1 : at].entries.push(entry);
  }
  return buckets.filter((b) => b.entries.length > 0);
};

// THE INBOUND HALF (Design note, 2026-07-28: […]). The REPLIES tab is where the
// operator meets WHO KNOCKED — the replies to the house's own posts — not
// just the answers already staged. Its buckets (unanswered, staged, answered,
// bin) and order are core/social/reply-inbox.js, the same law the being's
// replies_list reads; the desk's strip is RepliesBoard.jsx.

/** The candidate's disposition as one honest board word (pure). */
export const replyDispositionLabel = (disposition) => ({
  none: 'UNANSWERED',
  staged: 'ANSWER STAGED',
  approved: 'ANSWER APPROVED',
  sent: 'ANSWERED',
  dismissed: 'SET ASIDE',
}[String(disposition || 'none')] || 'UNANSWERED');

/** Does this candidate still ask for the house's attention? (pure) */
export const replyNeedsAttention = (c) =>
  !!c && !c.dismissed && String(c.disposition || 'none') === 'none';
