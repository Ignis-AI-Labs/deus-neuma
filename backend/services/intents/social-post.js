/**
 * social/post — the intent type that publishes a post NOW. Stage 2 of
 * docs/planning/proposals/being-tool-surface-primitives.md: this was the
 * `post_to_<channel>` tool (portal-stream.js `handleNeumaPost`) until the act
 * became a filed intent. The ACTS card, the journal, and the result file are
 * the sweep's (intent-sweep.js); this module is the shape law, the standing
 * rule, and the executor — relocated unchanged in substance.
 *
 * validate() answers { ok: true, value } | { ok: false, status, reason } —
 * 'invalid' for a malformed payload, 'denied' for a standing-rule refusal
 * (the single-holder channel law). validate runs BEFORE the operator's card,
 * so a card only ever describes a post that can stand.
 */
import { getChannel, CHANNEL_CATALOG } from '../social/channel-registry.js';
import { resolveAccountCredential } from '../social/account-store.js';
import { houseOfLane } from '../social/house-positions.js';
import { usableAccounts, chooseAccount, postsAsWords, accountGuide } from './intent-account.js';
import { readMediaFile, setAltText, uploadMedia } from '../social/x-media.js';
import { posterFor } from '../social/poster-registry.js';
import { resolvePostMedia } from '../social/post-media.js';
import { checkOutboundSecrets } from '../security/outbound-secrets.js';
import { markedMedia } from '../social/disclosure-line.js';

// Defensive ceiling only — each API is the authority on its own limit (local
// counting gets CJK/URL weighting wrong in both directions).
const POST_MAX_CHARS = 4000;

// impure — the accounts this lane may SPEAK through: held AND credentialed,
// in the lane's own house (house-positions.js). A queue-only channel
// (YouTube) is never offered for an instant post.
const speakableAccounts = async (laneId) => {
  const usable = await usableAccounts({ house: await houseOfLane(laneId), laneId, mode: 'hold', needKeys: true });
  return usable.filter((a) => !getChannel(a.channelId)?.queueOnly);
};

const POST_DESCRIPTION = 'Publish a post NOW through a channel you hold — outward-facing speech, permanent and public. media: [{path, alt}] — each file must sit inside a folder your operator has open; always write alt text.';

