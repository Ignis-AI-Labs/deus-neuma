/**
 * Social/queue tool definitions — the reply lane, the thread lane, the
 * do-not-engage mark, the queue-edit tools, their channel matchers, and the
 * per-neuma catalog (channelToolsFor).
 *
 * Extracted VERBATIM from portal-stream.js (size-law breakdown 2026-08-26,
 * docs/work/size-law-breakdown.md Part 1 step 2 / #278). Leaf module —
 * portal-stream imports it, never the reverse (direction law).
 */
import { CHANNEL_CATALOG, getChannel } from '../social/channel-registry.js';
import { loadChannelCredentials, resolveChannelCredential } from '../social/channel-credentials.js';
import { channelBindings, canNeumaPost } from '../social/channel-bindings.js';
import { houseOfLane } from '../social/house-positions.js';
import { sectorCrew, canStageForSector } from '../sector-crew.js';
import { REPLY_CAP_PER_CONVERSATION } from '../social/post-queue.js';
import { ownMediaChannel } from '../social/poster-registry.js';
import { PLATFORM_READ_TOOLS } from './platform-read-tools.js';

// --- Neuma-initiated social posts became INTENTS (Stage 2 of the
// being-tool-surface doctrine): publishing (social/post) and staging
// (social/queue) are filed as intent files and settled by the sweep
// (intents/intent-sweep.js) — never tool calls. The reply lane and the queue
// EDIT tools below stay tools this stage.

// THE REPLY LANE (Design note, 2026-07-28, second call; widened 2026-10-12 to any public post the
// operator approves an answer to): answer people — heartfully, open to every author
// (verification is displayed, never a gate), at most two answers per person
// PER CONVERSATION, every word behind the operator's approval. There is
// deliberately NO immediate reply tool: a public reply to a possibly hostile
// actor is more irreversible than a post, so the queue is the only surface a
// reply may leave from.
const X_QUEUE_REPLY_TOOL = Object.freeze({
  name: 'queue_reply_to_x',
  server: 'social',
  description: `Draft a reply to an X post — someone answering the house's own posts, or any other public post your operator wants the house to answer — args {toPostId, text, campaignId?, media?, awareness?}. toPostId is the post's id or its x.com link; read_x {what:'mentions'} shows the replies to the house with their ids. The post is read from X itself, so the card your operator approves names who you are answering and what they said. Nothing is published now: the answer lands in the REPLIES queue for your operator, and it goes out the MOMENT they approve it — a reply rides no calendar (Design note, 2026-08-06: what matters is the tone against what was said, not the clock). A post the house has set aside cannot be answered, only one live answer per post, and at most ${REPLY_CAP_PER_CONVERSATION} answers per person per conversation stand — the cap is counted from the queue. Answers expire after a day: the lane engages while the conversation is warm. Engage heartfully: one real answer in your own voice, never a form reply. Keep it under ${getChannel('x').maxChars} characters. Attach images with media: [{path, alt}] — the file must sit inside a folder your operator has open, and alt text is how part of your audience reads it at all.`,
  inputSchema: Object.freeze({
    type: 'object',
    properties: Object.freeze({
      toPostId: Object.freeze({ type: 'string', description: 'The id of the post being answered, or its x.com link' }),
      text: Object.freeze({ type: 'string', description: `The answer text, under ${getChannel('x').maxChars} characters` }),
      campaignId: Object.freeze({ type: 'string', description: 'Optional campaign this answer belongs to' }),
      awareness: Object.freeze({ type: 'boolean', description: 'true when your operator should see this answer before it goes — a fact you have not seen confirmed, anything you are unsure of. Under a mandate it keeps an answer from going out on its own; it never lets one out that would ask.' }),
      media: Object.freeze({
        type: 'array',
        description: 'Optional images to attach (up to 4). Each is {path, alt}: path is the ABSOLUTE path of an image file inside a folder your operator has open, and alt describes it for people who cannot see it. Always write alt text — an undescribed image is a post part of your audience cannot read.',
        items: Object.freeze({
          type: 'object',
          properties: Object.freeze({
            path: Object.freeze({ type: 'string', description: 'Absolute path to a JPEG, PNG, GIF or WEBP inside an open folder' }),
            alt: Object.freeze({ type: 'string', description: 'What the image shows, for a reader who cannot see it' }),
          }),
          required: Object.freeze(['path']),
        }),
      }),
    }),
    required: Object.freeze(['toPostId', 'text']),
  }),
});

