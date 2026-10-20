// Queue render — how the campaign queue reads on the page: the full and
// index lines, the header and paging tail, the rendered selection, and the
// one-entry detail an audit reads before it rewrites anything.
//
// Split out of queue-view.js on 2026-08-26 (size-law breakdown). The
// SELECTION — what a being may scan, in what order — stays in
// ./queue-view.js, which imports the thread index, the shared marks, and the
// dead-standing constants from here; this module never imports queue-view.js
// (direction law). renderQueueSelection and formatQueueEntryForBeing are
// re-exported from queue-view.js so existing readers' import paths still
// stand. Pure throughout: entries in, text out. No IO lives here.

import { frameUntrustedContent } from '../untrusted-content.js';

// The DEAD standings — copy the operator dropped completely (Design note, 2026-07-27:
// […]).
// Out of every ordinary read. Reachable only when the caller NAMES the status
// (ruling, 2026-08-03): an audit that cannot see killed copy rewrites into it.
export const DEAD_FOR_BEING = Object.freeze(['withdrawn', 'rejected']);

// The exact status argument that reads BOTH dead standings back. Derived from
// the constant so the two can never drift: the hints used to name
// `status:'withdrawn'` alone, which reaches only half of what they counted —
// a being following that hint would never see a post the operator DECLINED.
const DEAD_STATUS_KEY = DEAD_FOR_BEING.join(',');

// The standings that make a PARENT unable to carry a thread — the same set
// the store's own `threadOrphans` sweeps. `failed` joins the dead two here:
// a send that failed never became a post to answer.
export const DEAD_PARENT = Object.freeze([...DEAD_FOR_BEING, 'failed']);

/**
 * The public address of a published post, so a being can VERIFY what it sent
 * instead of reporting a success it never saw. Pure.
 * @param {string} channelId
 * @param {string} postId - the id the platform returned at send time
 * @returns {string|null} a URL, or null for a channel with no public permalink
 */
const publicPostUrl = (channelId, postId) => {
  if (!postId) return null;
  // /i/status/<id> resolves for any account — the permalink needs no handle,
  // which matters because the poster never fetches one.
  if (channelId === 'x') return `https://x.com/i/status/${postId}`;
  return null;
};

export const _text = (v) => (typeof v === 'string' ? v : '');
export const _flat = (v) => _text(v).replace(/\s+/g, ' ').trim();
const _preview = (v, n) => {
  const flat = _flat(v);
  return flat.length > n ? `${flat.slice(0, n - 1)}…` : flat;
};

export const _kindOf = (e) => (e?.kind === 'reply' || e?.kind === 'self-reply' ? e.kind : 'post');

// --- Threads ---------------------------------------------------------------

/**
 * The thread map (pure): every entry by id, and every parent's follow-ups in
 * the order they were staged. Built once per render — a per-line scan over a
 * 200-entry month is 40,000 comparisons for nothing.
 * @param {Array<object>} entries
 */
export const threadIndex = (entries) => {
  const all = Array.isArray(entries) ? entries : [];
  const byId = new Map(all.map((e) => [e?.id, e]));
  const children = new Map();
  // STORE ORDER, not createdAt: the record's own order is what the scheduler
  // walks, and two follow-ups staged in the same millisecond tie on any
  // timestamp — a tiebreak on id would print a publish order that is not the
  // one that will happen.
  for (const e of all) {
    if (e?.kind !== 'self-reply') continue;
    const parentId = e?.thread?.parentId;
    if (!parentId) continue;
    children.set(parentId, [...(children.get(parentId) || []), e]);
  }
  return { byId, children };
};

// What a follow-up's schedule actually IS. A self-reply carries no slot by law
// — it inherits the parent's moment — and printing "unscheduled" beside it
// (as this view did until 2026-08-03) reads as an orphan draft awaiting a
// slot. 50 of the 200 live entries were mis-presented that way.
const _threadMark = (e, { byId, children }) => {
  if (_kindOf(e) !== 'self-reply') {
    const kids = children.get(e?.id) || [];
    return kids.length ? `· +${kids.length} follow-up(s): ${kids.map((k) => `[${k.id}]`).join(' ')}` : null;
  }
  const parentId = e?.thread?.parentId;
  const parent = byId.get(parentId);
  if (!parent) return `· FOLLOW-UP to [${parentId || 'unknown'}] — that parent is GONE from the queue, so this can never publish`;
  if (DEAD_PARENT.includes(parent.status)) {
    return `· FOLLOW-UP to [${parent.id}] — parent ${parent.status}, so this can never publish`;
  }
  return `· FOLLOW-UP to [${parent.id}] — publishes right after it (${parent.scheduledFor || 'parent unscheduled'})`;
};

