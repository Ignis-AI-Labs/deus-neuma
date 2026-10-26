// campaign-bench.mjs — the CAMPAIGN BENCHMARK over a house's REAL records,
// read-only (campaign plan §6.2, slice 13).
//
//   node scripts/campaign-bench.mjs --wallet 0x…                 STRUCTURE, HANDS, OUTCOME
//   … --at 2026-10-24T09:00:00Z     the moment to score at (repeatable: same records + same moment = same numbers)
//   … --probes                      run the house social check WITH its live identity reads
//   … --json                        the whole report as JSON
//
// Three scores per campaign, per company and for the house
// (backend/services/marketing/bench/campaign-bench.js). Nothing is migrated,
// moved or written: the account store is peeked and the campaigns read as they
// stand (scripts/lib/house-peek.mjs); the queue is read and filtered to the
// house. An item the records cannot answer reads NOT MEASURED with the reason;
// a number no record reports is "—". Without --probes the house-check item is
// NOT MEASURED. --probes behaves as scripts/social-check-live.mjs --probes does
// (refused on a v1 key store; a due TikTok token is refreshed by the platform's
// own path). Key NAMES only, never a value.

import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { arg, flag } from './lib/cli-args.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(REPO, '.env') });
// The workspace root the desk boots with (server.js applies the saved root the same way):
// without it a lane's owner is read from the .env root and a house member reads as foreign.
await (await import('../backend/services/workspace-settings.js')).applyWorkspaceSettings();

const wallet = arg('wallet') || process.env.NEUMA_HOUSE_WALLET;
if (!/^0x[0-9a-fA-F]{40}$/.test(wallet || '')) {
  console.error('usage: node scripts/campaign-bench.mjs --wallet 0x<your house wallet> [--at ISO] [--probes] [--json]');
  process.exit(1);
}
const at = arg('at');
const now = at ? Date.parse(at) : Date.now();
if (!Number.isFinite(now)) {
  console.error(`--at ${at} is not a moment (ISO-8601, e.g. 2026-10-24T09:00:00Z)`);
  process.exit(1);
}

const { PEEK_READS, storeShape } = await import('./lib/house-peek.mjs');
const { runHouseCheck } = await import('../backend/services/social/house-check/house-check-facts.js');
const { listAccounts } = await import('../backend/services/social/account-store.js');
const { listCompanies } = await import('../backend/services/marketing/companies.js');
const { postQueue } = await import('../backend/services/social/post-queue.js');
const { ofHouse } = await import('../backend/services/social/queue-house.js');
const { readServed } = await import('../backend/services/house-served.js');
const { benchHouse, formatBench } = await import('../backend/services/marketing/bench/campaign-bench.js');

const probes = flag('probes');
if (probes && await storeShape(wallet) === 'v1') {
  console.error('the house\'s keys are still in the old shape (v1): they move to accounts at the next desk start. Run without --probes now, or start the desk first.');
  process.exit(1);
}
const house = wallet.toLowerCase();
const [store, campaigns, companies, queue, served] = await Promise.all([
  PEEK_READS.store(house), PEEK_READS.campaigns(house), listCompanies(house), postQueue.load(), readServed(),
]);
const report = benchHouse({
  house,
  campaigns,
  entries: ofHouse(served, queue, house),
  accounts: await listAccounts(house, store),
  companies,
  houseCheck: await runHouseCheck(house, { probes, fresh: probes, now, reads: PEEK_READS }),
  results: null,
  now,
});
console.log(flag('json') ? JSON.stringify(report, null, 2) : formatBench(report));
process.exit(0);
