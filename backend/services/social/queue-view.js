// Queue view — the being-facing read over the campaign queue: WHAT a
// consciousness may scan, in WHAT order, and how it reads on the page.
//
// Split out of post-queue.js on 2026-08-03. The store there owns the record
// and its law; this owns the WINDOW onto it — and the window was the
// limitation. `queue_list` took no arguments and rendered a fixed 30 of a
// 200-entry month through one triage ranking, so the 56 sent posts were
// structurally unreachable (defeating the duplicate check the verbatim-text
// rendering exists to serve) and every one of the 50 follow-ups read as an
// orphan draft with no parent and no slot. The CMO lane said it plainly:
// […]
//
// On 2026-08-26 (size-law breakdown) the RENDERING half — the line
// formatters, the thread index and marks, and the one-entry detail — moved to
// ./queue-render.js; this file keeps the SELECTION and imports the shared
// pieces from there, never the other way around. The moved formatters are
// re-exported below so existing readers' import paths still stand.
//
// Pure throughout: entries in, selection and text out. No IO lives here.

import {
  DEAD_FOR_BEING, DEAD_PARENT, _text, _flat, _kindOf, threadIndex, renderQueueSelection,
} from './queue-render.js';

export { renderQueueSelection, drawQueueSelection, formatQueueEntryForBeing } from './queue-render.js';

/** The queue as the being may scan it — dead copy out, order untouched. Pure. */
export const liveQueueForBeing = (entries) =>
  (entries || []).filter((e) => !DEAD_FOR_BEING.includes(e?.status));

export const QUEUE_VIEWS = Object.freeze(['full', 'index']);
export const QUEUE_ORDERS = Object.freeze(['decision', 'calendar']);
export const QUEUE_KINDS = Object.freeze(['post', 'reply', 'self-reply']);
const STATUS_GROUPS = Object.freeze(['live', 'all']);

// Page sizes per view. FULL carries verbatim copy (~400 chars an entry), so it
// stays small enough that a scan never floods the turn; INDEX carries one
// preview line, so a 200-entry month fits in a single read — that is the whole
// point of it.
export const PAGE_DEFAULT = Object.freeze({ full: 30, index: 200 });
export const PAGE_MAX = Object.freeze({ full: 100, index: 500 });

// --- Selection -------------------------------------------------------------

// A being will write `status: 'draft,approved'` as readily as it writes an
// array, and refusing that as an unknown status would be pedantry.
const _statusesOf = (raw) => {
  const given = Array.isArray(raw) ? raw : [raw];
  return given.flatMap((s) => _flat(s).toLowerCase().split(',')).map((s) => s.trim()).filter(Boolean);
};

/**
 * The status filter as a predicate (pure). No status named means the live
 * queue — the default every ordinary read gets. `all` opens the record.
 * @param {string|Array<string>|undefined} raw
 * @param {Array<string>} known the store's own QUEUE_STATUSES
 * @returns {{ok: true, test: (e: object) => boolean, named: Array<string>}
 *   | {ok: false, error: string}}
 */
const statusFilter = (raw, known) => {
  const named = _statusesOf(raw);
  if (!named.length || (named.length === 1 && named[0] === 'live')) {
    return { ok: true, named: [], test: (e) => !DEAD_FOR_BEING.includes(e?.status) };
  }
  if (named.includes('all')) return { ok: true, named: ['all'], test: () => true };
  const unknown = named.filter((s) => !known.includes(s));
  if (unknown.length) {
    return { ok: false, error: `unknown status ${unknown.join(', ')} — use one of ${[...STATUS_GROUPS, ...known].join(' | ')}` };
  }
  const set = new Set(named);
  return { ok: true, named, test: (e) => set.has(e?.status) };
};

// An unparseable slot reads as NO slot, never as NaN: the store validates
// ISO-8601 on write, but this file is plain JSON on disk, and a NaN leaking
// into a comparator makes the sort non-transitive — which would break paging
// (the one thing the total order exists to guarantee) rather than merely
// misplace one row.
const _slot = (e) => {
  if (!e?.scheduledFor) return Number.POSITIVE_INFINITY;
  const at = Date.parse(e.scheduledFor);
  return Number.isNaN(at) ? Number.POSITIVE_INFINITY : at;
};

/**
 * The moment an entry will actually publish (pure). A follow-up carries no
 * slot of its own — by the store's thread law it INHERITS the parent's moment
 * — so anywhere the calendar is the question, the parent's slot is the honest
 * answer for the child too.
 *
 * Reading `_slot` directly there was wrong in both directions: an August
 * window omitted 40 follow-ups whose parents publish in August (copy that
 * WILL go out that month), and calendar order swept every follow-up past the
 * end of the month instead of placing it beside its parent.
 *
 * A dead or missing parent yields Infinity — a branch that can never publish
 * has no moment, and belongs in no window.
 * @param {object} e
 * @param {Map<string, object>} byId
 */