const _slotMark = (e) => {
  if (_kindOf(e) === 'self-reply') return '· no slot of its own';
  // A reply rides no calendar (ruling, 2026-08-06) — printing "unscheduled"
  // beside one reads as a draft awaiting a slot, when its whole law is that
  // approval itself sends it.
  if (_kindOf(e) === 'reply') return '· sends on approval';
  return `· ${e?.scheduledFor || 'unscheduled'}`;
};

const _campaignMark = (e) =>
  (e?.campaignId ? `· ${e.campaignId}${e.pillar ? `/${e.pillar}` : ''}` : (e?.pillar ? `· ${e.pillar}` : null));

// --- Rendering -------------------------------------------------------------

const _fullLine = (e, threads) => [
  // The FULL id. This printed `e.id.slice(0, 8)` until 2026-07-26, so a being
  // could see a draft and had no way to name it — no retrieval, no cancel, no
  // duplicate check. A truncated handle is not a handle.
  `[${e.id}] ${e.channelId} — ${e.status}`,
  e.kind === 'reply' && e.reply
    ? `· REPLY to @${_flat(e.reply.toUsername || e.reply.toUserId || 'unknown')}`
    : null,
  _slotMark(e),
  _threadMark(e, threads),
  _campaignMark(e),
  // The STAGING KIND (the CoS audit's G4): the mark travels with the entry —
  // a placeholder holds a slot, it is not copy awaiting a decision.
  e.placeholder ? '· [PLACEHOLDER — staging, not copy]' : null,
  e.decidedBy ? `· approved by ${e.decidedBy}` : null,
  // THE SCHEDULE LOCK, from the being's side (Design note, 2026-07-28: […]). The lock id is
  // the entry id printed above; this is its confirmation timestamp — and
  // the PROTOCOL TRUTH, stated here because it keeps being waited on: X's
  // standard API has NO scheduling surface (and this account has no Ads
  // API access), so no X-side schedule id can ever exist. The backend
  // fires the slot; the LIVE post id lands on this record at send. That
  // is the whole chain — there is nothing else to wait for.
  e.status === 'approved' && e.decidedAt
    ? `· schedule LOCKED ${e.decidedAt} (backend-locked — X holds no schedule; the LIVE post id lands here at send)`
    : null,
  e.withdrawnBy ? `· withdrawn by ${e.withdrawnBy}${e.withdrawnReason ? ` (${e.withdrawnReason})` : ''}` : null,
  Array.isArray(e.media) && e.media.length
    ? `· ${e.media.length} image(s): ${e.media.map((m) => `${m.path.split('/').pop()}${m.alt ? ' [described]' : ' [NO ALT TEXT]'}`).join(', ')}`
    : null,
  // Where it actually landed, so publication can be verified rather than
  // assumed. /i/status/ resolves without knowing the account handle.
  e.postId ? `· LIVE ${publicPostUrl(e.channelId, e.postId)}` : null,
  e.sentAt ? `· sent ${e.sentAt}` : null,
  e.error ? `· FAILED ${_flat(e.error).slice(0, 160)}` : null,
  Array.isArray(e.revisions) && e.revisions.length
    ? `· ${e.revisions.length} revision(s) — queue_get shows what the copy WAS` : null,
  // The exact text, not a preview: staged copy must be comparable against
  // what is about to be written, or duplicates are impossible to see.
  // VERBATIM (2026-07-28): this view used to collapse every \n\n to a
  // space while claiming exactness — and a being forced to publish
  // manually posted the COLLAPSED render, putting a bunched one-liner on
  // X where the staged copy had real breaks. Formatting is content.
  `\n    "${e.text || ''}"`,
  // A reply's ORIGINAL rides beside the draft — verbatim and FRAMED,
  // because it is attacker-authored text entering the being's context
  // (the same law as every other inbound X word).
  e.kind === 'reply' && e.reply?.toTextPreview
    ? `\n${frameUntrustedContent(
      `the post this answers, on X by @${_flat(e.reply.toUsername || 'unknown')}`,
      e.reply.toTextPreview,
    )}`
    : null,
].filter(Boolean).join(' ');

