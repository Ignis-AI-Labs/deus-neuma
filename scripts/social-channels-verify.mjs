// social-channels-verify.mjs — prove every configured social channel
// end-to-end before a being touches it.
//
//   node scripts/social-channels-verify.mjs                     → read-only
//     credential check for EVERY configured channel (who am I? no post)
//   node scripts/social-channels-verify.mjs --post <channel> "text"
//     → ONE real test post through that channel
//
// Resolves credentials exactly as the platform does (encrypted Settings store
// > .env), and posts through the SAME posters the post_to_* tools ride —
// uniform-architecture law: one path, proven here, trusted everywhere.
//
// Trust note: the mastodon/bluesky probes send the token/app-password to the
// configured instance/PDS URL. Those URLs are WITNESS-controlled config (the
// 0600 encrypted store or the operator's .env — never neuma-writable), and
// the posters refuse non-https targets, so the credential can only travel to
// an origin the witness personally named.

import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(REPO, '.env') });

const { CHANNEL_CATALOG } = await import(path.join(REPO, 'backend/services/social/channel-registry.js'));
const { resolveChannelCredential } = await import(path.join(REPO, 'backend/services/social/channel-credentials.js'));
const { posterFor } = await import(path.join(REPO, 'backend/services/social/poster-registry.js'));
const { buildOAuth1Header } = await import(path.join(REPO, 'backend/services/social/x-poster.js'));
const { normalizeInstanceUrl } = await import(path.join(REPO, 'backend/services/social/mastodon-poster.js'));
const { readLinkedInIdentity, linkedinExpiryNote } = await import(path.join(REPO, 'backend/services/social/linkedin-poster.js'));

// Keys are per HOUSE (backend/services/social/house-positions.js): name the
// house whose keys this proves.
const HOUSE = process.env.NEUMA_HOUSE_WALLET;
if (!/^0x[0-9a-fA-F]{40}$/.test(HOUSE || '')) {
  console.error('set NEUMA_HOUSE_WALLET=<your house wallet 0x…> — account keys are kept per house');
  process.exit(1);
}

// Per-channel read-only identity probes — each answers […] without publishing anything.
const PROBES = {
  x: async (c) => {
    const url = 'https://api.x.com/2/users/me';
    const header = buildOAuth1Header(c, {
      method: 'GET', url,
      timestamp: String(Math.floor(Date.now() / 1000)),
      nonce: crypto.randomBytes(16).toString('hex'),
    });
    const res = await fetch(url, { headers: { Authorization: header } });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body?.data?.username) throw new Error(`HTTP ${res.status}: ${body?.detail || body?.title || 'no identity'}`);
    return `@${body.data.username} (${body.data.name})`;
  },
  telegram: async (c) => {
    const me = await fetch(`https://api.telegram.org/bot${c.botToken}/getMe`).then((r) => r.json());
    if (me?.ok !== true) throw new Error(me?.description || 'getMe failed');
    const chat = await fetch(`https://api.telegram.org/bot${c.botToken}/getChat?chat_id=${encodeURIComponent(c.chatId)}`).then((r) => r.json());
    if (chat?.ok !== true) throw new Error(`bot @${me.result.username} is live but cannot see chat ${c.chatId}: ${chat?.description || 'getChat failed'}`);
    return `bot @${me.result.username} → ${chat.result.title || chat.result.username || c.chatId}`;
  },
  discord: async (c) => {
    const auth = { Authorization: `Bot ${c.botToken}` };
    const me = await fetch('https://discord.com/api/v10/users/@me', { headers: auth }).then((r) => r.json());
    if (!me?.id) throw new Error('bot token rejected');
    const chan = await fetch(`https://discord.com/api/v10/channels/${c.channelId}`, { headers: auth });
    const body = await chan.json().catch(() => ({}));
    if (!chan.ok || !body?.id) throw new Error(`bot ${me.username} is live but cannot see channel ${c.channelId}: ${body?.message || `HTTP ${chan.status}`}`);
    return `bot ${me.username} → #${body.name || c.channelId}`;
  },
  facebook: async (c) => {
    const res = await fetch(`https://graph.facebook.com/v21.0/${c.pageId}?fields=id,name`, {
      headers: { Authorization: `Bearer ${c.accessToken}` },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body?.id) throw new Error(`HTTP ${res.status}: ${body?.error?.message || 'page not readable'}`);
    return `page "${body.name}" (${body.id})`;
  },
  mastodon: async (c) => {
    const origin = normalizeInstanceUrl(c.instanceUrl);
    if (!origin) throw new Error('instance URL is not a valid https origin');
    const res = await fetch(`${origin}/api/v1/accounts/verify_credentials`, {
      headers: { Authorization: `Bearer ${c.accessToken}` },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body?.acct) throw new Error(`HTTP ${res.status}: ${body?.error || 'no identity'}`);
    return `@${body.acct} on ${origin}`;
  },
  bluesky: async (c) => {
    const res = await fetch(`${c.service}/xrpc/com.atproto.server.createSession`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: c.identifier, password: c.appPassword }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body?.did) throw new Error(`HTTP ${res.status}: ${body?.message || 'sign-in failed'}`);
    return `${body.handle} (${body.did})`;
  },
  linkedin: async (c) => {
    // This probe proves the REAL lane — the loopback door would read as a
    // verified LinkedIn that is not. Only this row refuses (the other
    // channels' probes pin their production origins literally).
    if (process.env.NEUMA_LINKEDIN_API_ROOT) {
      throw new Error('NEUMA_LINKEDIN_API_ROOT is set — this probe proves the REAL lane; unset it and re-run');
    }
    const me = await readLinkedInIdentity(c);
    if (!me.ok) throw new Error(`${me.status ? `HTTP ${me.status}: ` : ''}${me.detail}`);
    const who = `${me.data.name || 'the member'} (${me.data.sub})`;
    const note = linkedinExpiryNote(c.tokenExpiresAt);
    return note ? `${who} — WARNING: ${note}` : `${who} — token expires ${c.tokenExpiresAt}`;
  },
};

