/**
 * Social READ tool family — the queue reads (queue_list, queue_get), the
 * house X read (read_x), the withdrawal (queue_cancel), and their one
 * ACTS-gated handler.
 *
 * Extracted VERBATIM from portal-stream.js (size-law breakdown 2026-08-26,
 * docs/work/size-law-breakdown.md Part 1 step 3 / #278). Leaf module —
 * portal-stream imports it, never the reverse (direction law).
 */
import { createLogger } from '../logger.js';
import { neumaWorkspace } from '../../../core/index.js';
import { resolvePolicy, checkToolAccess, applyToolMode, GLOBAL_DEFAULTS } from '../tool-policy.js';
import { ACT_REFUSALS, grantAlwaysAllow, refusalForDecision } from '../act-gate.js';
import { capturePolicyGrant } from '../policy-grant-context.js';
import { requestToolApproval } from '../tool-approval.js';
import { postQueue, QUEUE_STATUSES } from '../social/post-queue.js';
import {
  selectQueueForBeing, drawQueueSelection, formatQueueEntryForBeing,
  QUEUE_VIEWS, QUEUE_ORDERS, QUEUE_KINDS, PAGE_DEFAULT, PAGE_MAX,
} from '../social/queue-view.js';
import { DEAD_FOR_BEING } from '../social/queue-render.js';
import { replyCandidatesOf, replyDisposition } from '../social/reply-candidates.js';
import { materializeReplyCandidates } from '../social/reply-listener.js';
import { readXMe, readXListings, formatXReadForBeing, renderXListing, postIdFrom } from '../social/x-reader.js';
import { houseOfLane } from '../social/house-positions.js';
import { TOOL_RESULT_MAX_CHARS } from '../tool-exchange.js';
import { sendToolEvent as _sendToolEvent } from './tool-events.js';
import { REPLIES_LIST_TOOL, readReplyInbox } from './reply-inbox-tool.js';

// Same logger name as the seat it was cut from, so the read lane's warnings
// keep their long-standing prefix in the operator's logs.
const log = createLogger('Portal');

// Reading the outreach machine is everyone's: the queue shows what is staged
// and the X read shows the field. Staging and shaping follow the marketing
// team's lead — that is protocol, carried in the descriptions, not a gate.
// THE READ SURFACE (Design note, 2026-08-03, relaying the CMO lane): […] This took NO arguments and rendered a fixed 30 of a 200-entry
// queue through one ranking — which meant 56 sent posts were unreachable and
// the tail line pointed at the operator's board, a surface no being can open.
// Every argument below is optional and the defaults answer exactly as before,
// so a standing plan that calls `queue_list` with no args never shifts.
const QUEUE_LIST_TOOL = Object.freeze({
  name: 'queue_list',
  server: 'social',
  description: `Read the campaign queue — every arg optional: {status?, campaignId?, channelId?, kind?, pillar?, from?, to?, q?, order?, view?, limit?, offset?}. With no args you get the decision view: what awaits your operator and what is coming, ${PAGE_DEFAULT.full} at a time, each with its copy VERBATIM. To audit a whole month use view:'index' — one line per post, the densest walk there is — then queue_get the ones you mean to change. Every read is fitted to your context window in WHOLE entries: if fewer arrive than the page holds, the answer says so and names the exact next call, so a short page is a window and never a shorter record. status: live (default — withdrawn/declined copy stays out of your context) | all | ${QUEUE_STATUSES.join(' | ')}. kind: ${QUEUE_KINDS.join(' | ')} (a self-reply is a thread follow-up). from/to are ISO times bounding the SCHEDULE, so unscheduled copy falls outside them. q searches the text — the duplicate check before you stage another line. order: decision (default: awaiting you, then coming, then the record) | calendar (the month as it will actually happen). Page with offset; every answer that has more tells you the exact next call. Reading the lane is everyone's; staging follows the marketing team's lead — if you are not on the marketing team, feed them what they need and let them shape the calendar.`,
  inputSchema: Object.freeze({
    type: 'object',
    properties: Object.freeze({
      status: Object.freeze({ type: 'string', description: `live (default) | all | ${QUEUE_STATUSES.join(' | ')} — or several, comma-separated` }),
      campaignId: Object.freeze({ type: 'string', description: 'Only posts on this campaign (the id campaign_list shows)' }),
      channelId: Object.freeze({ type: 'string', description: 'Only posts for this channel (x, telegram, discord, …)' }),
      kind: Object.freeze({ type: 'string', enum: Object.freeze([...QUEUE_KINDS]), description: 'post | reply | self-reply' }),
      pillar: Object.freeze({ type: 'string', description: 'Only posts on this content pillar' }),
      from: Object.freeze({ type: 'string', description: 'ISO-8601 — only posts scheduled at or after this moment' }),
      to: Object.freeze({ type: 'string', description: 'ISO-8601 — only posts scheduled at or before this moment' }),
      q: Object.freeze({ type: 'string', description: 'Only posts whose text contains this (case-insensitive)' }),
      order: Object.freeze({ type: 'string', enum: Object.freeze([...QUEUE_ORDERS]), description: 'decision (default) | calendar' }),
      view: Object.freeze({ type: 'string', enum: Object.freeze([...QUEUE_VIEWS]), description: `full (default, verbatim copy) | index (one line each, up to ${PAGE_MAX.index})` }),
      limit: Object.freeze({ type: 'number', description: `How many to return (full: ${PAGE_DEFAULT.full}, max ${PAGE_MAX.full}; index: ${PAGE_DEFAULT.index}, max ${PAGE_MAX.index})` }),
      offset: Object.freeze({ type: 'number', description: 'Skip this many — how you page through a long calendar' }),
    }),
  }),
});

