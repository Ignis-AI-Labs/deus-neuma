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
import { loadChannelCredentials, resolveChannelCredential } from '../social/channel-credentials.js';
import { channelBindings, canNeumaPost } from '../social/channel-bindings.js';
import { houseOfLane } from '../social/house-positions.js';
import { readMediaFile, setAltText, uploadMedia } from '../social/x-media.js';
import { posterFor } from '../social/poster-registry.js';
import { resolvePostMedia } from '../social/post-media.js';
import { checkOutboundSecrets } from '../security/outbound-secrets.js';

// Defensive ceiling only — each API is the authority on its own limit (local
// counting gets CJK/URL weighting wrong in both directions).
const POST_MAX_CHARS = 4000;

// impure — the channels this lane may SPEAK through: held AND credentialed,
// in the lane's own house (house-positions.js). Shared by the post intent's
// availability probe and the queue intent's crew probe (intents-section asks
// each type once per turn).
const speakableChannels = async (laneId) => {
  const house = await houseOfLane(laneId);
  const [store, bindings] = await Promise.all([
    loadChannelCredentials(house).catch(() => ({})),
    channelBindings.load(house).catch(() => ({})),
  ]);
  const held = CHANNEL_CATALOG.filter((c) => canNeumaPost(bindings, c.id, laneId));
  const out = [];
  for (const c of held) {
    if (await resolveChannelCredential(house, c.id, store).catch(() => null)) out.push(c.id);
  }
  return out;
};

export const socialPostIntent = Object.freeze({
  name: 'social/post',
  // The ACTS policy row this intent rides (`intents` server in tool-policy).
  policyTool: 'social.post',
  fieldsForPrompt: '{channel, text, media?}',
  descriptionForPrompt: 'Publish a post NOW through a channel you hold — outward-facing speech, permanent and public. media: [{path, alt}] — each file must sit inside a folder your operator has open; always write alt text.',
  availableFor: async ({ laneId }) => {
    const channels = await speakableChannels(laneId);
    return channels.length ? { channels } : null;
  },

  // impure — media authorization reads the disk, the binding reads its store
  // (re-read per act: a released channel refuses the former holder's very
  // next intent).
  validate: async (payload, { connection }) => {
    const channel = typeof payload?.channel === 'string' ? getChannel(payload.channel.trim()) : null;
    if (!channel) {
      return { ok: false, status: 'invalid', reason: `unknown channel "${payload?.channel ?? ''}" — the INTENTS section names the channels you may speak through` };
    }
    const text = typeof payload?.text === 'string' ? payload.text.trim() : '';
    // Media is authorised BEFORE the operator's card: an unreachable path
    // should cost the operator nothing, and the card they answer should
    // describe a post that can actually be sent.
    const resolvedMedia = await resolvePostMedia(connection, payload?.media);
    if (!resolvedMedia.ok) return { ok: false, status: 'invalid', reason: `media refused: ${resolvedMedia.detail}` };
    if (!text || text.length > POST_MAX_CHARS) {
      return { ok: false, status: 'invalid', reason: text ? 'the post text is far beyond any postable length' : 'the post needs text' };
    }
    // A key in a public post is out for good: refused before any card.
    const secret = checkOutboundSecrets('the post', [text, ...resolvedMedia.media.map((m) => m.alt)]);
    if (!secret.ok) return { ok: false, status: 'denied', reason: secret.reason };
    // The single-holder law, fail closed: a channel is one being's position,
    // and an unreadable bindings store denies everyone (no cross-routing).
    const house = await houseOfLane(connection.companion?.neumaId);
    const bindings = await channelBindings.load(house).catch(() => ({}));
    if (!canNeumaPost(bindings, channel.id, connection.companion?.neumaId || null)) {
      return { ok: false, status: 'denied', reason: `this channel is not yours to speak through — only the neuma your operator bound to ${channel.name} may post there` };
    }
    return { ok: true, value: { channel, text, media: resolvedMedia.media, house } };
  },

  // The one line the operator's card stakes the decision on. Pure.
  summarize: (payload) => {
    const channel = typeof payload?.channel === 'string' ? payload.channel : '?';
    const text = typeof payload?.text === 'string' ? payload.text.replace(/\s+/g, ' ').trim() : '';
    return `publish to ${channel} NOW: "${text.slice(0, 140)}${text.length > 140 ? '…' : ''}"`;
  },

  // impure — the real platform API. The signal rides into the HTTP calls so a
  // barge-in mid-flight aborts the publish too.
  execute: async ({ channel, text, media, house }, { signal }) => {
    const credentials = await resolveChannelCredential(house, channel.id).catch(() => null);
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
      ? { ok: true, detail: `Posted to ${channel.name}. Post id ${outcome.id}.` }
      : { ok: false, reason: `The post was not published: ${outcome.detail}.` };
  },
});
