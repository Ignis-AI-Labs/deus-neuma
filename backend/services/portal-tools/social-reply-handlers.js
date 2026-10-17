/**
 * Social reply-lane handlers — the thread follow-up (queue_self_reply_to_*),
 * the answer to a reply on the house's own posts (queue_reply_to_*), and the
 * do-not-engage mark (reply_dismiss_to_*).
 *
 * Extracted VERBATIM from portal-stream.js (size-law breakdown 2026-08-26,
 * docs/work/size-law-breakdown.md Part 1 step 2 / #278). Leaf module —
 * portal-stream imports it, never the reverse (direction law).
 */
import { basename } from 'path';
import { resolvePostMedia } from '../social/post-media.js';
import { postQueue, validateDraft as validateQueueDraft, replyCountForConversation, REPLY_CAP_PER_CONVERSATION } from '../social/post-queue.js';
import { channelBindings } from '../social/channel-bindings.js';
import { sectorCrew, canStageForSector } from '../sector-crew.js';
import { replyCandidates } from '../social/reply-candidates.js';
import { postIdFrom, readXReplyTarget } from '../social/x-reader.js';
import { gateAct } from '../act-gate.js';
import { sendToolEvent as _sendToolEvent } from './tool-events.js';

// impure — stage a FOLLOW-UP to one of the house's own queued posts: the
// thread lane (Founder/Kagipem 2026-07-29). The same machinery as the
// social/queue intent (media → shape → crew gate → ACTS chip → execute), plus
// the thread's own gate BEFORE the operator's card: the parent must be a
// REAL queue entry on this channel, and not a dead one — a card only ever
// describes a follow-up that can stand. The follow-up carries no schedule
// of its own; the parent's moment is its moment.
export const handleNeumaSelfReply = async (ws, connection, neumaPolicy, toolMode, args, channel) => {
  const toolName = `queue_self_reply_to_${channel.id}`;
  const tool = `social/${toolName}`;
  const { companion } = connection;
  const text = typeof args?.text === 'string' ? args.text.trim() : '';
  const parentQueueId = typeof args?.parentQueueId === 'string' ? args.parentQueueId.trim() : '';
  const campaignId = (typeof args?.campaignId === 'string' && args.campaignId.trim()) || null;
  const pillar = (typeof args?.pillar === 'string' && args.pillar.trim()) || '';

  // Media rides a thread post too — authorised BEFORE any gate or card,
  // same doctrine as the post path.
  const resolvedMedia = await resolvePostMedia(connection, args?.media);
  if (!resolvedMedia.ok) {
    _sendToolEvent(ws, companion, { tool, status: 'error', summary: `${toolName} — media refused`, detail: resolvedMedia.detail });
    return { tool, status: 'error', error: resolvedMedia.detail };
  }
  const media = resolvedMedia.media;

  if (!parentQueueId) {
    const error = `${toolName} needs {parentQueueId} — the parent post's queue id (queue_list shows every entry's id)`;
    _sendToolEvent(ws, companion, { tool, status: 'error', summary: `${toolName} — invalid args`, detail: error });
    return { tool, status: 'error', error };
  }

  // Shape first — the store's own validator guards this door (kind
  // self-reply: thread.parentId required, a schedule forbidden).
  const invalid = validateQueueDraft({
    channelId: channel.id, text, campaignId, pillar, media,
    kind: 'self-reply', thread: { parentId: parentQueueId },
  });
  if (invalid) {
    _sendToolEvent(ws, companion, { tool, status: 'error', summary: `${toolName} — invalid args`, detail: invalid });
    return { tool, status: 'error', error: invalid };
  }

  // THE PARENT GATE — real, on this channel, and able to publish. A being
  // cannot thread onto a post that does not exist, belongs to another
  // platform, or can never go out.
  const queueNow = await postQueue.load().catch(() => null);
  if (!queueNow) {
    const error = 'the campaign queue is unreadable — the parent cannot be proven, so nothing stages';
    _sendToolEvent(ws, companion, { tool, status: 'error', summary: `${toolName} — queue unreadable` });
    return { tool, status: 'error', error };
  }
  const parent = queueNow.find((e) => e.id === parentQueueId) || null;
  if (!parent) {
    const error = `no queue entry ${parentQueueId} — a thread follows one of the house's own queued posts (queue_list shows every entry's id)`;
    _sendToolEvent(ws, companion, { tool, status: 'denied', summary: `${toolName} — no such parent` });
    return { tool, status: 'denied', error };
  }
  if (parent.channelId !== channel.id) {
    const error = `${parentQueueId} is a ${parent.channelId} post — a thread stays on one platform`;
    _sendToolEvent(ws, companion, { tool, status: 'denied', summary: `${toolName} — parent is another platform` });
    return { tool, status: 'denied', error };
  }
  if (['withdrawn', 'rejected', 'failed'].includes(parent.status)) {
    const error = `the parent is ${parent.status} — it can never publish, so the thread cannot grow from it`;
    _sendToolEvent(ws, companion, { tool, status: 'denied', summary: `${toolName} — parent is ${parent.status}` });
    return { tool, status: 'denied', error };
  }

  // SECTOR CREW gate, re-read per call — same law as staging a post.
  const [bindings, crewStore] = await Promise.all([
    channelBindings.load().catch(() => ({})),
    sectorCrew.load().catch(() => ({})),
  ]);
  if (!canStageForSector(crewStore, bindings, channel.id, companion?.neumaId || null)) {
    const error = `you are not on the ${channel.name} crew — ask your operator to add you to that sector before threading for it`;
    _sendToolEvent(ws, companion, { tool, status: 'denied', summary: `${toolName} — not on the crew` });
    return { tool, status: 'denied', error };
  }

  // The ACTS gate on the act of staging (act-gate.js) — its OWN row, so an
  // ALWAYS granted here never unlocks the post or reply lanes. An interrupt
  // that landed while the card waited stops the staging too.
  const gate = await gateAct(connection, {
    server: 'social', tool: toolName,
    cardArgs: { parentQueueId, text, ...(campaignId ? { campaignId } : {}), ...(pillar ? { pillar } : {}) },
    lanePolicy: neumaPolicy, mode: toolMode,
    emit: (event) => _sendToolEvent(ws, companion, event),
  });
  if (!gate.ok) return gate.result;

  _sendToolEvent(ws, companion, { tool, status: 'executing' });
  let entry;
  try {
    entry = await postQueue.add({
      channelId: channel.id,
      text,
      campaignId,
      pillar,
      media,
      kind: 'self-reply',
      thread: { parentId: parentQueueId },
      authorNeumaId: companion?.neumaId || null,
      queuedBy: companion?.neumaId || '',
    });
  } catch (err) {
    const content = `The follow-up could not be staged: ${err.message}.`;
    _sendToolEvent(ws, companion, { tool, status: 'error', summary: `${toolName} — failed`, detail: content });
    return { tool, status: 'error', error: content };
  }
  const content = `Staged thread follow-up ${entry.id} under ${parentQueueId}${parent.scheduledFor ? ` (parent slotted ${parent.scheduledFor})` : ''}. Nothing is published yet — your operator decides this copy, and it answers the parent the moment the parent has published.`;
  _sendToolEvent(ws, companion, {
    tool, status: 'ok',
    summary: `thread follow-up queued (draft ${entry.id})`,
    detail: content,
  });
  return { tool, status: 'ok', content };
};