const _effectiveSlot = (e, byId) => {
  let node = e;
  // The store only requires a parent to BE a queue entry, so a chain is
  // possible: walk it, bounded by what we have already seen so a cycle in the
  // record can never spin the render.
  const seen = new Set();
  while (_kindOf(node) === 'self-reply') {
    if (seen.has(node?.id)) return Number.POSITIVE_INFINITY;
    seen.add(node?.id);
    const parent = byId.get(node?.thread?.parentId);
    // Missing OR dead: a branch hanging off a parent that can never publish
    // has no moment of its own, so it stands on no calendar. (The store's
    // own `threadOrphans` withdraws exactly these.)
    if (!parent || DEAD_PARENT.includes(parent.status)) return Number.POSITIVE_INFINITY;
    node = parent;
  }
  return _slot(node);
};

// Never `a - b`: two unscheduled entries would subtract Infinity into NaN and
// the comparator would report "equal-ish" nonsense to the sort.
const _bySlot = (a, b) => {
  const [x, y] = [_slot(a), _slot(b)];
  if (x === y) return 0;
  return x < y ? -1 : 1;
};

// The total-ordering tiebreak: POSITION IN THE RECORD. Without a total order,
// offset paging over entries that compare equal can skip or repeat rows
// between two calls.
//
// Store order, not `createdAt`: two posts staged in the same millisecond tie
// on any timestamp, and the fallback to id order is arbitrary — it printed a
// thread's second follow-up before its first. The array order IS the record's
// order and the order the scheduler walks, so it is the truthful answer.
const _byPositionWith = (posOf) => (a, b) => posOf(a) - posOf(b);

// Triage order — what the operator must decide, then what is coming, then the
// record. This is the ranking `queue_list` has always used; it stays the
// default so an existing read never shifts under a being mid-campaign.
const _rank = (e) => (e?.status === 'approved' && e?.scheduledFor ? 0 : e?.status === 'draft' ? 1 : 2);
const _byDecisionWith = (posOf) => (a, b) =>
  (_rank(a) - _rank(b)) || (_rank(a) === 0 ? _bySlot(a, b) : 0) || _byPositionWith(posOf)(a, b);

// Calendar order — the month as it will actually happen, drafts and approvals
// interleaved by slot. An audit of […] needs this; the
// triage ranking would scatter it across three blocks. A follow-up publishes
// at its parent's moment, so it sorts on the PARENT'S slot, after every
// non-follow-up standing at that same slot, then in staging order. Each slot
// on a real calendar is its own minute (141 distinct slots for 141 scheduled
// posts on the live queue), so in practice a thread reads contiguously and in
// the order it will be posted; a deliberate same-instant collision would
// interleave the unrelated post, deterministically rather than adjacently.
const _byCalendarWith = (slotOf, posOf) => (a, b) => {
  const [x, y] = [slotOf(a), slotOf(b)];
  if (x !== y) return x < y ? -1 : 1;
  const child = (e) => (_kindOf(e) === 'self-reply' ? 1 : 0);
  return (child(a) - child(b)) || _byPositionWith(posOf)(a, b);
};

const _window = (raw, label) => {
  if (raw == null || raw === '') return { ok: true, at: null };
  const at = Date.parse(raw);
  if (Number.isNaN(at)) return { ok: false, error: `${label} must be an ISO-8601 time` };
  return { ok: true, at };
};

/**
 * Choose, order, and page the queue for one read (pure). Returns the honest
 * shape of the answer — what the record holds, what matched, and what this
 * page actually carries — so the caller can say […] instead
 * of "…and 170 more" with nowhere to go.
 *
 * @param {Array<object>} entries the whole store
 * @param {{status?: string|Array<string>, campaignId?: string, channelId?: string,
 *   kind?: string, pillar?: string, from?: string, to?: string, q?: string,
 *   order?: 'decision'|'calendar', view?: 'full'|'index',
 *   limit?: number, max?: number, offset?: number}} [query]
 * @param {{statuses: Array<string>}} known the store's own status vocabulary
 * @returns {{ok: true, view: string, order: string, offset: number, limit: number,
 *   total: number, dead: number, matched: number, page: Array<object>,
 *   filters: object} | {ok: false, error: string}}
 */