// One line per entry, whitespace collapsed and cut at 60 — this is the MAP of
// the month, not the copy. The header says so plainly, because formatting is
// content and a preview must never be mistaken for what will publish.
const _indexLine = (e, threads) => [
  `[${e.id}] ${e.channelId} — ${e.status}`,
  _slotMark(e),
  _campaignMark(e),
  e.placeholder ? '· [PLACEHOLDER]' : null,
  _kindOf(e) === 'reply' ? '· REPLY' : null,
  _kindOf(e) === 'self-reply'
    ? `· follows [${e.thread?.parentId || 'unknown'}]`
    : ((threads.children.get(e.id) || []).length ? `· +${threads.children.get(e.id).length}` : null),
  e.postId ? '· LIVE' : null,
  `· "${_preview(e.text, 60)}"`,
].filter(Boolean).join(' ');

const _echoFilters = (filters) => Object.entries(filters)
  .map(([k, v]) => `${k}: ${v}`).join(', ');

const _header = (sel) => {
  const scope = Object.keys(sel.filters).length ? ` matching {${_echoFilters(sel.filters)}}` : '';
  const hidden = sel.dead && !sel.filters.status
    ? ` · ${sel.dead} withdrawn/declined left in the record, not shown (status:'${DEAD_STATUS_KEY}' reads them)`
    : '';
  return `${sel.matched} post(s) in the campaign queue${scope}${hidden}:`;
};

// THE PAGING CONTRACT LIVES HERE. `shown` is what the render actually carried
// — never `sel.page.length`, which is what the SELECTION held. When the
// context window fits fewer entries than the page, an offset counted from the
// selection steps straight over the copy that was held back, and a being
// paging the month skips it without ever knowing. The being is also told WHY
// its page came up short, so a window limit is never read as an empty record.
const _tail = (sel, shown) => {
  const seen = sel.offset + shown;
  if (!shown || seen >= sel.matched) return [];
  // The dead end this replaces read […], which named a surface the being cannot reach.
  const short = shown < sel.page.length
    ? ` (your context window held ${shown} of this page's ${sel.page.length} — whole entries only, never a cut one)`
    : '';
  const next = `next: queue_list {offset: ${seen}${sel.view === 'index' ? ", view: 'index'" : ''}}`;
  // What this said until 2026-08-28 — […]
  // — the window has never been able to keep: the index of the live 155 renders
  // at 25,167 chars against a 4,000-char result cap. It is still the densest
  // way to walk the month; it is not one read.
  const wider = sel.view === 'full'
    ? ` — or view:'index' for one line each, still paged to your window`
    : '';
  return [`showing ${sel.offset + 1}–${seen} of ${sel.matched}${short} · ${next}${wider}`];
};

/**
 * Render one selection for a being's context window (pure).
 *
 * THE WINDOW (2026-08-28). Over the tool-result cap the portal's compressor
 * folds a result's MIDDLE out and stamps the gap — so every ordinary
 * `queue_list` (17,396 chars on the live store, against a 4,000 cap) reached
 * the being as a head, a sample, a tail and omission markers, with entries
 * severed mid-copy. Given a `budget` this render fits ITSELF instead: whole
 * entries while they fit, one always surviving, and the paging hint counted
 * from what was rendered. Without a budget nothing is held back — the prompt
 * sections that render this into a turn (the CMO briefing) answer to their own
 * budget, not the tool cap.
 *
 * @param {object} sel the object `selectQueueForBeing` returned
 * @param {{budget?: number|null}} [opts] budget = the caller's char window
 * @returns {{text: string, shown: number}} shown is what the being actually
 *   RECEIVED — the chip counts that, never the selection's page.
 */