// impure — stage an answer to a post. The same machinery as the social/queue
// intent (validate → crew gate → ACTS chip → execute), plus the reply lane's
// own gates BEFORE the operator's card, so the card only ever describes an
// answer that can stand:
//   1. THE TARGET IS REAL: a reply to the house's own posts comes from the
//      house's record (and one the house set aside stays set aside); ANY
//      OTHER public post is read live from X (Design note, 2026-10-12: […]). Either way
//      who it answers and what they said come from the record or from X —
//      never from the being's say-so — and the operator's card shows both.
//      (Design note, 2026-07-28: verification is DISPLAYED, never a gate.)
//   2. The cap, re-counted FROM THE QUEUE at stage time, per (person,
//      conversation): a candidate answered twice by hand is still capped,
//      and a new conversation with the same person is a fresh count.
// The linkage on the entry comes from the CANDIDATE, never from the being's
// say-so — a draft cannot claim to answer someone it doesn't.
export const handleNeumaReply = async (ws, connection, neumaPolicy, toolMode, args, channel) => {
  const toolName = `queue_reply_to_${channel.id}`;
  const tool = `social/${toolName}`;
  const { companion } = connection;
  const text = typeof args?.text === 'string' ? args.text.trim() : '';
  // The post's id, or its x.com link (what an operator pastes).
  const toPostId = postIdFrom(args?.toPostId);
  // No scheduledFor here BY LAW (Design note, 2026-08-06: a reply rides no calendar —
  // it goes out the moment the operator approves it. A caller naming one is
  // refused by validateQueueDraft with the store's own reason.
  const campaignId = (typeof args?.campaignId === 'string' && args.campaignId.trim()) || null;

  // Media rides a reply too — authorised BEFORE any gate or card, same
  // doctrine as the post path: an unreachable path should cost the operator
  // nothing, and the card they answer must describe an answer that can
  // actually be sent.
  const resolvedMedia = await resolvePostMedia(connection, args?.media);
  if (!resolvedMedia.ok) {
    _sendToolEvent(ws, companion, { tool, status: 'error', summary: `${toolName} — media refused`, detail: resolvedMedia.detail });
    return { tool, status: 'error', error: resolvedMedia.detail };
  }
  const media = resolvedMedia.media;

  if (!toPostId) {
    const error = `${toolName} needs {toPostId} — the post's id or its x.com link (read_x {what:'mentions'} shows the replies to the house)`;
    _sendToolEvent(ws, companion, { tool, status: 'error', summary: `${toolName} — invalid args`, detail: error });
    return { tool, status: 'error', error };
  }

  // Shape first: channel, text, the target's id form, and the media. The
  // toUserId here is a stand-in for the shape check — the REAL linkage
  // arrives with the candidate below and is validated again by postQueue.add.
  const invalid = validateQueueDraft({
    // A named schedule is refused by the store's reply law with its own
    // reason; a blank one is simply no schedule, not a refusal.
    channelId: channel.id,
    text,
    scheduledFor: (typeof args?.scheduledFor === 'string' && args.scheduledFor.trim()) || null,
    campaignId,
    kind: 'reply',
    reply: { toPostId, toUserId: '0' },
    media,
  });
  if (invalid) {
    _sendToolEvent(ws, companion, { tool, status: 'error', summary: `${toolName} — invalid args`, detail: invalid });
    return { tool, status: 'error', error: invalid };
  }

  // Gate 1 — the target is real: the house's record first, else X itself.
  let candidate = await replyCandidates.byPostId(toPostId).catch(() => null);
  if (!candidate) {
    const live = await readXReplyTarget(toPostId);
    if (!live.ok) {
      const error = `X could not show that post (${live.detail}) — nothing to answer`;
      _sendToolEvent(ws, companion, { tool, status: 'denied', summary: `${toolName} — post not found` });
      return { tool, status: 'denied', error };
    }
    candidate = { ...live.target, category: 'outreach', dismissed: false };
  }
  if (candidate.dismissed) {
    const error = `that one was set aside${candidate.dismissedBy ? ` by ${candidate.dismissedBy}` : ''}${candidate.reason ? ` (${candidate.reason})` : ''} — the house is not engaging it.`;
    _sendToolEvent(ws, companion, { tool, status: 'denied', summary: `${toolName} — set aside` });
    return { tool, status: 'denied', error };
  }
  if (!candidate.authorId) {
    const error = 'that reply\'s author never expanded on the read, so the per-conversation cap cannot be counted honestly — not answerable';
    _sendToolEvent(ws, companion, { tool, status: 'denied', summary: `${toolName} — author unknown` });
    return { tool, status: 'denied', error };
  }

  // Gate 2 — the cap, counted from the real queue this instant, per (person,
  // conversation).
  const queueNow = await postQueue.load().catch(() => null);
  if (!queueNow) {
    const error = 'the campaign queue is unreadable — the cap cannot be counted, so nothing stages';
    _sendToolEvent(ws, companion, { tool, status: 'error', summary: `${toolName} — queue unreadable` });
    return { tool, status: 'error', error };
  }
  const standing = replyCountForConversation(queueNow, candidate.authorId, candidate.conversationId ?? null);
  if (standing >= REPLY_CAP_PER_CONVERSATION) {
    const error = `${standing} answer(s) to @${candidate.username || 'this account'} on this conversation already stand — the house engages heartfully, never endlessly (at most ${REPLY_CAP_PER_CONVERSATION} per conversation).`;
    _sendToolEvent(ws, companion, { tool, status: 'denied', summary: `${toolName} — the cap stands` });
    return { tool, status: 'denied', error };
  }

  // SECTOR CREW gate, re-read per call — same law as staging a post.
  const [bindings, crewStore] = await Promise.all([
    channelBindings.load().catch(() => ({})),
    sectorCrew.load().catch(() => ({})),
  ]);
  if (!canStageForSector(crewStore, bindings, channel.id, companion?.neumaId || null)) {
    const error = `you are not on the ${channel.name} crew — ask your operator to add you to that sector before answering for it`;
    _sendToolEvent(ws, companion, { tool, status: 'denied', summary: `${toolName} — not on the crew` });
    return { tool, status: 'denied', error };
  }

  // The ACTS gate on the act of staging (act-gate.js) — its OWN row, so an
  // ALWAYS granted here never unlocks post_to_x or queue_post_to_x. An
  // interrupt that landed while the card waited stops the staging too.
  const gate = await gateAct(connection, {
    server: 'social', tool: toolName,
    cardArgs: {
      text,
      toPostId,
      toUsername: candidate.username || '',
      toVerifiedType: candidate.verifiedType || 'none',
      answering: candidate.text.slice(0, 140),
      // The attachments the card must name — a reply approved blind to its
      // images is not the answer the operator decided. Filename + alt (or
      // its honest absence), never the raw path: the card is a summary.
      ...(media.length
        ? { media: media.map((m) => ({ file: basename(m.path), alt: m.alt || null })) }
        : {}),
      ...(campaignId ? { campaignId } : {}),
    },
    lanePolicy: neumaPolicy, mode: toolMode,
    emit: (event) => _sendToolEvent(ws, companion, event),
  });
  if (!gate.ok) return gate.result;

  _sendToolEvent(ws, companion, { tool, status: 'executing' });
  let entry;
  try {
    entry = await postQueue.add({
      channelId: channel.id,
      text,
      campaignId,
      kind: 'reply',
      media,
      reply: {
        toPostId: candidate.postId,
        toUserId: candidate.authorId,
        toUsername: candidate.username || '',
        // Verbatim from the record, bounded by the store's own shape law.
        toTextPreview: candidate.text.slice(0, 280),
        toVerifiedType: candidate.verifiedType || '',
        conversationId: candidate.conversationId || null,
        category: candidate.category || 'ordinary',
      },
      authorNeumaId: companion?.neumaId || null,
      queuedBy: companion?.neumaId || '',
    });
  } catch (err) {
    const content = `The reply could not be staged: ${err.message}.`;
    _sendToolEvent(ws, companion, { tool, status: 'error', summary: `${toolName} — failed`, detail: content });
    return { tool, status: 'error', error: content };
  }
  const content = `Staged reply draft ${entry.id} answering @${candidate.username || 'the account'}. Nothing is published yet — your operator decides this answer, and the moment they approve it, it goes out.`;
  _sendToolEvent(ws, companion, {
    tool, status: 'ok',
    summary: `reply queued for ${channel.name} (draft ${entry.id})`,
    detail: content,
  });
  return { tool, status: 'ok', content };
};