export const selectQueueForBeing = (entries, query = {}, known = {}) => {
  const all = Array.isArray(entries) ? entries : [];
  const q = query || {};
  const knownStatuses = Array.isArray(known.statuses) ? known.statuses : [];

  const view = q.view === undefined ? 'full' : _flat(q.view).toLowerCase();
  if (!QUEUE_VIEWS.includes(view)) {
    return { ok: false, error: `unknown view ${view} — use ${QUEUE_VIEWS.join(' | ')}` };
  }
  const order = q.order === undefined ? 'decision' : _flat(q.order).toLowerCase();
  if (!QUEUE_ORDERS.includes(order)) {
    return { ok: false, error: `unknown order ${order} — use ${QUEUE_ORDERS.join(' | ')}` };
  }
  const status = statusFilter(q.status, knownStatuses);
  if (!status.ok) return status;

  const kind = q.kind === undefined ? '' : _flat(q.kind).toLowerCase();
  if (kind && !QUEUE_KINDS.includes(kind)) {
    return { ok: false, error: `unknown kind ${kind} — use ${QUEUE_KINDS.join(' | ')}` };
  }
  const from = _window(q.from, 'from');
  if (!from.ok) return from;
  const to = _window(q.to, 'to');
  if (!to.ok) return to;

  const campaignId = _flat(q.campaignId);
  const channelId = _flat(q.channelId);
  const pillar = _flat(q.pillar);
  const needle = _flat(q.q).toLowerCase();

  // One index for the whole read: the window, the calendar order, and every
  // thread marker all ask the same question of it.
  const threads = threadIndex(all);
  const slotOf = (e) => _effectiveSlot(e, threads.byId);
  const position = new Map(all.map((e, i) => [e?.id, i]));
  const posOf = (e) => position.get(e?.id) ?? Number.MAX_SAFE_INTEGER;

  const matched = all.filter((e) => {
    if (!status.test(e)) return false;
    if (campaignId && e?.campaignId !== campaignId) return false;
    if (channelId && e?.channelId !== channelId) return false;
    if (pillar && e?.pillar !== pillar) return false;
    if (kind && _kindOf(e) !== kind) return false;
    // A date window asks about the calendar, so copy that will never stand on
    // it is not in the window — and that must be checked BEFORE the bounds,
    // not left to them. `_slot` is +Infinity for undated copy, so
    // `Infinity >= from` is true and a `from`-only window silently admitted
    // every undated draft: on the real queue, 182 matched where 123 were in
    // the window, the extra 59 being exactly the unscheduled ones. A `to`
    // bound hid it (Infinity <= t is false), which is why only the two-sided
    // window was ever proven. The slot is the EFFECTIVE one, so a follow-up
    // rides into the window on its parent's moment instead of vanishing.
    const slot = slotOf(e);
    if ((from.at !== null || to.at !== null) && !Number.isFinite(slot)) return false;
    if (from.at !== null && !(slot >= from.at)) return false;
    if (to.at !== null && !(slot <= to.at)) return false;
    if (needle && !_text(e?.text).toLowerCase().includes(needle)) return false;
    return true;
  }).sort(order === 'calendar' ? _byCalendarWith(slotOf, posOf) : _byDecisionWith(posOf));

  const asked = Number(q.limit ?? q.max);
  const limit = Math.min(
    PAGE_MAX[view],
    Number.isFinite(asked) && asked > 0 ? Math.floor(asked) : PAGE_DEFAULT[view],
  );
  const wanted = Number(q.offset);
  const offset = Number.isFinite(wanted) && wanted > 0 ? Math.floor(wanted) : 0;

  return {
    ok: true,
    view,
    order,
    offset,
    limit,
    // Built over the WHOLE store, never the page: a follow-up whose parent
    // sits on another page (or outside the filter entirely) still has a
    // living parent, and a renderer indexing only what it can see would call
    // it an orphan that can never publish — alarming, and false.
    threads,
    total: all.length,
    dead: all.length - liveQueueForBeing(all).length,
    matched: matched.length,
    page: matched.slice(offset, offset + limit),
    filters: {
      ...(status.named.length ? { status: status.named.join(',') } : {}),
      ...(campaignId ? { campaignId } : {}),
      ...(channelId ? { channelId } : {}),
      ...(pillar ? { pillar } : {}),
      ...(kind ? { kind } : {}),
      ...(q.from ? { from: _flat(q.from) } : {}),
      ...(q.to ? { to: _flat(q.to) } : {}),
      ...(needle ? { q: needle } : {}),
    },
  };
};

/**
 * Render the queue for a being's context window (pure) — select and render in
 * one call, for readers that need only the text.
 * @param {Array<object>} entries
 * @param {object} [query] see selectQueueForBeing
 * @param {{statuses: Array<string>}} [known]
 */
export const formatQueueForBeing = (entries, query = {}, known = {}) =>
  renderQueueSelection(selectQueueForBeing(entries, query, known));
