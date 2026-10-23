// Flight tests — every connection proves itself LIVE (Design note, 2026-07-28:
// […]).
//
// A configured key is a claim; a flight test is the proof: the platform
// accepts the credential, answers, and names the account. One probe per
// channel, each NEVER throwing (a disconnected rig, a dead endpoint, and a
// bad key are all answers — the board shows them, it does not break).
// Unconfigured is `ok: null`, honestly: nothing to prove, nothing to fail.
//
// Each platform's env door aims its REAL probe at a loopback server in the
// platform's own tests — the same law as NEUMA_X_API_ROOT. Probes are
// cached briefly (60s): external identity endpoints are rate-limited, and
// a board that re-proved on every render would spend the lane's allowance
// on itself. `fresh` forces a real probe.

import { resolveChannelCredential } from './channel-credentials.js';
import { readXMe } from './x-reader.js';
import { readLinkedInIdentity, linkedinExpiryNote } from './linkedin-poster.js';
import { normalizeInstanceUrl } from './mastodon-poster.js';
import { isSecureServiceUrl } from './bluesky-poster.js';
import { GRAPH_VERSION } from './facebook-poster.js';
import { readYouTubeChannel } from './youtube-poster.js';
import { readTikTokAccount } from './tiktok-poster.js';

const TTL_MS = 60 * 1000;
const TIMEOUT_MS = 8 * 1000;

// The env doors — one per platform, the tests' only seam.
const telegramRoot = () => process.env.NEUMA_TELEGRAM_API_ROOT || 'https://api.telegram.org';
const discordRoot = () => process.env.NEUMA_DISCORD_API_ROOT || 'https://discord.com';
const mastodonRoot = (configured) => process.env.NEUMA_MASTODON_API_ROOT || configured;
const blueskyRoot = (configured) => process.env.NEUMA_BLUESKY_API_ROOT || configured;
const facebookRoot = () => process.env.NEUMA_FACEBOOK_API_ROOT || 'https://graph.facebook.com';

const unconfigured = (channelName) => ({ ok: null, detail: `${channelName} is not configured` });

// Every probe: one impure call, never throws, answers the flight shape.
// { ok: true, account: { id?, name? } } | { ok: false, status?, detail } | unconfigured

const probeX = async (credentials, signal, wallet) => {
  if (!credentials) return unconfigured('X');
  const me = await readXMe({ signal, wallet });
  if (!me.ok) return { ok: false, status: me.status, detail: me.detail || 'the account lookup failed' };
  const account = me.data?.id
    ? { id: String(me.data.id), name: String(me.data.username || '') }
    : null;
  return account
    ? { ok: true, account }
    : { ok: false, detail: 'the account lookup returned no id' };
};

const probeTelegram = async (credentials, signal) => {
  if (!credentials) return unconfigured('Telegram');
  try {
    const res = await fetch(`${telegramRoot()}/bot${credentials.botToken}/getMe`, { signal });
    const body = await res.json().catch(() => ({}));
    if (res.ok && body?.ok && body.result?.id) {
      return { ok: true, account: { id: String(body.result.id), name: String(body.result.username || '') } };
    }
    return { ok: false, status: res.status, detail: String(body?.description || `Telegram answered ${res.status}`) };
  } catch (err) {
    return { ok: false, detail: `no answer (${err.message})` };
  }
};

const probeDiscord = async (credentials, signal) => {
  if (!credentials) return unconfigured('Discord');
  try {
    const res = await fetch(`${discordRoot()}/api/v10/users/@me`, {
      headers: { Authorization: `Bot ${credentials.botToken}` },
      signal,
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok && body?.id) {
      return { ok: true, account: { id: String(body.id), name: String(body.username || '') } };
    }
    return { ok: false, status: res.status, detail: String(body?.message || `Discord answered ${res.status}`) };
  } catch (err) {
    return { ok: false, detail: `no answer (${err.message})` };
  }
};

const probeMastodon = async (credentials, signal) => {
  if (!credentials) return unconfigured('Mastodon');
  const origin = mastodonRoot(normalizeInstanceUrl(credentials.instanceUrl));
  if (!origin) return { ok: false, detail: 'the configured instance URL is not a valid https origin' };
  try {
    const res = await fetch(`${origin}/api/v1/accounts/verify_credentials`, {
      headers: { Authorization: `Bearer ${credentials.accessToken}` },
      signal,
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok && body?.id) {
      return { ok: true, account: { id: String(body.id), name: String(body.acct || body.username || '') } };
    }
    return { ok: false, status: res.status, detail: String(body?.error || `Mastodon answered ${res.status}`) };
  } catch (err) {
    return { ok: false, detail: `no answer (${err.message})` };
  }
};

const probeBluesky = async (credentials, signal) => {
  if (!credentials) return unconfigured('Bluesky');
  // The env door exempts itself from the https law (the tests' loopback is
  // plain http by nature); the operator's own config never gets the pass.
  const service = blueskyRoot(credentials.service);
  if (!process.env.NEUMA_BLUESKY_API_ROOT && !isSecureServiceUrl(service)) {
    return { ok: false, detail: 'the configured PDS service URL is not a valid https origin' };
  }
  try {
    // The poster's own first leg: a session proves identifier + app password.
    const res = await fetch(`${service}/xrpc/com.atproto.server.createSession`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: credentials.identifier, password: credentials.appPassword }),
      signal,
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok && body?.did) {
      return { ok: true, account: { id: String(body.did), name: String(body.handle || '') } };
    }
    return { ok: false, status: res.status, detail: String(body?.message || body?.error || `Bluesky answered ${res.status}`) };
  } catch (err) {
    return { ok: false, detail: `no answer (${err.message})` };
  }
};

