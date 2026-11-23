// ACTIVE WORK — everything running for a house right now, in one list (Design note, 2026-11-21: […]). Each kind of long work says what it is, since when, where it stands, and where
// on the desk it is watched. A new kind of running work adds its reader here, and is then seen in the tray.
// impure (reads each feature's own live state; nothing is kept here).
import { leadRunsOf } from './sales/lead-run.js';
import { liveShadowSplits } from './shadow-clone.js';
import { listGathersOf } from './sales/list-gather.js';

/**
 * @param {string} wallet
 * @returns {Array<{id: string, kind: string, title: string, detail: string, since: string, last: string[], open: {appId: string, tab?: string, office?: string}}>}
 */
export const activeWork = (wallet) => {
  const out = [];
  for (const run of leadRunsOf(wallet).filter((r) => r.active)) {
    out.push({ id: run.id, kind: 'LEAD RUN', title: `${run.counts.leads} of ${run.want} leads — ${run.segment}`, detail: `${run.spent} credit(s) spent · ${run.words}`, since: run.startedAt, last: run.last.slice(-6), open: { appId: 'positions', office: 'cro', tab: 'discover' } });
  }
  for (const g of listGathersOf(wallet).filter((x) => x.active)) {
    out.push({ id: g.id, kind: 'GATHER', title: `Gathering from ${g.name} — ${g.segment}`, detail: 'New companies for this audience, from a free public list. You are told when it is done.', since: g.startedAt, last: [], open: { appId: 'positions', office: 'cro', tab: 'discover' } });
  }
  for (const split of liveShadowSplits(wallet)) {
    out.push({ id: split.splitId, kind: 'SHADOW CLONES', title: `${split.name}: ${split.titles.length} clone(s) working`, detail: split.titles.join(' · ').slice(0, 300), since: split.since, last: [], open: { appId: 'stream' } });
  }
  return out.sort((a, b) => String(a.since).localeCompare(String(b.since)));
};
