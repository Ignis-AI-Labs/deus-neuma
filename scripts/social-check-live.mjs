// social-check-live.mjs — the HOUSE SOCIAL CHECK on the owner's REAL house,
// read-only (campaign plan §6.1, slice 11).
//
//   node scripts/social-check-live.mjs --wallet 0x…            stores only
//   node scripts/social-check-live.mjs --wallet 0x… --probes   + live identity reads
//   … --json                                                   the whole report as JSON
//
// It prints the same report the desk's SOCIAL CHECK window draws and the CMO's
// social_check read gives. Nothing is migrated, moved, posted or changed: the
// account store is peeked, the campaigns read as they stand (scripts/lib/
// house-peek.mjs). Without --probes the identity checks read NOT PROVEN, by
// design. --probes asks each keyed account's platform who it is (one
// identity GET each); a TikTok probe whose access token is due refreshes it
// and seals the new pair into the house's store — the platform's own
// maintenance, exactly as the desk would. --probes is refused while the
// house's keys are still in the old (v1) shape: the probe's own read would
// migrate them, and this script migrates nothing. Key NAMES only, never a value.

import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { arg, flag } from './lib/cli-args.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(REPO, '.env') });
// The workspace root the desk boots with (server.js applies the saved root the same way):
// without it a lane's owner is read from the .env root and a house member reads as foreign.
await (await import('../backend/services/workspace-settings.js')).applyWorkspaceSettings();

// A loopback door left in the env would check a stand-in, not the platforms.
const doors = Object.keys(process.env).filter((k) => /^NEUMA_[A-Z]+_API_ROOT$/.test(k) && process.env[k]);
if (doors.length) {
  console.error(`${doors.join(', ')} set — this script checks the REAL accounts; unset and re-run.`);
  process.exit(1);
}
const wallet = arg('wallet') || process.env.NEUMA_HOUSE_WALLET;
if (!/^0x[0-9a-fA-F]{40}$/.test(wallet || '')) {
  console.error('usage: node scripts/social-check-live.mjs --wallet 0x<your house wallet> [--probes] [--json]');
  process.exit(1);
}

const { PEEK_READS, storeShape } = await import('./lib/house-peek.mjs');
const { runHouseCheck } = await import('../backend/services/social/house-check/house-check-facts.js');
const { formatHouseCheckForBeing } = await import('../backend/services/social/house-check/house-check-words.js');

const probes = flag('probes');
const shape = await storeShape(wallet);
if (probes && shape === 'v1') {
  console.error('the house\'s keys are still in the old shape (v1): they move to accounts at the next desk start. Run without --probes now, or start the desk first.');
  process.exit(1);
}
const report = await runHouseCheck(wallet, { probes, fresh: probes, reads: PEEK_READS });
if (flag('json')) {
  console.log(JSON.stringify({ storeShape: shape, ...report }, null, 2));
} else {
  if (shape === 'v1') console.log('(the house\'s keys still stand in the old v1 shape — read as accounts in memory, every one UNSORTED until the desk moves them)\n');
  console.log(formatHouseCheckForBeing(report));
}
process.exit(0);