const probeFacebook = async (credentials, signal) => {
  if (!credentials) return unconfigured('Facebook');
  try {
    const url = `${facebookRoot()}/${GRAPH_VERSION}/${credentials.pageId}`
      + `?fields=id,name&access_token=${encodeURIComponent(credentials.accessToken)}`;
    const res = await fetch(url, { signal });
    const body = await res.json().catch(() => ({}));
    if (res.ok && body?.id) {
      return { ok: true, account: { id: String(body.id), name: String(body.name || '') } };
    }
    return { ok: false, status: res.status, detail: String(body?.error?.message || `Facebook answered ${res.status}`) };
  } catch (err) {
    return { ok: false, detail: `no answer (${err.message})` };
  }
};

// Keep the recorded LinkedIn expiry visible beside a successful account
// lookup; a working token can still need renewal soon.
const probeLinkedIn = async (credentials, signal) => {
  if (!credentials) return unconfigured('LinkedIn');
  const me = await readLinkedInIdentity(credentials, { signal });
  if (!me.ok) return { ok: false, status: me.status, detail: me.detail || 'the account lookup failed' };
  const note = linkedinExpiryNote(credentials.tokenExpiresAt);
  const account = { id: String(me.data.sub), name: String(me.data.name || '') };
  return note ? { ok: true, account, detail: note } : { ok: true, account };
};

// The channel the stored refresh token speaks as: its @handle where it has
// one, its title always (the desk names the channel by its title).
const probeYouTube = async (credentials, signal) => {
  if (!credentials) return unconfigured('YouTube');
  const me = await readYouTubeChannel(credentials, { signal });
  if (!me.ok) return { ok: false, status: me.status, detail: me.detail };
  return { ok: true, account: { id: me.channel.id, name: me.channel.handle || me.channel.title, title: me.channel.title } };
};

// The account the house's TikTok sign-in speaks as, by its display name; the
// probe refreshes the access token through the house's store when it is due.
const probeTikTok = async (credentials, signal, wallet) => {
  if (!credentials) return unconfigured('TikTok');
  const me = await readTikTokAccount(wallet, { signal });
  if (!me.ok) return { ok: false, status: me.status, detail: me.detail };
  return { ok: true, account: { id: me.user.id, name: me.user.displayName, title: me.user.displayName } };
};

const PROBES = Object.freeze({
  x: probeX,
  telegram: probeTelegram,
  discord: probeDiscord,
  mastodon: probeMastodon,
  bluesky: probeBluesky,
  facebook: probeFacebook,
  linkedin: probeLinkedIn,
  youtube: probeYouTube,
  tiktok: probeTikTok,
});

// The brief cache — one entry per house per channel: { at, result }.
const cache = new Map();

/**
 * Probe every channel (or a named subset). impure — credential store +
 * network + clock. Never throws: a channel that cannot even resolve its
 * credentials answers its own failure shape.
 * @param {{fresh?: boolean, channels?: Array<string>, wallet: string}} opts -
 *   wallet: the house whose connections are proven (each house its own keys)
 * @returns {Promise<Record<string, {ok: true|false|null, detail?: string,
 *   account?: {id: string, name: string}, status?: number, checkedAt: string}>>}
 */
export const runFlightTests = async ({ fresh = false, channels = null, wallet } = {}) => {
  const ids = channels || Object.keys(PROBES);
  const out = {};
  await Promise.all(ids.map(async (id) => {
    const probe = PROBES[id];
    if (!probe) return;
    const key = `${String(wallet || '').toLowerCase()}|${id}`;
    const cached = cache.get(key);
    if (!fresh && cached && Date.now() - cached.at < TTL_MS) {
      out[id] = cached.result;
      return;
    }
    const credentials = await resolveChannelCredential(wallet, id).catch(() => null);
    const result = await probe(credentials, AbortSignal.timeout(TIMEOUT_MS), wallet);
    const stamped = { ...result, checkedAt: new Date().toISOString() };
    cache.set(key, { at: Date.now(), result: stamped });
    out[id] = stamped;
  }));
  return out;
};