const postIdx = process.argv.indexOf('--post');

if (postIdx === -1) {
  let configured = 0;
  for (const channel of CHANNEL_CATALOG) {
    const creds = await resolveChannelCredential(HOUSE, channel.id);
    if (!creds) {
      console.log(`${channel.id.padEnd(9)} — not configured (fields: ${channel.fields.map((f) => f.env).join(', ')})`);
      continue;
    }
    configured += 1;
    try {
      console.log(`${channel.id.padEnd(9)} — VERIFIED: ${await PROBES[channel.id](creds)}`);
    } catch (err) {
      console.error(`${channel.id.padEnd(9)} — FAILED: ${err.message}`);
      process.exitCode = 1;
    }
  }
  if (configured === 0) console.log('\nno channel is configured yet — fill the .env slots or Settings > Social Channels.');
  else console.log('\nnothing was published. One real test post: node scripts/social-channels-verify.mjs --post <channel> "text"');
  process.exit(process.exitCode || 0);
}

const channelId = process.argv[postIdx + 1];
const text = process.argv[postIdx + 2];
const poster = posterFor(channelId);
if (!poster || !text) {
  console.error('usage: node scripts/social-channels-verify.mjs --post <x|telegram|discord|mastodon|bluesky|facebook|linkedin> "your text"');
  process.exit(1);
}
const creds = await resolveChannelCredential(HOUSE, channelId);
if (!creds) {
  console.error(`${channelId} is not configured — fill its fields in .env or Settings > Social Channels first.`);
  process.exit(1);
}
// The post branch rides the poster, whose LinkedIn URL follows the same env
// door the probe row refuses — a loopback must never read as a real POSTED.
if (channelId === 'linkedin' && process.env.NEUMA_LINKEDIN_API_ROOT) {
  console.error('NEUMA_LINKEDIN_API_ROOT is set — this post proves the REAL lane; unset it and re-run.');
  process.exit(1);
}
console.log(`publishing ONE test post through ${channelId}…`);
const outcome = await poster(creds, text);
if (outcome.ok) {
  console.log(`POSTED — id ${outcome.id}`);
} else {
  console.error(`post FAILED — ${outcome.status ? `HTTP ${outcome.status}: ` : ''}${outcome.detail}`);
  process.exit(1);
}