// THE THREAD LANE (Founder/Kagipem 2026-07-29): a follow-up to one of the
// house's OWN queued posts — a thread. The parent is a QUEUE ENTRY, because
// the X id it answers does not exist until the parent sends; the follow-up
// carries NO schedule (it inherits the parent's moment), the parent goes
// first, and a dead parent takes the thread with it (Kagipem's law 7).
const X_QUEUE_SELF_REPLY_TOOL = Object.freeze({
  name: 'queue_self_reply_to_x',
  server: 'social',
  description: `Stage a FOLLOW-UP to one of the house's own queued X posts — a thread — args {parentQueueId, text, campaignId?, pillar?, media?}. parentQueueId is the parent post's queue id (queue_list shows every entry's id). The follow-up carries NO schedule of its own: it inherits the parent's moment — the parent publishes first, then this answers it immediately. Your operator decides each post's copy separately; editing the parent never touches this copy; if the parent is withdrawn or fails, this never publishes. Keep it under ${getChannel('x').maxChars} characters, in your own voice.`,
  inputSchema: Object.freeze({
    type: 'object',
    properties: Object.freeze({
      parentQueueId: Object.freeze({ type: 'string', description: 'The queue id of the house post this follows (queue_list shows ids)' }),
      text: Object.freeze({ type: 'string', description: `The follow-up text, under ${getChannel('x').maxChars} characters` }),
      campaignId: Object.freeze({ type: 'string', description: 'Optional campaign this thread belongs to' }),
      pillar: Object.freeze({ type: 'string', description: 'Optional content pillar this follow-up speaks from' }),
      media: Object.freeze({
        type: 'array',
        description: 'Optional images to attach (up to 4). Each is {path, alt}: path is the ABSOLUTE path of an image file inside a folder your operator has open, and alt describes it for people who cannot see it. Always write alt text.',
        items: Object.freeze({
          type: 'object',
          properties: Object.freeze({
            path: Object.freeze({ type: 'string', description: 'Absolute path to a JPEG, PNG, GIF or WEBP inside an open folder' }),
            alt: Object.freeze({ type: 'string', description: 'What the image shows, for a reader who cannot see it' }),
          }),
          required: Object.freeze(['path']),
        }),
      }),
    }),
    required: Object.freeze(['parentQueueId', 'text']),
  }),
});

// THE DO-NOT-ENGAGE MARK (ruling, 2026-07-28): some replies the house simply
// does not answer — bait, abuse, noise. Setting one aside is a DECISION and
// is recorded as one (who, when, why) on the candidate itself; the record of
// what was said is never deleted, the knock simply stops surfacing it.
const X_REPLY_DISMISS_TOOL = Object.freeze({
  name: 'reply_dismiss_to_x',
  server: 'social',
  description: 'Set a reply to the house aside — do-not-engage — args {toPostId, reason?}. toPostId is the reply\'s post id from replies_list or read_x. The reply goes to the BIN: the decision is recorded on the house\'s record (who set it aside, when, why), it never knocks again and leaves the unanswered inbox, and any unsent answer to it is pulled with it; nothing is deleted and nothing is published — replies_list {bucket:\'bin\'} reads it back, and your operator can restore it. Use for bait, abuse, or anything not worth the house\'s voice. To pull back only your own answer and keep the reply answerable, use queue_cancel.',
  inputSchema: Object.freeze({
    type: 'object',
    properties: Object.freeze({
      toPostId: Object.freeze({ type: 'string', description: 'The post id of the reply being set aside (from the mentions read)' }),
      reason: Object.freeze({ type: 'string', description: 'Why the house is not engaging this one' }),
    }),
    required: Object.freeze(['toPostId']),
  }),
});

// EDITING, not re-staging (#208 — Founder: […]). The entry
// keeps its id and its place in the record; the queue's own approval law
// decides what the edit means (words or images on an approved post renew the
// decision — it returns to draft; a schedule-only edit preserves it), and
// the operator's chip shows the DIFF — what each field WAS — never just the
// patch.
// A channel whose post IS its video (TikTok, YouTube) takes one: by the id of
// the being's own render, or by path.
const _videoMediaSchema = (video) => Object.freeze({
  type: 'array',
  description: `The ${video.name} post's ONE video: [{image, alt}] with image the id image/generate gave you for one of your own renders, or [{path, alt}] with the absolute path of a video in a folder your operator has open.`,
  items: Object.freeze({
    type: 'object',
    properties: Object.freeze({
      image: Object.freeze({ type: 'string', description: 'The id of one of your own videos (image/generate gave it)' }),
      path: Object.freeze({ type: 'string', description: 'Absolute path to an MP4, MOV or WebM inside an open folder' }),
      alt: Object.freeze({ type: 'string', description: 'What the video shows' }),
    }),
  }),
});

