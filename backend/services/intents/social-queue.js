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
import { placeDraft } from '../social/queue-placement.js';
import { trackLinks, bindTrackedLinks } from '../social/queue-links.js';
import { houseOfLane } from '../social/house-positions.js';
import { usableAccounts, chooseAccount, postsAsWords, accountGuide } from './intent-account.js';
import { postQueue, validateDraft as validateQueueDraft } from '../social/post-queue.js';
import { resolvePostMedia } from '../social/post-media.js';
import { parseTikTokDraft } from '../social/tiktok-metadata.js';
import { tiktokStagingCheck } from '../social/tiktok-staging.js';
import { queueDescriptionFor, tiktokStagedWords, TIKTOK_VIDEO_FIX } from './social-queue-guide.js';
import { approveUnderMandate } from '../marketing/mandate/mandate-act.js';

// impure — the accounts this lane may STAGE for: crewed (or held) AND
// credentialed, in the lane's own house (house-positions.js). The queue
// intent's availability probe (intents-section asks each type once per turn).
const stageableAccounts = async (laneId) => usableAccounts({ house: await houseOfLane(laneId), laneId, mode: 'stage', needKeys: true });

const DESCRIPTION = 'Stage a post as a DRAFT in the channel\'s campaign queue — nothing is published now; your operator decides the draft, and it goes out at scheduledFor (ISO-8601) once approved. Use this for planned content and calendars. campaignId + angle place it in a campaign (the account it posts as names its sub-campaign); group: one short name shared by the posts that carry ONE asset to several accounts of one company — your operator approves the whole group with one press.';

// pure — a refused TikTok draft names the way forward when its video is the problem.
const withVideoFix = (channelId, reason) => (channelId === 'tiktok' ? `${reason}. ${TIKTOK_VIDEO_FIX}` : reason);

