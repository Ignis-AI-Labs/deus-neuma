#!/usr/bin/env node
/* global console */
// stats-verify — prove the stats reads against the REAL platforms on the
// house's own accounts, READ-ONLY:
//
//   NEUMA_HOUSE_WALLET=0x… node scripts/stats-verify.mjs [--account x-1]
//
// For each account with sent posts in the house's queue, the sweep's own
// reader (backend/services/social/stats/stats-readers.js) reads up to five of
// its newest posts, with that account's own credential, and prints what came
// back — or why the platform would not say (an X plan, a YouTube or TikTok
// permission), and any "slow down". Nothing is written: not the results
// store, not the queue, not the platforms. No key is ever printed.
import process from 'process';
import { houseEntries } from '../backend/services/social/queue-house.js';
import { entryAccountId, channelOfAccountId } from '../backend/services/social/account-shape.js';
import { statsReaderFor } from '../backend/services/social/stats/stats-readers.js';
import { CAPABILITY } from '../backend/services/social/stats/stats-metrics.js';

for (const door of ['NEUMA_X_API_ROOT', 'NEUMA_YOUTUBE_API_ROOT', 'NEUMA_GOOGLE_TOKEN_URL', 'NEUMA_TIKTOK_API_ROOT', 'NEUMA_MASTODON_API_ROOT', 'NEUMA_BLUESKY_API_ROOT', 'NEUMA_FACEBOOK_API_ROOT']) {
  if (process.env[door]) { console.error(`${door} is set — this script proves the REAL platforms; unset it and re-run.`); process.exit(1); }
}
const HOUSE = process.env.NEUMA_HOUSE_WALLET;
if (!/^0x[0-9a-fA-F]{40}$/.test(HOUSE || '')) { console.error('set NEUMA_HOUSE_WALLET=<your house wallet 0x…>'); process.exit(1); }
const only = process.argv.includes('--account') ? process.argv[process.argv.indexOf('--account') + 1] : null;

const sent = (await houseEntries(HOUSE)).filter((e) => e.status === 'sent' && e.postId && (!only || entryAccountId(e) === only));
const byAccount = new Map();
for (const e of sent.sort((x, y) => String(y.sentAt).localeCompare(String(x.sentAt)))) {
  const id = entryAccountId(e);
  byAccount.set(id, [...(byAccount.get(id) || []), e].slice(0, 5));
}
if (!byAccount.size) { console.log('no sent posts with a platform id in this house\'s queue'); process.exit(0); }
let failed = 0;
for (const [accountId, posts] of byAccount) {
  const channelId = channelOfAccountId(accountId);
  const reader = statsReaderFor(channelId);
  console.log(`\n${accountId} (${posts.length} post(s)) — ${CAPABILITY[channelId]?.why || ''}`);
  if (!reader) { console.log('  no stats read for this platform: shown as —'); continue; }
  const res = await reader(HOUSE, accountId, posts);
  if (!res.ok) {
    if (res.kind === 'error') failed += 1;
    console.log(`  ${res.kind.toUpperCase()}: ${res.detail}${res.ms ? ` (asked to wait ${Math.round(res.ms / 60000)} min, ${res.scope})` : ''}`);
    continue;
  }
  for (const r of res.results) console.log(`  ${r.postId}: ${JSON.stringify(r.metrics)}`);
  const missing = posts.filter((p) => !res.results.some((r) => r.entryId === p.id));
  for (const p of missing) console.log(`  ${p.postId}: not returned (deleted, private, or not this account's)`);
  if (res.spent) console.log(`  YouTube quota spent: ${res.spent} unit(s)`);
}
process.exit(failed ? 1 : 0);