const _queueMediaSchema = (channel) => (ownMediaChannel(channel?.id) ? _videoMediaSchema(ownMediaChannel(channel.id)) : Object.freeze({
  type: 'array',
  description: 'Optional images to attach (up to 4). Each is {path, alt}: path is the ABSOLUTE path of an image file inside a folder your operator has open, and alt describes it for people who cannot see it. Always write alt text — an undescribed image is a post part of your audience cannot read.',
  items: Object.freeze({
    type: 'object',
    properties: Object.freeze({
      path: Object.freeze({ type: 'string', description: 'Absolute path to a JPEG, PNG, GIF or WEBP inside an open folder' }),
      alt: Object.freeze({ type: 'string', description: 'What the image shows, for a reader who cannot see it' }),
    }),
    required: Object.freeze(['path']),
  }),
}));

const _channelQueueUpdateTool = (channel) => Object.freeze({
  name: `queue_update_to_${channel.id}`,
  server: 'social',
  description: `Edit a staged ${channel.name} post IN PLACE — args {id, text?, scheduledFor?, campaignId?, pillar?, media?}; only the fields you pass change, so pass only what should move (media: [] clears the images). Use the FULL id from queue_list. Draft and approved posts only — sent copy is history. Editing the words or images of an APPROVED post returns it to draft for a fresh decision (your operator approved different copy); a schedule-only edit keeps the approval. Every edit records what the copy WAS. Never cancel-and-restage to change copy — updating keeps one honest record.`,
  inputSchema: Object.freeze({
    type: 'object',
    properties: Object.freeze({
      id: Object.freeze({ type: 'string', description: 'The full queue entry id from queue_list' }),
      text: Object.freeze({ type: 'string', description: `The new post text, under ${channel.maxChars} characters` }),
      scheduledFor: Object.freeze({ type: 'string', description: 'The new ISO-8601 publish time — or null to unschedule' }),
      campaignId: Object.freeze({ type: 'string', description: 'The campaign this post belongs to — or null to detach' }),
      pillar: Object.freeze({ type: 'string', description: 'The content pillar this post speaks from' }),
      media: _queueMediaSchema(channel),
    }),
    required: Object.freeze(['id']),
  }),
});

const _channelQueueBulkUpdateTool = (channel) => Object.freeze({
  name: `queue_bulk_update_to_${channel.id}`,
  server: 'social',
  description: `Edit several staged ${channel.name} posts in one call — args {updates: [{id, text?, scheduledFor?, campaignId?, pillar?, media?}, ...]}. Each entry is decided INDEPENDENTLY: the result names every id with its own verdict — landed or refused with its reason — so one bad patch never blocks the rest and nothing fails silently. Same law as queue_update_to_${channel.id}: words or images renew an approval, a schedule-only edit preserves it. Use this to retime a calendar or correct a campaign line in one act.`,
  inputSchema: Object.freeze({
    type: 'object',
    properties: Object.freeze({
      updates: Object.freeze({
        type: 'array',
        description: 'One object per post: {id, ...patch} — the full id from queue_list plus only the fields that should change',
        items: Object.freeze({ type: 'object' }),
      }),
    }),
    required: Object.freeze(['updates']),
  }),
});

// The channel a queue edit call targets, or null (accepts both dialects) —
// one matcher factory for the two edit prefixes.
const _queueEditToolChannel = (prefix) => (match) => {
  const dialects = [
    match.toolName,
    (typeof match.tool === 'string' && match.tool.startsWith('social/'))
      ? match.tool.slice('social/'.length) : null,
  ];
  for (const name of dialects) {
    if (typeof name === 'string' && name.startsWith(prefix)) {
      const channel = getChannel(name.slice(prefix.length));
      if (channel) return channel;
    }
  }
  return null;
};

export const queueUpdateToolChannel = _queueEditToolChannel('queue_update_to_');
export const queueBulkUpdateToolChannel = _queueEditToolChannel('queue_bulk_update_to_');