export const drawQueueSelection = (sel, { budget = null } = {}) => {
  if (!sel?.ok) return { text: sel?.error || 'the queue could not be read', shown: 0 };
  if (!sel.matched) {
    if (Object.keys(sel.filters).length) {
      return { text: `Nothing in the campaign queue matches {${_echoFilters(sel.filters)}} — ${sel.total} post(s) stand in the record.`, shown: 0 };
    }
    return {
      text: sel.dead
        ? `Nothing live in the campaign queue — ${sel.dead} withdrawn/declined post(s) rest in the record; read them with status:'${DEAD_STATUS_KEY}'.`
        : 'The campaign queue is empty — no posts are staged yet.',
      shown: 0,
    };
  }
  // Deliberately no fallback: `selectQueueForBeing` always carries the
  // store-wide index, and a page-scoped one would render false orphan claims
  // rather than fail — a wrong answer is worse here than a loud one.
  const threads = sel.threads;
  const line = sel.view === 'index' ? _indexLine : _fullLine;
  const lead = [
    _header(sel),
    ...(sel.view === 'index'
      ? ['(index view — one line each, previews collapsed to 60 chars; the verbatim copy is in view:\'full\' or queue_get)']
      : []),
  ];
  const blocks = sel.page.map((e) => line(e, threads));
  const draw = (n) => [...lead, ...blocks.slice(0, n), ..._tail(sel, n)].join('\n');

  let shown = blocks.length;
  if (Number.isFinite(budget) && budget > 0) {
    // Measured on cumulative block lengths rather than by re-joining the whole
    // page at every step — the index view carries up to 500 entries.
    const cum = [];
    for (const b of blocks) cum.push((cum[cum.length - 1] || 0) + b.length);
    const parts = (n) => lead.length + n + _tail(sel, n).length;
    const size = (n) => lead.reduce((s, l) => s + l.length, 0)
      + (n ? cum[n - 1] : 0)
      + _tail(sel, n).reduce((s, l) => s + l.length, 0)
      + Math.max(0, parts(n) - 1); // the joining newlines
    while (shown > 1 && size(shown) > budget) shown -= 1;
  }
  return { text: draw(shown), shown };
};

/**
 * The selection as one string — `drawQueueSelection`'s text, for the readers
 * that need only that (the CMO briefing section, the tests). Same signature it
 * always had, and with no budget it renders exactly as it always did.
 * @param {object} sel
 * @param {{budget?: number|null}} [opts]
 */
export const renderQueueSelection = (sel, opts = {}) => drawQueueSelection(sel, opts).text;

// --- One entry, whole -------------------------------------------------------

/**
 * Resolve a queue id the way a being will actually give it — in full, or as
 * enough of a prefix to be unambiguous. Ambiguity refuses rather than guessing
 * which post to act on. Pure.
 * @param {Array<object>} entries
 * @param {string} given
 */
const resolveQueueId = (entries, given) => {
  const id = _flat(given);
  if (!id) return { ok: false, error: 'no id given — queue_list shows every entry\'s id' };
  const all = Array.isArray(entries) ? entries : [];
  const exact = all.find((e) => e?.id === id);
  if (exact) return { ok: true, entry: exact };
  const matches = all.filter((e) => _text(e?.id).startsWith(id));
  if (matches.length === 1) return { ok: true, entry: matches[0] };
  if (matches.length > 1) {
    return { ok: false, ambiguous: true, error: `the id "${id}" matches ${matches.length} entries — use more of it` };
  }
  return { ok: false, error: `no queue entry ${id}` };
};

const _revisionLine = (rev) => {
  const fields = Object.entries(rev?.changed || {}).map(([field, was]) => {
    if (field === 'media') return `media (was ${Array.isArray(was) ? was.length : 0} image(s))`;
    if (field === 'text') return `text (was: "${_preview(was, 120)}")`;
    return `${field} (was ${was === null || was === '' ? 'unset' : `"${_flat(String(was))}"`})`;
  });
  return `  · ${rev?.at || 'unknown time'} by ${rev?.by || 'unknown'} — changed ${fields.join(', ') || 'nothing recorded'}`;
};

const _threadBlock = (entry, threads) => {
  const isChild = _kindOf(entry) === 'self-reply';
  const parent = isChild ? threads.byId.get(entry.thread?.parentId) : entry;
  if (!parent) {
    return [`THREAD: the parent [${entry.thread?.parentId || 'unknown'}] is GONE from the queue — this follow-up can never publish.`];
  }
  const kids = threads.children.get(parent.id) || [];
  if (!isChild && !kids.length) return [];
  const mark = (e) => (e.id === entry.id ? ' ← this one' : '');
  return [
    `THREAD (${1 + kids.length} post(s), in publish order):`,
    `  1. [${parent.id}] ${parent.status} · ${parent.scheduledFor || 'unscheduled'} · "${_preview(parent.text, 80)}"${mark(parent)}`,
    ...kids.map((k, i) => `  ${i + 2}. [${k.id}] ${k.status} · rides the parent · "${_preview(k.text, 80)}"${mark(k)}`),
  ];
};