// One post, whole. The list gives a being the month; this gives it everything
// about the entry it is about to touch — including what the copy WAS at each
// revision and the thread it belongs to, neither of which a list line can
// carry. An edit made against a preview is an edit made blind.
const QUEUE_GET_TOOL = Object.freeze({
  name: 'queue_get',
  server: 'social',
  description: 'Read ONE staged post whole — args {id}. Give the full id from queue_list, or enough of its start to be unambiguous — OR an X post\'s id or x.com link: the house\'s own post resolves to the entry it went out as, and someone else\'s post to the house\'s answer to it (read_x shows both ids). You get the copy verbatim, who approved it and when, the images and their alt text, what the copy WAS at every revision, and the whole thread it belongs to — the parent post and every follow-up, in publish order. Read this before you rewrite anything.',
  inputSchema: Object.freeze({
    type: 'object',
    properties: Object.freeze({
      id: Object.freeze({ type: 'string', description: 'The queue entry id (full, or an unambiguous prefix), or an X post id / x.com link' }),
    }),
    required: Object.freeze(['id']),
  }),
});

// THE READ WINDOW — shared by every listing this family serves. Over the
// tool-result cap the exchange compresses a result by folding its MIDDLE out
// — correct for a file read, wrong for a listing (2026-08-28, a being's own
// read-lane diagnosis: the fold stranded half a post at offset 1994; the live
// queue rendered 17,396 chars into a 4,000-char window). So a listing fits
// itself in whole records instead, and the reserve covers the
// `social/<tool> → ok` line the exchange prepends before the cap is measured.
const READ_WINDOW = TOOL_RESULT_MAX_CHARS - 120;

const READ_X_TOOL = Object.freeze({
  name: 'read_x',
  server: 'social',
  description: 'Read from the house X account — args {what, limit?}. what: me (whose account this is), mentions (who is speaking to the house — each with the house\'s answer to it, if one stands: its queue id, standing and words), recent (what the house has said, up to 25 — each with the queue entry it went out as). You are handed exactly the number of posts you ask for, newest first, each one whole. If the ask does not fit your context window the oldest are held back rather than any post being cut in half — the answer names how many and why, so a short read is never a silent one. Research feeds the marketing team: if you surface a prospect, file a leads/add intent and let the CMO work it. Reading is research, never auto-engagement — this tool only reads.',
  inputSchema: Object.freeze({
    type: 'object',
    properties: Object.freeze({
      what: Object.freeze({ type: 'string', enum: Object.freeze(['me', 'mentions', 'recent']), description: 'me | mentions | recent' }),
      limit: Object.freeze({ type: 'number', description: 'How many posts to hand you, 1-25 (default 10). X pages a timeline in fives, so a smaller ask still costs a five-post fetch — but only what you asked for reaches you.' }),
    }),
    required: Object.freeze(['what']),
  }),
});