export const socialQueueIntent = Object.freeze({
  name: 'social/queue',
  // The ACTS policy row this intent rides (`intents` server in tool-policy).
  policyTool: 'social.queue',
  fieldsForPrompt: '{channel, text, scheduledFor?, campaignId?, angle?, group?, media?: [{image|path, alt}], account?}',
  descriptionForPrompt: DESCRIPTION,
  // The contract carries the rules of exactly the channels this lane may stage for.
  availableFor: async ({ laneId }) => {
    const accounts = await stageableAccounts(laneId);
    const channels = CHANNEL_CATALOG.map((c) => c.id).filter((id) => accounts.some((a) => a.channelId === id));
    const guide = accountGuide(accounts);
    return channels.length
      ? { channels, descriptionForPrompt: [queueDescriptionFor(DESCRIPTION, channels), guide].filter(Boolean).join(' ') }
      : null;
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

    const resolvedMedia = await resolvePostMedia(connection, payload?.media, { channelId: channel.id });
    if (!resolvedMedia.ok) return { ok: false, status: 'invalid', reason: withVideoFix(channel.id, `media refused: ${resolvedMedia.detail}`) };
    const media = resolvedMedia.media;

    // The queue's own validator guards this door — the rules a draft must meet
    // are identical whether it arrives from a being or over REST.
    const invalid = validateQueueDraft({ channelId: channel.id, text, scheduledFor, campaignId, pillar, media });
    if (invalid) return { ok: false, status: 'invalid', reason: media.length === 1 ? invalid : withVideoFix(channel.id, invalid) };

    // SECTOR CREW gate. Staging is WORK, not custody: anyone the operator put
    // on this sector's crew may draft into the queue, and the holder may too.
    // The holder's binding still stands alone in front of the actual send.
    const laneId = connection.companion?.neumaId || null;
    const house = await houseOfLane(laneId);
    const usable = await usableAccounts({ house, laneId, mode: 'stage', channelId: channel.id });
    if (!usable.length) {
      return { ok: false, status: 'denied', reason: `you are not on the ${channel.name} crew — ask your operator to add you to that sector before staging posts for it` };
    }
    const chosen = chooseAccount(usable, payload, channel);
    if (!chosen.ok) return { ok: false, status: 'denied', reason: chosen.reason };
    const accountId = chosen.account.id;
    // Its place in the house's marketing: the campaign, the sub (its account), the angle, the group.
    const placed = await placeDraft(house, { accountId, campaignId, angle: payload?.angle, pillar, group: payload?.group });
    if (placed.error) return { ok: false, status: 'invalid', reason: placed.error };
    // TikTok: the account it will post as, and a too-long video refused now, before any card.
    let tiktok = null;
    if (channel.id === 'tiktok') {
      const checked = await tiktokStagingCheck(house, media[0], { signal: connection.activeTurn?.signal, accountId });
      if (!checked.ok) return { ok: false, status: 'invalid', reason: checked.reason };
      tiktok = { mode: parseTikTokDraft(text).meta.mode, account: checked.account, note: checked.note };
    }
    const postsAs = await postsAsWords(house, chosen.account, tiktok?.account || null);
    return {
      ok: true,
      value: {
        channel, accountId, text, scheduledFor, media, tiktok, card: { 'posts as': postsAs, ...payload },
        campaignId: placed.campaignId, pillar: placed.pillar, angleId: placed.angleId, groupId: placed.groupId,
      },
    };
  },

  // The card says WHO WILL SPEAK first ("posts as"), then what was filed.
  cardArgs: (value) => value.card,

  // The one line the operator's card stakes the decision on. Pure.
  summarize: (payload) => {
    const channel = typeof payload?.channel === 'string' ? payload.channel : '?';
    const text = typeof payload?.text === 'string' ? payload.text.replace(/\s+/g, ' ').trim() : '';
    const when = typeof payload?.scheduledFor === 'string' && payload.scheduledFor.trim()
      ? `, scheduled ${payload.scheduledFor.trim()}` : '';
    return `stage a ${channel} draft${when}: "${text.slice(0, 140)}${text.length > 140 ? '…' : ''}"`;
  },

  // impure — the real queue store. Publishing stays the scheduler's act.
  execute: async ({ channel, accountId, text, scheduledFor, campaignId, pillar, angleId, groupId, media, tiktok }, { connection }) => {
    const author = connection.companion?.neumaId || null;
    // Its links become counted /go/ links, published to the site counter first (queue-links.js).
    const linkHouse = await houseOfLane(author);
    const tracked = await trackLinks(linkHouse, { channelId: channel.id, accountId, text, campaignId, angleId });
    let entry;
    try {
      entry = await postQueue.add({
        channelId: channel.id,
        accountId,
        text: tracked.text,
        scheduledFor,
        campaignId,
        pillar,
        angleId,
        groupId,
        media,
        authorNeumaId: author,
        queuedBy: author || '',
      });
    } catch (err) {
      return { ok: false, reason: `The draft could not be staged: ${err.message}.` };
    }
    await bindTrackedLinks(linkHouse, tracked.codes, entry.id);
    const linkNote = tracked.note ? ` (${tracked.note})` : '';
    if (tiktok) return { ok: true, detail: tiktokStagedWords({ id: entry.id, scheduledFor, ...tiktok }) };
    // THE MANDATE (marketing/mandate/): a post it covers is approved now and needs no card.
    const mandated = author ? await approveUnderMandate({ laneId: author, entry, sessionId: connection.sessionId || null, text }) : { covered: false };
    const when = scheduledFor ? `at ${scheduledFor}` : 'on the next pass, within a minute';
    if (mandated.covered) {
      return { ok: true, detail: `Staged and approved under your mandate: ${entry.id} goes out on ${channel.name} ${accountId} ${when}. Your operator sees it in DONE FOR YOU.` };
    }
    const note = mandated.tripped ? ` Your mandate is now PAUSED (${mandated.reason}) — your operator decides.`
      : mandated.held ? ` Your mandate does not cover this one (${mandated.reason}).` : '';
    return {
      ok: true,
      detail: `Staged draft ${entry.id} for ${channel.name} ${accountId}${scheduledFor ? `, scheduled for ${scheduledFor}` : ''}${linkNote}. Nothing is published yet — your operator decides this draft, and it goes out only if they approve.${note}`,
    };
  },
});
