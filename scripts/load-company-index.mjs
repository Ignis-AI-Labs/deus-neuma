#!/usr/bin/env node
// Load the house's company index (backend/services/sales/company-index.js) on this machine.
//
//   node scripts/load-company-index.mjs <company file>           the free company dataset (CSV, or .psv/.txt pipe-delimited)
//   node scripts/load-company-index.mjs --traffic <ranking file> a "rank,domain" list of the most visited sites (the Tranco list)
//   node scripts/load-company-index.mjs --status                 what the index holds now
//
// The company file is People Data Labs' free company dataset (CC BY 4.0), downloaded by the operator from
// peopledatalabs.com/data-lab/dataset/company-dataset. The traffic list is tranco-list.eu's top-1m.csv.
// Loading runs here, not in the backend, because a file of 22 million rows takes minutes.
import process from 'node:process';
import { loadCompanies, loadTraffic, indexStats, indexPath } from '../backend/services/sales/company-index.js';

const [first, second] = process.argv.slice(2);
const say = (o) => process.stdout.write(`\r${Object.entries(o).map(([k, v]) => `${k} ${Number(v).toLocaleString('en-US')}`).join(' · ')}   `);
const status = () => console.log(`\n${indexPath()}\n${JSON.stringify(indexStats(), null, 2)}`);

if (!first || first === '--help') {
  console.log('usage: node scripts/load-company-index.mjs <company file> | --traffic <ranking file> | --status');
  process.exit(first ? 0 : 1);
}
try {
  if (first === '--status') status();
  else if (first === '--traffic') { console.log(JSON.stringify(await loadTraffic(second, { onProgress: say }))); status(); }
  else { console.log(JSON.stringify(await loadCompanies(first, { onProgress: say }))); status(); }
} catch (err) {
  console.error(`\ncould not load: ${err.message}`);
  process.exit(1);
}
