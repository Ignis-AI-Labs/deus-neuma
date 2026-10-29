#!/usr/bin/env node
/* global console, fetch */
// site-counter-verify — prove a house's tracked links against the REAL site
// counter (https://deusneuma.ai), READ-ONLY:
//
//   NEUMA_HOUSE_WALLET=0x… node scripts/site-counter-verify.mjs
//
// 1. the house's site token answers GET /go-counts (and the counts it reads);
// 2. every code in the house's map resolves: HEAD /go/<code> redirects to its
//    destination (HEAD never counts — the counter's own rule).
// Nothing is published and nothing is counted. The token is read from the
// house's sealed store and never printed.
import process from 'process';
import { loadLinks } from '../backend/services/marketing/link-store.js';
import { siteCounterStatus, readGoCounts } from '../backend/services/marketing/site-counter.js';

if (process.env.NEUMA_SITE_COUNTER_ROOT) {
  console.error('NEUMA_SITE_COUNTER_ROOT is set — this script proves the REAL counter; unset it and re-run.');
  process.exit(1);
}
const HOUSE = process.env.NEUMA_HOUSE_WALLET;
if (!/^0x[0-9a-fA-F]{40}$/.test(HOUSE || '')) {
  console.error('set NEUMA_HOUSE_WALLET=<your house wallet 0x…> — the site token is kept per house');
  process.exit(1);
}
const site = await siteCounterStatus(HOUSE);
console.log(`counter: ${site.root} · site token ${site.configured ? 'saved' : 'NOT saved (MARKETING → SITE COUNTER)'}`);
const links = await loadLinks(HOUSE);
console.log(`the house's map: ${links.length} code(s)`);
if (!site.configured || !links.length) process.exit(site.configured ? 0 : 1);

const counts = await readGoCounts(HOUSE, links.map((l) => l.code));
if (!counts.ok) { console.error(`GET /go-counts refused: ${counts.detail}`); process.exit(1); }
const total = (code, kind) => counts.counts.filter((c) => c.code === code && c.kind === kind).reduce((n, c) => n + c.count, 0);
let failed = 0;
for (const l of links) {
  const res = await fetch(`${site.root}/go/${l.code}`, { method: 'HEAD', redirect: 'manual' }).catch((err) => ({ status: 0, err }));
  const to = res.headers?.get?.('location') || '';
  const ok = res.status === 302 && to.startsWith(l.destination.split('?')[0]);
  if (!ok) failed += 1;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${l.code} → ${l.destination} · published ${l.published?.state || 'no'} · clicks ${total(l.code, 'click')} · downloads ${total(l.code, 'download')}${ok ? '' : ` · HEAD answered ${res.status} ${to}`}`);
}
process.exit(failed ? 1 : 0);
