#!/usr/bin/env node
/* global console */
// platform-read-verify — prove the read_<platform> tools against the REAL
// platforms on the house's own accounts, READ-ONLY:
//
//   NEUMA_HOUSE_WALLET=0x… node scripts/platform-read-verify.mjs [--account youtube-1]
//
// For each connected YouTube, Facebook, Bluesky and Mastodon account of the
// house, the tool's own reader (backend/services/social/account-reads/) reads
// the account and its newest posts with that account's own credential, and
// prints exactly what an agent would receive — or why the platform would not
// say. Nothing is written or posted. No key is ever printed. A YouTube read
// spends 3 units of the project's daily quota.
import process from 'process';
import { listAccounts } from '../backend/services/social/account-store.js';
import { readYouTubeAccount } from '../backend/services/social/account-reads/youtube-read.js';
import { readFacebookAccount } from '../backend/services/social/account-reads/facebook-read.js';
import { readBlueskyAccount } from '../backend/services/social/account-reads/bluesky-read.js';
import { readMastodonAccount } from '../backend/services/social/account-reads/mastodon-read.js';
import { renderAccountRead } from '../backend/services/social/account-reads/account-read-render.js';

const READERS = { youtube: readYouTubeAccount, facebook: readFacebookAccount, bluesky: readBlueskyAccount, mastodon: readMastodonAccount };

for (const door of ['NEUMA_YOUTUBE_API_ROOT', 'NEUMA_GOOGLE_TOKEN_URL', 'NEUMA_FACEBOOK_API_ROOT', 'NEUMA_MASTODON_API_ROOT', 'NEUMA_BLUESKY_API_ROOT']) {
  if (process.env[door]) { console.error(`${door} is set — this script proves the REAL platforms; unset it and re-run.`); process.exit(1); }
}
const HOUSE = process.env.NEUMA_HOUSE_WALLET;
if (!/^0x[0-9a-fA-F]{40}$/.test(HOUSE || '')) { console.error('set NEUMA_HOUSE_WALLET=<your house wallet 0x…>'); process.exit(1); }
const only = process.argv.includes('--account') ? process.argv[process.argv.indexOf('--account') + 1] : null;

const accounts = (await listAccounts(HOUSE)).filter((a) => READERS[a.channelId] && a.configured && (!only || a.id === only));
if (!accounts.length) { console.log(only ? `${only} is not a connected YouTube, Facebook, Bluesky or Mastodon account of this house` : 'no connected YouTube, Facebook, Bluesky or Mastodon account in this house'); process.exit(0); }
let failed = 0;
for (const a of accounts) {
  console.log(`\n=== ${a.id} (${a.channelName}) ===`);
  const read = await READERS[a.channelId](HOUSE, { accountId: a.id });
  if (!read.ok) { failed += 1; console.log(`FAILED: ${read.detail}`); continue; }
  console.log(renderAccountRead(a.channelName, read).text);
}
console.log(`\n${accounts.length - failed} of ${accounts.length} account read(s) landed.`);
process.exit(failed ? 1 : 0);