// Reversibility. Staged copy goes stale — a campaign line is superseded, a
// figure is corrected — and until 2026-07-26 nothing but the operator's own
// board could pull it back, so a being that noticed its own dead draft could
// only report it (Kagipem: […]). Cancel MARKS, never deletes: the queue
// is a governance record, and the scheduler publishes only `approved`, so a
// rejected entry is inert while staying fully auditable.
const QUEUE_CANCEL_TOOL = Object.freeze({
  name: 'queue_cancel',
  server: 'social',
  description: 'Pull a staged post back before it publishes — args {id, reason?}. Use the FULL id from queue_list. The entry is marked rejected and will never be sent; it stays in the record so the decision is auditable. A post that already went out cannot be cancelled — say so plainly rather than implying you recalled it.',
  inputSchema: Object.freeze({
    type: 'object',
    properties: Object.freeze({
      id: Object.freeze({ type: 'string', description: 'The full queue entry id from queue_list' }),
      reason: Object.freeze({ type: 'string', description: 'Why this copy is being pulled' }),
    }),
    required: Object.freeze(['id']),
  }),
});

const SOCIAL_TOOLS = Object.freeze([QUEUE_LIST_TOOL, QUEUE_GET_TOOL, READ_X_TOOL, QUEUE_CANCEL_TOOL, REPLIES_LIST_TOOL]);
const SOCIAL_TOOL_NAMES = new Set(SOCIAL_TOOLS.map((t) => t.name));