/**
 * One entry, whole (pure) — the copy verbatim, the decision attribution, the
 * media with its alt text, what the copy WAS at every revision, and the thread
 * it belongs to. This is what an audit reads before it rewrites anything.
 * @param {Array<object>} entries the whole store
 * @param {string} given a full id or an unambiguous prefix
 */
// An X post's id, resolved to its queue entry: the house's own post is the entry it
// went out as; anyone else's post is the house's answer to it — the live one (one
// stands at a time, by law), else the newest. Pure.
const resolveByPost = (entries, postId) => {
  const all = Array.isArray(entries) ? entries : [];
  const own = all.find((e) => e?.postId && String(e.postId) === postId);
  if (own) return { entry: own, others: [] };
  const answers = all.filter((e) => _kindOf(e) === 'reply' && String(e?.reply?.toPostId || '') === postId)
    .sort((a, b) => _text(b.createdAt).localeCompare(_text(a.createdAt)));
  if (!answers.length) return null;
  const entry = answers.find((e) => !DEAD_FOR_BEING.includes(e.status)) || answers[0];
  return { entry, others: answers.filter((e) => e !== entry) };
};

/**
 * @param {Array<object>} entries
 * @param {string} given - a queue id (or its unambiguous start)
 * @param {{ postId?: string }} [opts] - the X post id `given` names, if it names one
 */
export const formatQueueEntryForBeing = (entries, given, { postId = '' } = {}) => {
  let found = resolveQueueId(entries, given);
  let others = [];
  // Only an id that names NO entry is read as an X post — a prefix naming two entries
  // still refuses rather than being guessed at as a post.
  if (!found.ok && !found.ambiguous && postId) {
    const byPost = resolveByPost(entries, postId);
    if (!byPost) return { ok: false, error: `no queue entry is X post ${postId} or answers it` };
    found = { ok: true, entry: byPost.entry };
    others = byPost.others;
  }
  if (!found.ok) return found;
  const e = found.entry;
  const threads = threadIndex(entries);
  const text = [
    `[${e.id}] ${e.channelId} — ${e.status}`,
    `· staged ${e.createdAt || 'unknown'} by ${e.queuedBy || 'unknown'}${e.authorNeumaId ? ` (author ${e.authorNeumaId})` : ''}`,
    _slotMark(e).replace(/^· /, '· slot: '),
    _threadMark(e, threads),
    _campaignMark(e),
    e.decidedBy ? `· approved by ${e.decidedBy} at ${e.decidedAt || 'unknown time'}` : null,
    e.updatedBy ? `· last edited ${e.updatedAt} by ${e.updatedBy}` : null,
    e.withdrawnBy ? `· withdrawn by ${e.withdrawnBy} at ${e.withdrawnAt}${e.withdrawnReason ? ` (${e.withdrawnReason})` : ''}` : null,
    Array.isArray(e.media) && e.media.length
      ? `· ${e.media.length} image(s): ${e.media.map((m) => `${m.path}${m.alt ? ` [alt: "${_preview(m.alt, 80)}"]` : ' [NO ALT TEXT]'}`).join('; ')}`
      : null,
    e.postId ? `· LIVE ${publicPostUrl(e.channelId, e.postId)} (sent ${e.sentAt})` : null,
    e.error ? `· FAILED ${_flat(e.error).slice(0, 300)}` : null,
    e.expiresAt ? `· expires ${e.expiresAt}` : null,
    '',
    'COPY (verbatim — this is exactly what publishes):',
    `"${e.text || ''}"`,
    ...(e.kind === 'reply' && e.reply?.toTextPreview
      ? ['', frameUntrustedContent(
        `the post this answers, on X by @${_flat(e.reply.toUsername || 'unknown')}`,
        e.reply.toTextPreview,
      )]
      : []),
    ...(Array.isArray(e.revisions) && e.revisions.length
      ? ['', `REVISIONS (${e.revisions.length}, newest last):`, ...e.revisions.map(_revisionLine)]
      : []),
    ...(() => {
      const block = _threadBlock(e, threads);
      return block.length ? ['', ...block] : [];
    })(),
    ...(others.length
      ? ['', `EARLIER ANSWERS TO THE SAME POST (${others.length}):`,
        ...others.map((o) => `  · [${o.id}] ${o.status} — "${_preview(o.text, 120)}"`)]
      : []),
  ].filter((l) => l !== null).join('\n');
  return { ok: true, entry: e, text };
};