// impure — record a DO-NOT-ENGAGE decision on one candidate. The same
// machinery shape as handleNeumaReply (record gate → crew gate → fail-closed
// ACTS chip → execute), but nothing stages and nothing publishes: the mark
// lands on the candidate and the knock stops surfacing it. The record is
// never deleted — a dismissal is a decision, and decisions stay auditable.
export const handleNeumaReplyDismiss = async (ws, connection, neumaPolicy, toolMode, args, channel) => {
  const toolName = `reply_dismiss_to_${channel.id}`;
  const tool = `social/${toolName}`;
  const { companion } = connection;
  const toPostId = typeof args?.toPostId === 'string' ? args.toPostId.trim() : '';
  const reason = typeof args?.reason === 'string' ? args.reason.replace(/\s+/g, ' ').trim().slice(0, 200) : '';

  if (!toPostId) {
    const error = `${toolName} needs {toPostId} — the reply's post id from read_x {what:'mentions'}`;
    _sendToolEvent(ws, companion, { tool, status: 'error', summary: `${toolName} — invalid args`, detail: error });
    return { tool, status: 'error', error };
  }

  // The record is the target list — same law as answering: a being cannot
  // set aside a post the house never saw.
  const candidate = await replyCandidates.byPostId(toPostId).catch(() => null);
  if (!candidate) {
    const error = 'that reply is not on the house\'s record — read the field with read_x {what:\'mentions\'} and name one you actually saw.';
    _sendToolEvent(ws, companion, { tool, status: 'denied', summary: `${toolName} — not a reply to the house` });
    return { tool, status: 'denied', error };
  }

  // SECTOR CREW gate, re-read per call — same law as staging an answer.
  const [bindings, crewStore] = await Promise.all([
    channelBindings.load().catch(() => ({})),
    sectorCrew.load().catch(() => ({})),
  ]);
  if (!canStageForSector(crewStore, bindings, channel.id, companion?.neumaId || null)) {
    const error = `you are not on the ${channel.name} crew — ask your operator to add you to that sector before deciding for it`;
    _sendToolEvent(ws, companion, { tool, status: 'denied', summary: `${toolName} — not on the crew` });
    return { tool, status: 'denied', error };
  }

  // The ACTS gate on the decision (act-gate.js) — its OWN row, fail-closed
  // like every governed act. An interrupt that landed while the card waited
  // stops the mark too.
  const gate = await gateAct(connection, {
    server: 'social', tool: toolName,
    cardArgs: {
      toPostId,
      toUsername: candidate.username || '',
      settingAside: candidate.text.slice(0, 140),
      ...(reason ? { reason } : {}),
    },
    lanePolicy: neumaPolicy, mode: toolMode,
    emit: (event) => _sendToolEvent(ws, companion, event),
  });
  if (!gate.ok) return gate.result;

  _sendToolEvent(ws, companion, { tool, status: 'executing' });
  const marked = await replyCandidates.dismiss(toPostId, {
    by: companion?.name || 'being',
    reason,
  }).catch((err) => ({ ok: false, error: err.message }));
  if (!marked.ok) {
    _sendToolEvent(ws, companion, { tool, status: 'error', summary: `${toolName} — failed`, detail: marked.error });
    return { tool, status: 'error', error: marked.error };
  }
  const content = `Set aside the reply from @${candidate.username || 'the account'}${reason ? ` (${reason})` : ''}. The record of what they said stands; the house simply will not engage it, and it stops surfacing as answerable.`;
  _sendToolEvent(ws, companion, {
    tool, status: 'ok',
    summary: `reply set aside (${channel.name})`,
    detail: content,
  });
  return { tool, status: 'ok', content };
};