// The channel a queue_reply_to_* call targets, or null (accepts both
// dialects). Same matcher law as the edit lane's `_queueEditToolChannel`.
export const queueReplyToolChannel = (match) => {
  const dialects = [
    match.toolName,
    (typeof match.tool === 'string' && match.tool.startsWith('social/'))
      ? match.tool.slice('social/'.length) : null,
  ];
  for (const name of dialects) {
    if (typeof name === 'string' && name.startsWith('queue_reply_to_')) {
      const channel = getChannel(name.slice('queue_reply_to_'.length));
      if (channel) return channel;
    }
  }
  return null;
};

// The channel a queue_self_reply_to_* call targets, or null (accepts both
// dialects). Same matcher law as queueReplyToolChannel.
export const queueSelfReplyToolChannel = (match) => {
  const dialects = [
    match.toolName,
    (typeof match.tool === 'string' && match.tool.startsWith('social/'))
      ? match.tool.slice('social/'.length) : null,
  ];
  for (const name of dialects) {
    if (typeof name === 'string' && name.startsWith('queue_self_reply_to_')) {
      const channel = getChannel(name.slice('queue_self_reply_to_'.length));
      if (channel) return channel;
    }
  }
  return null;
};

// The channel a reply_dismiss_to_* call targets, or null (accepts both
// dialects). Same matcher law as queueReplyToolChannel.
export const replyDismissToolChannel = (match) => {
  const dialects = [
    match.toolName,
    (typeof match.tool === 'string' && match.tool.startsWith('social/'))
      ? match.tool.slice('social/'.length) : null,
  ];
  for (const name of dialects) {
    if (typeof name === 'string' && name.startsWith('reply_dismiss_to_')) {
      const channel = getChannel(name.slice('reply_dismiss_to_'.length));
      if (channel) return channel;
    }
  }
  return null;
};

// impure — the social tools this neuma may see this turn: bound to the
// channel AND fully credentialed. The reply lane and the queue EDIT tools are
// all that remain here — posting and staging are INTENTS now (Stage 2), filed
// as files and settled by the sweep, never called as tools. Fail closed: an
// unreadable store advertises nothing.
export const channelToolsFor = async (neumaId) => {
  if (!neumaId) return [];
  // The being's own house's keys, holders and crews (house-positions.js).
  const house = await houseOfLane(neumaId);
  const [store, bindings, crewStore] = await Promise.all([
    loadChannelCredentials(house).catch(() => ({})),
    channelBindings.load(house).catch(() => ({})),
    sectorCrew.load(house).catch(() => ({})),
  ]);
  const configured = new Set();
  for (const c of CHANNEL_CATALOG) {
    if (await resolveChannelCredential(house, c.id, store).catch(() => null)) configured.add(c.id);
  }
  // Two different reaches, so two different catalogs (Design note, 2026-07-26, […]): the HOLDER sees the reply lane; the crew only the
  // edit lane. Advertising a tool the gate will refuse teaches a being its
  // permissions by refusal — the exact thing annotateToolAccess exists to end.
  return CHANNEL_CATALOG
    .filter((c) => configured.has(c.id))
    .flatMap((c) => {
      // Reading a connected platform is every lane's in the house: each
      // platform its own read, equally (platform-read-tools.js).
      const read = PLATFORM_READ_TOOLS[c.id] ? [PLATFORM_READ_TOOLS[c.id]] : [];
      const holds = canNeumaPost(bindings, c.id, neumaId);
      // The reply lane is the HOLDER's engagement lane: the being that is
      // told about the candidates (the notification is binding-gated too) is
      // the being that may draft answers to them. The EDIT tools ride wherever
      // staging rights ride (#208) — shaping the calendar is crew work, and an
      // edit is governed exactly like a staging.
      if (holds) return [
        ...read,
        _channelQueueUpdateTool(c), _channelQueueBulkUpdateTool(c),
        ...(c.id === 'x' ? [X_QUEUE_REPLY_TOOL, X_QUEUE_SELF_REPLY_TOOL, X_REPLY_DISMISS_TOOL] : []),
      ];
      return canStageForSector(crewStore, bindings, c.id, neumaId)
        ? [...read, _channelQueueUpdateTool(c), _channelQueueBulkUpdateTool(c),
          ...(c.id === 'x' ? [X_QUEUE_SELF_REPLY_TOOL] : [])]
        : read;
    });
};

// The definitions channelToolsFor assembles, exported for the proof set —
// portal-stream re-imports them under their old private names.
export {
  X_QUEUE_REPLY_TOOL, X_QUEUE_SELF_REPLY_TOOL, X_REPLY_DISMISS_TOOL,
  _channelQueueUpdateTool as channelQueueUpdateTool,
  _channelQueueBulkUpdateTool as channelQueueBulkUpdateTool,
};