export const socialPostIntent = Object.freeze({
  name: 'social/post',
  // The ACTS policy row this intent rides (`intents` server in tool-policy).
  policyTool: 'social.post',
  fieldsForPrompt: '{channel, text, media?, account?}',
  descriptionForPrompt: POST_DESCRIPTION,
  availableFor: async ({ laneId }) => {
    const accounts = await speakableAccounts(laneId);
    const channels = CHANNEL_CATALOG.map((c) => c.id).filter((id) => accounts.some((a) => a.channelId === id));
    const guide = accountGuide(accounts);
    return channels.length ? { channels, ...(guide ? { descriptionForPrompt: `${POST_DESCRIPTION} ${guide}` } : {}) } : null;
  },

  // impure — media authorization reads the disk, the binding reads its store
  // (re-read per act: a released channel refuses the former holder's very
  // next intent).
  validate: async (payload, { connection }) => {
    const channel = typeof payload?.channel === 'string' ? getChannel(payload.channel.trim()) : null;
    if (!channel) {
      return { ok: false, status: 'invalid', reason: `unknown channel "${payload?.channel ?? ''}" — the INTENTS section names the channels you may speak through` };
    }
    if (channel.queueOnly) {
      return { ok: false, status: 'invalid', reason: `${channel.name} posts go through the campaign queue (social/queue) so your operator sees the video before it goes out; there is no instant ${channel.name} post` };
    }
    // The words go out exactly as written; that a being made the post rides in
    // its metadata, its images' alt text (disclosure-line.js).
    const text = typeof payload?.text === 'string' ? payload.text.trim() : '';
    // Media is authorised BEFORE the operator's card: an unreachable path
    // should cost the operator nothing, and the card they answer should
    // describe a post that can actually be sent.
    const resolvedMedia = await resolvePostMedia(connection, payload?.media);
    if (!resolvedMedia.ok) return { ok: false, status: 'invalid', reason: `media refused: ${resolvedMedia.detail}` };
    if (!text || text.length > POST_MAX_CHARS) {
      return { ok: false, status: 'invalid', reason: text ? 'the post text is far beyond any postable length' : 'the post needs text' };
    }
    if (channel.maxChars && text.length > channel.maxChars) {
      return { ok: false, status: 'invalid', reason: `the post is ${text.length} characters — ${channel.name} allows at most ${channel.maxChars}` };
    }
    // A key in a public post is out for good: refused before any card.
    const secret = checkOutboundSecrets('the post', [text, ...resolvedMedia.media.map((m) => m.alt)]);
    if (!secret.ok) return { ok: false, status: 'denied', reason: secret.reason };
    // The single-holder law, fail closed: a channel is one being's position,
    // and an unreadable bindings store denies everyone (no cross-routing).
    // The account is one being's position, fail closed: an unreadable store
    // denies everyone (no cross-routing).
    const laneId = connection.companion?.neumaId || null;
    const house = await houseOfLane(laneId);
    const usable = await usableAccounts({ house, laneId, mode: 'hold', channelId: channel.id });
    if (!usable.length) {
      return { ok: false, status: 'denied', reason: `this channel is not yours to speak through — only the neuma your operator bound to a ${channel.name} account may post there` };
    }
    const chosen = chooseAccount(usable, payload, channel);
    if (!chosen.ok) return { ok: false, status: 'denied', reason: chosen.reason };
    const postsAs = await postsAsWords(house, chosen.account);
    // A being's post: its images' alt text opens with the AI marker, on the card as it will go out.
    const media = markedMedia({ authorNeumaId: 'being', media: resolvedMedia.media });
    return {
      ok: true,
      value: { channel, accountId: chosen.account.id, text, media, house, card: { 'posts as': postsAs, ...payload, text, ...(media.length ? { media } : {}) } },
    };
  },

  // The card says WHO WILL SPEAK first ("posts as"), then what was filed.
  cardArgs: (value) => value.card,

  // The one line the operator's card stakes the decision on. Pure.
  summarize: (payload) => {
    const channel = typeof payload?.channel === 'string' ? payload.channel : '?';
    const text = typeof payload?.text === 'string' ? payload.text.replace(/\s+/g, ' ').trim() : '';
    return `publish to ${channel} NOW: "${text.slice(0, 140)}${text.length > 140 ? '…' : ''}"`;
  },

  // impure — the real platform API. The signal rides into the HTTP calls so a
  // barge-in mid-flight aborts the publish too.
  execute: async ({ channel, accountId, text, media, house }, { signal }) => {
    const credentials = await resolveAccountCredential(house, accountId).catch(() => null);
    // Upload first — it publishes nothing, so the post below stays the one
    // irreversible act. A media failure aborts the post entirely: half a
    // composition is not what was approved.
    const mediaIds = [];
    for (const item of media) {
      const read = await readMediaFile(item.path);
      if (!read.ok) return { ok: false, reason: `media refused: ${read.detail}` };
      const up = await uploadMedia(credentials, read, { signal });
      if (!up.ok) return { ok: false, reason: `the image did not upload: ${up.detail}` };
      if (item.alt) await setAltText(credentials, up.mediaId, item.alt, { signal });
      mediaIds.push(up.mediaId);
    }
    const outcome = await posterFor(channel.id)(credentials, text, { signal, mediaIds });
    return outcome.ok
      ? { ok: true, detail: `Posted to ${channel.name} as ${accountId}. Post id ${outcome.id}.` }
      : { ok: false, reason: `The post was not published: ${outcome.detail}.` };
  },
});
