/**
 * social/queue — the intent type that STAGES a post into the campaign queue.
 * Stage 2 of docs/planning/proposals/being-tool-surface-primitives.md: this
 * was the `queue_post_to_<channel>` tool (portal-stream.js handleNeumaQueue)
 * until the act became a filed intent. Staging is not egress — the operator
 * decides every draft, and the scheduler re-checks the binding again at send
 * time — but the single-holder law still holds at this door: no being ever
 * fills a calendar it does not work (the SECTOR CREW rule, re-read per act).
 *
 * validate() answers { ok: true, value } | { ok: false, status, reason } and
 * runs BEFORE the operator's card, so a card only ever describes a draft that
 * can stand.
 */
import { getChannel, CHANNEL_CATALOG } from '../social/channel-registry.js';
import { loadChannelCredentials, resolveChannelCredential } from '../social/channel-credentials.js';
import { channelBindings } from '../social/channel-bindings.js';
import { houseOfLane } from '../social/house-positions.js';
import { sectorCrew, canStageForSector } from '../sector-crew.js';
import { postQueue, validateDraft as validateQueueDraft } from '../social/post-queue.js';
import { resolvePostMedia } from '../social/post-media.js';

// impure — the channels this lane may STAGE for: crewed (or held) AND
// credentialed, in the lane's own house (house-positions.js). The queue
// intent's availability probe (intents-section asks each type once per turn).
const stageableChannels = async (laneId) => {
  const house = await houseOfLane(laneId);
  const [store, bindings, crewStore] = await Promise.all([
    loadChannelCredentials(house).catch(() => ({})),
    channelBindings.load(house).catch(() => ({})),
    sectorCrew.load(house).catch(() => ({})),
  ]);
  const crewed = CHANNEL_CATALOG.filter((c) => canStageForSector(crewStore, bindings, c.id, laneId));
  const out = [];
  for (const c of crewed) {
    if (await resolveChannelCredential(house, c.id, store).catch(() => null)) out.push(c.id);
  }
  return out;
};

export const socialQueueIntent = Object.freeze({
  name: 'social/queue',
  // The ACTS policy row this intent rides (`intents` server in tool-policy).
  policyTool: 'social.queue',
  fieldsForPrompt: '{channel, text, scheduledFor?, campaignId?, pillar?, media?}',
  descriptionForPrompt: 'Stage a post as a DRAFT in the channel\'s campaign queue — nothing is published now; your operator decides the draft, and it goes out at scheduledFor (ISO-8601) once approved. Use this for planned content and calendars.',
  availableFor: async ({ laneId }) => {
    const channels = await stageableChannels(laneId);
    return channels.length ? { channels } : null;
  },

  // impure — media authorization reads the disk; the crew/binding stores are
  // re-read per act (fail closed: an unreadable store on either side denies).
  validate: async (payload, { connection }) => {
    const channel = typeof payload?.channel === 'string' ? getChannel(payload.channel.trim()) : null;
    if (!channel) {
      return { ok: false, status: 'invalid', reason: `unknown channel "${payload?.channel ?? ''}" — the INTENTS section names the channels you may stage for` };
    }
    const text = typeof payload?.text === 'string' ? payload.text.trim() : '';
    const scheduledFor = (typeof payload?.scheduledFor === 'string' && payload.scheduledFor.trim()) || null;
    const campaignId = (typeof payload?.campaignId === 'string' && payload.campaignId.trim()) || null;
    const pillar = (typeof payload?.pillar === 'string' && payload.pillar.trim()) || '';

    const resolvedMedia = await resolvePostMedia(connection, payload?.media);
    if (!resolvedMedia.ok) return { ok: false, status: 'invalid', reason: `media refused: ${resolvedMedia.detail}` };
    const media = resolvedMedia.media;

    // The queue's own validator guards this door — the rules a draft must meet
    // are identical whether it arrives from a being or over REST.
    const invalid = validateQueueDraft({ channelId: channel.id, text, scheduledFor, campaignId, pillar, media });
    if (invalid) return { ok: false, status: 'invalid', reason: invalid };

    // SECTOR CREW gate. Staging is WORK, not custody: anyone the operator put
    // on this sector's crew may draft into the queue, and the holder may too.
    // The holder's binding still stands alone in front of the actual send.
    const house = await houseOfLane(connection.companion?.neumaId);
    const [bindings, crewStore] = await Promise.all([
      channelBindings.load(house).catch(() => ({})),
      sectorCrew.load(house).catch(() => ({})),
    ]);
    if (!canStageForSector(crewStore, bindings, channel.id, connection.companion?.neumaId || null)) {
      return { ok: false, status: 'denied', reason: `you are not on the ${channel.name} crew — ask your operator to add you to that sector before staging posts for it` };
    }
    return { ok: true, value: { channel, text, scheduledFor, campaignId, pillar, media } };
  },

  // The one line the operator's card stakes the decision on. Pure.
  summarize: (payload) => {
    const channel = typeof payload?.channel === 'string' ? payload.channel : '?';
    const text = typeof payload?.text === 'string' ? payload.text.replace(/\s+/g, ' ').trim() : '';
    const when = typeof payload?.scheduledFor === 'string' && payload.scheduledFor.trim()
      ? `, scheduled ${payload.scheduledFor.trim()}` : '';
    return `stage a ${channel} draft${when}: "${text.slice(0, 140)}${text.length > 140 ? '…' : ''}"`;
  },

  // impure — the real queue store. Publishing stays the scheduler's act.
  execute: async ({ channel, text, scheduledFor, campaignId, pillar, media }, { connection }) => {
    const author = connection.companion?.neumaId || null;
    let entry;
    try {
      entry = await postQueue.add({
        channelId: channel.id,
        text,
        scheduledFor,
        campaignId,
        pillar,
        media,
        authorNeumaId: author,
        queuedBy: author || '',
      });
    } catch (err) {
      return { ok: false, reason: `The draft could not be staged: ${err.message}.` };
    }
    return {
      ok: true,
      detail: `Staged draft ${entry.id} for ${channel.name}${scheduledFor ? `, scheduled for ${scheduledFor}` : ''}. Nothing is published yet — your operator decides this draft, and it goes out only if they approve.`,
    };
  },
});
