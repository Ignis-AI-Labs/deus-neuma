// tiktok-post-verify.mjs — prove the TikTok lane LIVE with the operator's own
// connected TikTok app (sandbox or live), before a being's draft ever rides it.
//
//   NEUMA_HOUSE_WALLET=0x… node scripts/tiktok-post-verify.mjs
//       → names the connected account, prints what TikTok allows it right now
//         (creator info), makes a 5-second test clip, posts it as a PRIVATE
//         (only me) Direct Post through the platform's own poster with
//         is_aigc=true, waits for TikTok's publish status and prints it.
//   … --drafts
//       → sends the clip to the account's TikTok inbox instead (the Upload
//         route), to be finished in the TikTok app.
//
// Resolves credentials through the SAME door the platform rides (the house's
// sealed store, as CONNECT in Settings → API → Channel keys left it) and
// posts through the SAME poster the scheduler calls. TikTok returns nothing
// that reads the AI label back, so the script proves the label left with the
// post and tells you where to see it. Each run spends one of the account's
// daily posts (and, while the app is unaudited, one of its 5 daily users).

import { execFileSync } from 'child_process';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(REPO, '.env') });

// This script proves the REAL lane: a loopback door left in .env would make it
// verify a stand-in instead of TikTok. Refuse the door.
if (process.env.NEUMA_TIKTOK_API_ROOT) {
  console.error('NEUMA_TIKTOK_API_ROOT is set — this script proves the REAL lane; unset it and re-run.');
  process.exit(1);
}
const HOUSE = process.env.NEUMA_HOUSE_WALLET;
if (!/^0x[0-9a-fA-F]{40}$/.test(HOUSE || '')) {
  console.error('set NEUMA_HOUSE_WALLET=<your house wallet 0x…> — channel keys are kept per house');
  process.exit(1);
}
const toDrafts = process.argv.includes('--drafts');

const load = (rel) => import(path.join(REPO, rel));
const { resolveChannelCredential } = await load('backend/services/social/channel-credentials.js');
const { postToTikTok, readTikTokAccount } = await load('backend/services/social/tiktok-poster.js');
const { parseTikTokDraft, buildPostInfo } = await load('backend/services/social/tiktok-metadata.js');
const { PRIVACY_LABELS, EMPTY_CHOICE, creatorView, consentRecord } = await load('frontend/utils/tiktok-consent.js');
const { tiktokAccessFor } = await load('backend/services/social/tiktok-token.js');
const { queryCreatorInfo } = await load('backend/services/social/tiktok-api.js');
const { stampDisclosure } = await load('backend/services/image-forge/ai-disclosure.js');

let credentials;
try {
  credentials = await resolveChannelCredential(HOUSE, 'tiktok');
} catch (err) {
  console.error(`the sealed credential store refused to answer — ${err.message}`);
  process.exit(1);
}
if (!credentials) {
  console.error('TikTok is not connected for this house. In the desk: Settings → API → Channel keys → TikTok,');
  console.error('save your TikTok app\'s client key + secret, then press CONNECT and finish the TikTok sign-in.');
  process.exit(1);
}

const me = await readTikTokAccount(HOUSE);
if (!me.ok) {
  console.error(`connection check FAILED — ${me.detail}`);
  process.exit(1);
}
console.log(`connection VERIFIED — this house posts as "${me.user.displayName}" (open_id ${me.user.id})`);

const token = await tiktokAccessFor(HOUSE);
const creator = token.ok ? await queryCreatorInfo(token.accessToken) : token;
if (!creator.ok) {
  console.error(`creator info FAILED — ${creator.detail}`);
  process.exit(1);
}
const c = creator.data;
console.log(`creator info — @${c.creator_username} ("${c.creator_nickname}"); privacy offered: ${(c.privacy_level_options || []).map((o) => PRIVACY_LABELS[o] || o).join(', ')}; longest video ${c.max_video_post_duration_sec}s; comments ${c.comment_disabled ? 'off' : 'allowed'}, duet ${c.duet_disabled ? 'off' : 'allowed'}, stitch ${c.stitch_disabled ? 'off' : 'allowed'}`);

const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
const text = toDrafts
  ? `Deus Neuma drafts check ${stamp}\nsend: drafts`
  : `Deus Neuma posting check ${stamp}. A five-second test pattern; private, safe to delete.`;
// Running this script IS the operator's express consent to exactly this
// post: only me, no interactions, no promotion (what the card records when
// a person approves those choices). Never public by accident.
const consent = toDrafts ? null : consentRecord({ ...EMPTY_CHOICE, privacyLevel: 'SELF_ONLY' }, creatorView(c), new Date());
const parsed = parseTikTokDraft(text);
if (!parsed.ok || (consent && consent.privacyLevel !== 'SELF_ONLY')) {
  console.error('refusing: the test post is not PRIVATE');
  process.exit(1);
}
if (consent && buildPostInfo(parsed.meta.caption, consent).is_aigc !== true) {
  console.error('DISCLOSURE CHECK FAILED — the post this script would send does not carry is_aigc=true');
  process.exit(1);
}

// A 5-second vertical H.264 test pattern with a tone, AI-disclosed in its own
// metadata like every forge output. Written to a private temp dir, removed at the end.
const work = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-tiktok-verify-'));
const clip = path.join(work, 'neuma-tiktok-verify.mp4');
const encode = (codec) => execFileSync('ffmpeg', ['-v', 'error', '-y',
  '-f', 'lavfi', '-i', 'testsrc2=size=720x1280:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
  '-t', '5', '-c:v', codec, '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', '-movflags', '+faststart', clip], { timeout: 60_000 });
try {
  // TikTok takes H.264/H.265/VP8/VP9 only: no MPEG-4 Part 2 fallback here.
  try { encode('libopenh264'); } catch { encode('h264_nvenc'); }
} catch (err) {
  console.error(`could not make an H.264 test clip with ffmpeg (libopenh264 or h264_nvenc) — ${err.message}`);
  await fs.rm(work, { recursive: true, force: true });
  process.exit(1);
}
stampDisclosure(clip, 'video/mp4');

console.log(toDrafts ? 'sending ONE test video to your TikTok drafts…' : 'posting ONE private (only me) test video, labelled AI-generated…');
const outcome = await postToTikTok(credentials, text, {
  media: [{ path: clip }],
  house: HOUSE,
  tiktokConsent: consent,
  onTicket: async (publishId) => { console.log(`TikTok opened publish ${publishId}; uploading…`); },
});
await fs.rm(work, { recursive: true, force: true });
if (outcome.pending) {
  console.log(`PENDING — ${outcome.detail}. Look in the TikTok app in a few minutes.`);
  process.exit(0);
}
if (!outcome.ok) {
  console.error(`post FAILED — ${outcome.status ? `HTTP ${outcome.status}: ` : ''}${outcome.detail}`);
  process.exit(1);
}
console.log(`${toDrafts ? 'SENT TO DRAFTS' : 'PUBLISHED (private)'} — id ${outcome.id}${outcome.url ? ` · ${outcome.url}` : ''}`);
console.log(outcome.text);
if (toDrafts) {
  console.log('AI label: the drafts route carries none. Turn on "AI-generated content" in the TikTok app before you post the draft.');
} else {
  console.log('AI label: sent is_aigc=true. TikTok returns no read-back; open the video in the TikTok app and check it shows');
  console.log('"Creator labeled as AI-generated". Delete the test video from the TikTok app when you are done.');
}
