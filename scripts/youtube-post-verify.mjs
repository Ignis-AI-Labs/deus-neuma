// youtube-post-verify.mjs — prove the YouTube lane LIVE with the operator's
// own connection, before a being's draft ever rides it.
//
//   NEUMA_HOUSE_WALLET=0x… node scripts/youtube-post-verify.mjs
//       → names the connected channel, makes a 3-second test clip, uploads it
//         as PRIVATE through the platform's own poster, prints its URL, and
//         reads back that YouTube holds status.containsSyntheticMedia = true.
//   … --delete
//       → then deletes that test video. Deleting needs the youtube.force-ssl
//         scope, which the channel's own connection never holds, so the
//         script asks ONE extra Google consent for it in your browser, uses
//         that token once, revokes it, and keeps nothing.
//
// Resolves credentials through the SAME door the platform rides
// (resolveChannelCredential(house, 'youtube') — the house's sealed store, as
// CONNECT in Settings → API → Channel keys left it) and publishes through the
// SAME poster the scheduler calls: one path, proven here, trusted everywhere.
// Every run that passes publishes one private video on your channel and
// spends about 100 quota units of your project's daily 10,000.

import { execFileSync, spawn } from 'child_process';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(REPO, '.env') });

// This script proves the REAL lane: a loopback door left in .env would make it
// verify a stand-in instead of Google. Refuse the doors.
for (const door of ['NEUMA_YOUTUBE_API_ROOT', 'NEUMA_GOOGLE_TOKEN_URL']) {
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
const wantsDelete = process.argv.includes('--delete');

const load = (rel) => import(path.join(REPO, rel));
const { resolveChannelCredential } = await load('backend/services/social/channel-credentials.js');
const { postToYouTube, readYouTubeChannel } = await load('backend/services/social/youtube-poster.js');
const { parseYouTubeDraft } = await load('backend/services/social/youtube-metadata.js');
const { refreshAccessToken } = await load('backend/services/social/youtube-oauth.js');
const { readVideoStatus, deleteVideo } = await load('backend/services/social/youtube-api.js');
const { openLoopbackConsent } = await load('backend/services/social/youtube-loopback.js');
const { stampDisclosure } = await load('backend/services/image-forge/ai-disclosure.js');

let credentials;
try {
  credentials = await resolveChannelCredential(HOUSE, 'youtube');
} catch (err) {
  console.error(`the sealed credential store refused to answer — ${err.message}`);
  process.exit(1);
}
if (!credentials) {
  console.error('YouTube is not connected for this house. In the desk: Settings → API → Channel keys → YouTube,');
  console.error('save your Desktop OAuth client id + secret, then press CONNECT and finish the Google sign-in.');
  process.exit(1);
}

const me = await readYouTubeChannel(credentials);
if (!me.ok) {
  console.error(`connection check FAILED — ${me.detail}`);
  process.exit(1);
}
console.log(`connection VERIFIED — this house uploads to "${me.channel.title}"${me.channel.handle ? ` (@${me.channel.handle})` : ''}, channel ${me.channel.id}`);

const stamp = new Date().toISOString();
const text = [
  `Deus Neuma upload check ${stamp.slice(0, 16).replace('T', ' ')}`,
  'A three-second test pattern from the platform\'s live verify script. Private; safe to delete.',
  'privacy: private',
].join('\n');
// Never public by accident: the parsed draft must say private before anything leaves.
const parsed = parseYouTubeDraft(text);
if (!parsed.ok || parsed.meta.privacyStatus !== 'private') {
  console.error('refusing: the test draft did not parse as PRIVATE');
  process.exit(1);
}

// A 3-second vertical test pattern with a tone, AI-disclosed in its own metadata
// like every forge output. Written to a private temp dir, removed at the end.
const work = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-youtube-verify-'));
const clip = path.join(work, 'neuma-youtube-verify.mp4');
const encode = (codec) => execFileSync('ffmpeg', ['-v', 'error', '-y',
  '-f', 'lavfi', '-i', 'testsrc2=size=720x1280:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
  '-t', '3', '-c:v', codec, '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', clip], { timeout: 60_000 });
try {
  try { encode('libopenh264'); } catch { encode('mpeg4'); }
} catch (err) {
  console.error(`could not make the test clip with ffmpeg — ${err.message}`);
  await fs.rm(work, { recursive: true, force: true });
  process.exit(1);
}
stampDisclosure(clip, 'video/mp4');

console.log('uploading ONE private test video…');
const outcome = await postToYouTube(credentials, text, { media: [{ path: clip }] });
await fs.rm(work, { recursive: true, force: true });
if (!outcome.ok) {
  console.error(`upload FAILED — ${outcome.status ? `HTTP ${outcome.status}: ` : ''}${outcome.detail}`);
  process.exit(1);
}
console.log(`UPLOADED (private) — ${outcome.url}`);

const token = await refreshAccessToken(credentials);
const status = token.ok ? await readVideoStatus(token.accessToken, outcome.id) : token;
if (!status.ok) {
  console.error(`could not read the video back — ${status.detail}`);
  process.exit(1);
}
console.log(`privacyStatus=${status.status.privacyStatus} containsSyntheticMedia=${status.status.containsSyntheticMedia} uploadStatus=${status.status.uploadStatus}`);
if (status.status.containsSyntheticMedia !== true || status.status.privacyStatus !== 'private') {
  console.error('DISCLOSURE CHECK FAILED — YouTube does not hold containsSyntheticMedia=true on a private video');
  process.exit(1);
}
console.log('disclosure VERIFIED — YouTube holds containsSyntheticMedia=true');

if (!wantsDelete) {
  console.log(`no --delete given — the private test video stays. Delete it in YouTube Studio, or re-run with --delete.`);
  process.exit(0);
}

// impure — best effort to open the consent in the system browser.
const openBrowser = (url) => {
  try { spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref(); } catch { /* the URL is printed */ }
};
const consent = await openLoopbackConsent({
  clientId: credentials.clientId,
  clientSecret: credentials.clientSecret,
  scopes: ['https://www.googleapis.com/auth/youtube.force-ssl'],
});
console.log('to delete, allow ONE-OFF manage access (youtube.force-ssl) in your browser — nothing is stored:');
console.log(`  ${consent.authUrl}`);
openBrowser(consent.authUrl);
const granted = await consent.done;
if (!granted.ok) {
  console.error(`delete NOT done — ${granted.detail}. Delete ${outcome.url} in YouTube Studio.`);
  process.exit(1);
}
const deleted = await deleteVideo(granted.tokens.access_token, outcome.id);
await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(granted.tokens.refresh_token || granted.tokens.access_token)}`, { method: 'POST' })
  .catch(() => null);
if (!deleted.ok) {
  console.error(`delete FAILED — ${deleted.detail}. Delete ${outcome.url} in YouTube Studio.`);
  process.exit(1);
}
console.log(`DELETED — ${outcome.id} is gone, and the one-off delete access was revoked.`);
