// tiktok-profile-verify.mjs — prove the TIKTOK window's account view LIVE,
// read-only, with the operator's own connected TikTok app (sandbox or live).
//
//   NEUMA_HOUSE_WALLET=0x… node scripts/tiktok-profile-verify.mjs
//       → names the permissions the connection recorded, asks TikTok for the
//         user fields those permissions open and for the first page of videos
//         (printing exactly which fields TikTok answered), then reads the
//         account through the platform's own view (the same call the window
//         makes) and fetches the avatar and one cover through the platform's
//         own picture relay, printing each picture's host, type and size.
//
// Nothing is posted, edited or deleted on TikTok. The one write it can make
// is the platform's own: if the access token is due, it is refreshed and the
// new pair sealed back into the house's store, exactly as the desk would.

import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(REPO, '.env') });

// This script proves the REAL lane: a loopback door left in .env would make it
// verify a stand-in instead of TikTok. Refuse both doors.
for (const door of ['NEUMA_TIKTOK_API_ROOT', 'NEUMA_TIKTOK_CDN_ROOT']) {
  if (process.env[door]) {
    console.error(`${door} is set — this script proves the REAL lane; unset it and re-run.`);
    process.exit(1);
  }
}
const HOUSE = process.env.NEUMA_HOUSE_WALLET;
if (!/^0x[0-9a-fA-F]{40}$/.test(HOUSE || '')) {
  console.error('set NEUMA_HOUSE_WALLET=<your house wallet 0x…> — channel keys are kept per house');
  process.exit(1);
}

const load = (rel) => import(path.join(REPO, rel));
const { resolveChannelCredential } = await load('backend/services/social/channel-credentials.js');
const { tiktokAccessFor } = await load('backend/services/social/tiktok-token.js');
const { readTikTokUserFields, listTikTokVideos } = await load('backend/services/social/tiktok-api.js');
const { readTikTokProfile } = await load('backend/services/social/tiktok-profile.js');
const { missingProfileScopes, userFieldsFor, VIDEO_FIELDS, VIDEO_PAGE } = await load('backend/services/social/tiktok-profile-view.js');
const { relayTikTokImage, tiktokImageUrlAllowed } = await load('backend/services/social/tiktok-image-relay.js');

let credentials;
try {
  credentials = await resolveChannelCredential(HOUSE, 'tiktok');
} catch (err) {
  console.error(`the sealed credential store refused to answer — ${err.message}`);
  process.exit(1);
}
if (!credentials) {
  console.error('TikTok is not connected for this house. In the desk: Settings → API → Channel keys → TikTok → CONNECT.');
  process.exit(1);
}

const token = await tiktokAccessFor(HOUSE);
if (!token.ok) {
  console.error(`sign-in FAILED — ${token.detail}`);
  process.exit(1);
}
const granted = token.credentials.grantedScope;
const missing = missingProfileScopes(granted);
console.log(`permissions recorded: ${granted}`);
console.log(missing.length ? `account view lacks: ${missing.join(', ')} (RECONNECT to grant them)` : 'account view has every permission it reads');

// 1. TikTok's own answers, field by field.
const asked = userFieldsFor(missing);
const user = await readTikTokUserFields(token.accessToken, asked);
if (!user.ok) {
  console.error(`user info FAILED — ${user.status ? `HTTP ${user.status} ` : ''}${user.code || ''} ${user.detail}`);
  process.exit(1);
}
const answered = Object.keys(user.data?.user || {});
console.log(`user info — asked ${asked.length} fields, TikTok answered: ${answered.join(', ')}`);
const silent = asked.filter((f) => !answered.includes(f));
if (silent.length) console.log(`  (asked but not answered: ${silent.join(', ')})`);

if (!missing.includes('video.list')) {
  const list = await listTikTokVideos(token.accessToken, { fields: VIDEO_FIELDS, maxCount: VIDEO_PAGE });
  if (!list.ok) {
    console.error(`video list FAILED — ${list.status ? `HTTP ${list.status} ` : ''}${list.code || ''} ${list.detail}`);
    process.exit(1);
  }
  const first = list.data?.videos?.[0];
  console.log(`video list — ${list.data?.videos?.length ?? 0} videos on the first page, has_more=${Boolean(list.data?.has_more)}`);
  if (first) console.log(`  first video's fields: ${Object.keys(first).join(', ')}`);
}

// 2. The platform's own view — exactly what the TIKTOK window draws.
const view = await readTikTokProfile(HOUSE);
if (!view.ok) {
  console.error(`account view FAILED — ${view.detail}`);
  process.exit(1);
}
const a = view.account;
const c = a.counts;
console.log(`account view — "${a.displayName}" @${a.username ?? '—'}${a.verified ? ' (verified)' : ''}`);
console.log(`  bio: ${a.bio === null ? '— (not readable)' : JSON.stringify(a.bio)}`);
console.log(`  EDIT ON TIKTOK opens: ${a.profileUrl ?? '— (no profile link)'}`);
console.log(`  followers ${c.followers ?? '—'} · following ${c.following ?? '—'} · likes ${c.likes ?? '—'} · videos ${c.videos ?? '—'}`);
if (view.reconnect) console.log(`  the window says: ${view.reconnect}`);
if (view.videosError) console.log(`  videos: ${view.videosError}`);
for (const v of (view.videos || []).slice(0, 5)) {
  console.log(`  · ${v.postedAt?.slice(0, 10) ?? '—'} ${JSON.stringify(v.caption.slice(0, 60))} views ${v.counts.views ?? '—'} likes ${v.counts.likes ?? '—'} comments ${v.counts.comments ?? '—'} shares ${v.counts.shares ?? '—'} · ${v.shareUrl ?? '—'}`);
}

// 3. The pictures, through the platform's relay.
const pictures = [['avatar', a.avatarUrl], ['first cover', view.videos?.[0]?.coverUrl]].filter(([, url]) => url);
let refused = 0;
for (const [name, url] of pictures) {
  const host = new URL(url).hostname;
  if (!tiktokImageUrlAllowed(url)) {
    refused += 1;
    console.error(`${name}: host ${host} is NOT on the relay's allowlist — the window will draw it as missing`);
    continue;
  }
  const out = await relayTikTokImage(url);
  if (out.ok) console.log(`${name}: ${host} → ${out.type}, ${out.bytes.length} bytes through the relay`);
  else { refused += 1; console.error(`${name}: ${host} → relay refused (${out.detail})`); }
}
console.log(refused ? 'account view READ, with picture refusals above' : 'account view VERIFIED — read-only, nothing changed on TikTok');
process.exit(refused ? 1 : 0);