// Does this parsed call target a social read tool? (accepts both dialects)
const _isSocialTool = (match) =>
  SOCIAL_TOOL_NAMES.has(match.toolName) ||
  SOCIAL_TOOL_NAMES.has(String(match.tool || '').replace(/^social\//, ''));

// impure — route a social READ call through the same ACTS gate as every
// governed tool, then the REAL queue on disk or the REAL X read lane. Never
// the MCP path. Reads only — nothing here stages, posts, or engages.
const _handleSocialTool = async (ws, connection, neumaPolicy, toolMode, match, args) => {
  const grantOrigin = capturePolicyGrant(connection);
  const toolName = SOCIAL_TOOL_NAMES.has(match.toolName)
    ? match.toolName
    : String(match.tool || '').replace(/^social\//, '');
  const tool = `social/${toolName}`;
  const { companion } = connection;

  const policy = resolvePolicy(GLOBAL_DEFAULTS, neumaPolicy, connection._sessionToolPolicy || null);
  const baseAccess = checkToolAccess(policy, 'social', toolName);
  const access = applyToolMode(baseAccess, toolMode, toolName);
  if (access === 'denied') {
    // Composed by hand rather than gateAct (act-gate.js) because the
    // cancellation card below carries a consent SCOPE — the one ask shape the
    // gate does not hold. The refusal vocabulary is the shared one either way.
    const refusal = baseAccess !== 'denied' ? ACT_REFUSALS.held : ACT_REFUSALS.policyDenied;
    _sendToolEvent(ws, companion, { tool, status: 'denied', summary: `${toolName} — ${refusal.summary}` });
    return { tool, status: 'denied', error: refusal.error };
  }
  // The withdrawal reason, normalized once — it rides the operator's card and
  // then the record itself.
  const cancelReason = typeof args?.reason === 'string'
    ? args.reason.replace(/\s+/g, ' ').trim().slice(0, 200) : '';

  // THE CANCELLATION CARD. queue_cancel is approval-gated, and until this
  // resolved the entry the chip named NO post — `approvalPreview({})` renders
  // '' — so the operator was asked to agree that some unnamed copy should
  // never publish, and the consent recorded in the act ledger said the same
  // nothing. Resolving here also puts the refusals BEFORE the interruption: a
  // post that does not exist, or one already sent, is answered without
  // spending the operator's attention on a decision that cannot stand.
  let cancelTarget = null;
  if (toolName === 'queue_cancel') {
    const id = typeof args?.id === 'string' ? args.id.trim() : '';
    if (!id) {
      const error = 'queue_cancel needs {id} — the full id from queue_list, not the prefix';
      _sendToolEvent(ws, companion, { tool, status: 'error', summary: 'queue_cancel — invalid args', detail: error });
      return { tool, status: 'error', error };
    }
    let entries;
    try {
      entries = await postQueue.load();
    } catch (err) {
      _sendToolEvent(ws, companion, { tool, status: 'error', summary: 'queue_cancel — failed', detail: err.message });
      return { tool, status: 'error', error: err.message };
    }
    // EXACT id only — a prefix is refused here as it always has been: a guess
    // about which post to pull is a guess about public speech.
    const entry = entries.find((e) => e.id === id);
    const refusal = !entry
      ? 'no such queued post'
      : (['draft', 'approved'].includes(entry.status) ? null : `cannot act on a ${entry.status} post`);
    if (refusal) {
      const error = `Could not pull ${id}: ${refusal}. Read queue_list and report what is actually true — do not imply it was recalled.`;
      _sendToolEvent(ws, companion, { tool, status: 'error', summary: 'queue_cancel — not pullable', detail: error });
      return { tool, status: 'error', error };
    }
    cancelTarget = entry;
  }

  if (access === 'approval_required') {
    const cardArgs = toolName === 'read_x'
      ? { what: args?.what, ...(args?.limit !== undefined ? { limit: args.limit } : {}) }
      : toolName === 'queue_get' ? { id: args?.id }
        : (toolName === 'queue_list' || toolName === 'replies_list') ? { ...(args && typeof args === 'object' ? args : {}) }
          : cancelTarget ? {
            id: cancelTarget.id,
            channel: cancelTarget.channelId,
            standing: cancelTarget.status,
            scheduledFor: cancelTarget.scheduledFor || 'unscheduled',
            ...(cancelTarget.campaignId ? { campaign: cancelTarget.campaignId } : {}),
            // The words themselves — the operator is deciding about copy, and
            // an id alone is not something a human can recognise.
            copy: String(cancelTarget.text || '').replace(/\s+/g, ' ').trim().slice(0, 240),
            ...(cancelReason ? { reason: cancelReason } : {}),
          } : {};
    const decision = await requestToolApproval(connection, {
      tool,
      args: cardArgs,
      // The stakes in one sentence, so the answer is to the act and not to a
      // tool name — and it carries the id, because this same string is what
      // the ACTS ledger keeps as the record of the operator's consent
      // (`recordAct` prefers a hand-declared scope; `scopeOf({})` was null,
      // so an approved cancellation used to be recorded against no target).
      ...(cancelTarget
        ? { scope: `withdraw the ${cancelTarget.status} ${cancelTarget.channelId} post ${cancelTarget.id} — it will never publish` }
        : {}),
      signal: grantOrigin.signal,
    });
    try {
      grantOrigin.beforeCommit();
      if (decision === 'always') await grantAlwaysAllow(connection, 'social', toolName, grantOrigin);
    } catch {
      return { tool, status: 'denied', error: ACT_REFUSALS.interrupted.error };
    }
    if (decision !== 'allow' && decision !== 'always') {
      const refusal = refusalForDecision(connection, decision);
      _sendToolEvent(ws, companion, { tool, status: 'denied', summary: `${toolName} — ${refusal.summary}` });
      return { tool, status: 'denied', error: refusal.error };
    }
  }

  // An interrupt that landed while the approval waited stops the read too —
  // the operator pulled the turn; nothing of it should run.
  if (grantOrigin.signal?.aborted) {
    const refusal = ACT_REFUSALS.interrupted;
    _sendToolEvent(ws, companion, { tool, status: 'denied', summary: `${toolName} — ${refusal.summary}` });
    return { tool, status: 'denied', error: refusal.error };
  }

  if (toolName === 'queue_list') {
    try {
      const entries = await postQueue.load();
      // A bad filter refuses with its own reason rather than answering "nothing
      // matched" — an empty page and an unreadable query look identical from
      // inside a turn, and one of them is a lie.
      const selection = selectQueueForBeing(entries, args || {}, { statuses: QUEUE_STATUSES });
      if (!selection.ok) {
        _sendToolEvent(ws, companion, { tool, status: 'error', summary: 'queue_list — invalid args', detail: selection.error });
        return { tool, status: 'error', error: selection.error };
      }
      // The chip counts what the being actually RECEIVED — the window, not the
      // record. It read `${live} staged post(s)` while handing over 30 of 200,
      // which told the operator a whole queue had been scanned.
      // The render fits the same window read_x does — the compressor's
      // middle-fold severs an entry mid-copy, and a queue read is whole posts
      // or it is nothing. `drawn.shown` is what actually crossed, which is
      // what the chip must count.
      const drawn = drawQueueSelection(selection, { budget: READ_WINDOW });
      _sendToolEvent(ws, companion, {
        tool,
        status: 'ok',
        summary: drawn.shown < selection.matched
          ? `${drawn.shown} of ${selection.matched} staged post(s)`
          : `${drawn.shown} staged post(s)`,
      });
      return { tool, status: 'ok', content: drawn.text };
    } catch (err) {
      _sendToolEvent(ws, companion, { tool, status: 'error', summary: `${toolName} — failed`, detail: err.message });
      return { tool, status: 'error', error: err.message };
    }
  }

  if (toolName === 'replies_list') {
    try {
      const read = await readReplyInbox(args, await houseOfLane(companion?.neumaId));
      if (!read.ok) {
        _sendToolEvent(ws, companion, { tool, status: 'error', summary: 'replies_list — invalid args', detail: read.error });
        return { tool, status: 'error', error: read.error };
      }
      _sendToolEvent(ws, companion, { tool, status: 'ok', summary: read.summary });
      return { tool, status: 'ok', content: read.text };
    } catch (err) {
      _sendToolEvent(ws, companion, { tool, status: 'error', summary: `${toolName} — failed`, detail: err.message });
      return { tool, status: 'error', error: err.message };
    }
  }

  if (toolName === 'queue_get') {
    try {
      const entries = await postQueue.load();
      // A queue id, or the X post itself — its id or x.com link — which resolves to
      // the house's post it is, or the house's answer to it.
      const found = formatQueueEntryForBeing(entries, args?.id, { postId: postIdFrom(args?.id) });
      if (!found.ok) {
        _sendToolEvent(ws, companion, { tool, status: 'error', summary: 'queue_get — not found', detail: found.error });
        return { tool, status: 'error', error: `${found.error} — queue_list shows every entry's id.` };
      }
      _sendToolEvent(ws, companion, {
        tool, status: 'ok', summary: `${found.entry.id.slice(0, 8)} — ${found.entry.status}`,
      });
      return { tool, status: 'ok', content: found.text };
    } catch (err) {
      _sendToolEvent(ws, companion, { tool, status: 'error', summary: `${toolName} — failed`, detail: err.message });
      return { tool, status: 'error', error: err.message };
    }
  }

  if (toolName === 'queue_cancel') {
    // The id, the standing and the copy were all resolved above, before the
    // operator was asked; `cancelTarget` is that entry.
    const id = cancelTarget.id;
    try {
      // Re-checked at the write, never assumed from the card: withdraw()
      // transitions draft|approved only, under the store's own lock, so a post
      // that was approved and CLAIMED FOR SEND while the chip waited refuses
      // here instead of being reported as recalled.
      const pulled = await postQueue.withdraw(id, {
        withdrawnBy: companion?.name || 'being',
        reason: cancelReason,
      });
      if (!pulled.ok) {
        // Carry the store's own reason ([…]): a
        // being told a vague failure will guess, and a guess about whether
        // public speech was recalled is the worst kind.
        const error = `Could not pull ${id}: ${pulled.error}. Read queue_list and report what is actually true — do not imply it was recalled.`;
        _sendToolEvent(ws, companion, { tool, status: 'error', summary: 'queue_cancel — not pullable', detail: error });
        return { tool, status: 'error', error };
      }
      _sendToolEvent(ws, companion, {
        tool, status: 'ok', summary: `pulled ${id.slice(0, 8)} from the queue`, detail: cancelReason || undefined,
      });
      return { tool, status: 'ok', content: `Staged post ${id} is withdrawn and will not publish${cancelReason ? ` (${cancelReason})` : ''}. It remains in the record.` };
    } catch (err) {
      _sendToolEvent(ws, companion, { tool, status: 'error', summary: 'queue_cancel — failed', detail: err.message });
      return { tool, status: 'error', error: err.message };
    }
  }

  // read_x — the reader never throws; a broken lane answers with the honest
  // reason, which the consciousness reads next round.
  const what = typeof args?.what === 'string' ? args.what : '';
  if (!['me', 'mentions', 'recent'].includes(what)) {
    const error = 'read_x needs {what: me | mentions | recent}';
    _sendToolEvent(ws, companion, { tool, status: 'error', summary: `${toolName} — invalid args`, detail: error });
    return { tool, status: 'error', error };
  }
  // The ask, as asked. X's timeline endpoint pages in fives, so the reader
  // may FETCH more than this — the renderer hands over exactly this many.
  const limit = Math.min(25, Math.max(1, Math.floor(Number(args?.limit)) || 10));
  const signal = connection.activeTurn?.signal;
  // The being's own house's X account, read with that house's keys.
  const wallet = await houseOfLane(companion?.neumaId);
  const outcome = what === 'me'
    ? await readXMe({ signal, wallet })
    : await readXListings({ kind: what, limit, signal, wallet });

  // ONE CANDIDATE PIPELINE (ruling, 2026-07-28): a being-driven mentions read
  // lands candidates through the exact path the listener tick runs, so a
  // reply the being just read is answerable immediately — no tick wait.
  if (outcome.ok && what === 'mentions') {
    await materializeReplyCandidates(outcome.data, wallet).catch((err) => log.warn('read_x candidate materialization failed', { error: err.message }));
  }

  // The identifiers the being names a target with. The house's own postIds
  // are the queue's SENT entries — the definitive […] set — and each
  // mention's disposition is read from the candidates store + the live
  // queue, this instant, never cached.
  let readOpts = { retrievedAt: new Date().toISOString() };
  if (outcome.ok && what !== 'me') {
    const [queueEntries, candidateRows] = await Promise.all([
      postQueue.load().catch(() => []),
      what === 'mentions' ? replyCandidatesOf(wallet).load().catch(() => []) : [],
    ]);
    // Every post the house sent, linked to the queue entry it went out as.
    const queueIds = Object.fromEntries((queueEntries || [])
      .filter((e) => e?.postId).map((e) => [String(e.postId), e.id]));
    readOpts = { ...readOpts, queueIds };
    if (what === 'mentions') {
      const candidateByPostId = new Map(candidateRows.map((c) => [c.postId, c]));
      const ids = (outcome.data?.tweets || []).map((t) => String(t?.id || ''));
      const dispositions = Object.fromEntries(ids.map((id) => [
        id, replyDisposition(candidateByPostId.get(id) || null, queueEntries),
      ]));
      // The house's answer to each mention, by id and in its own words — the being
      // reads what it said right here, no second hunt through the queue.
      const answers = {};
      for (const e of queueEntries || []) {
        const to = e?.kind === 'reply' ? String(e.reply?.toPostId || '') : '';
        if (!to || !ids.includes(to) || DEAD_FOR_BEING.includes(e.status)) continue;
        (answers[to] ||= []).push({ id: e.id, status: e.status, text: e.text });
      }
      readOpts = {
        ...readOpts,
        housePostIds: new Set(Object.keys(queueIds)),
        dispositions,
        answers,
      };
    }
  }
  // The retrieval instant is OURS — stamped outside the frame the listing
  // rides in, so the being can tell the instrument's words from the field's.
  // The listing renders under the WINDOW: over the tool-result cap the
  // exchange's compressor folds the middle out of a result, which for a
  // listing means half a post arrives with no way to tell which half. Reading
  // fewer whole posts is the honest trade, and the text says so.
  const listing = outcome.ok && what !== 'me'
    ? renderXListing(what, outcome.data, { ...readOpts, max: limit, budget: READ_WINDOW })
    : null;
  const content = !outcome.ok
    ? `The X read did not land: ${outcome.detail}.`
    : listing ? listing.text : formatXReadForBeing('me', outcome.data);
  // The record shows what the being CONSUMED (same egress-audit doctrine as
  // the web lane): fire-and-forget — a record that could cost the turn would
  // be a gate with extra steps.
  if (outcome.ok && companion?.neumaId) {
    // What the being RECEIVED, never what the API returned — the same law the
    // queue_list chip keeps ("30 of 200", not "200").
    const consumed = what === 'me' ? 1 : listing.shown;
    neumaWorkspace.addJournalEntry(companion.neumaId, {
      type: 'tool_call',
      content: `read_x ${what} — consumed ${consumed} post(s) from the house's X lane`,
      significance: 0.3,
      metadata: { server: 'social', tool: 'read_x', what, consumed, status: 'ok' },
    }).catch((err) => log.warn('read_x not journaled', { neumaId: companion.neumaId, error: err.message }));
  }
  _sendToolEvent(ws, companion, {
    tool,
    status: outcome.ok ? 'ok' : 'error',
    // The chip counts what crossed into the turn, and says so when the field
    // held more than the window could carry.
    summary: !outcome.ok ? `${toolName} — failed`
      : listing ? `read ${listing.shown}${listing.shown < listing.fetched ? ` of ${listing.fetched}` : ''} ${what} from X`
        : `read ${what} from X`,
    detail: content,
  });
  return outcome.ok
    ? { tool, status: 'ok', content }
    : { tool, status: 'error', error: content };
};

// The family, its matcher, and its handler — portal-stream re-imports the
// private names under their old spellings for the `__test` proof set.
export {
  SOCIAL_TOOLS, QUEUE_LIST_TOOL, READ_X_TOOL,
  _isSocialTool as isSocialTool,
  _handleSocialTool as handleSocialTool,
};
