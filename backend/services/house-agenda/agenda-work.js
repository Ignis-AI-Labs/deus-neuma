// agenda-work.js — the house agenda's work sources: team runs (their span and
// a running run's clock), the Optio's charges that carry a due time, and the
// house's scheduled posts. Each lands on the row of the member doing it; an
// item whose member is not one of this house's lanes lands on the operator's.
import { listRuns, readRun } from '../team-run-store.js';
import { dueAtMs } from '../team-clock.js';
import { cosDesignation } from '../staff/cos-designation.js';
import { listDispatches } from '../staff/dispatch-store.js';
import { postQueue } from '../social/post-queue.js';
import { ofHouse } from '../social/queue-house.js';
import { readServed } from '../house-served.js';
import { stampOf } from './agenda-time.js';

const inside = (ms, win) => Number.isFinite(ms) && ms >= win.fromMs && ms <= win.toMs;
const rowOf = (laneId, owned) => (laneId && owned.has(laneId) ? laneId : 'me');
const POST_STATES = Object.freeze(['draft', 'approved', 'sending', 'sent', 'failed']);

/**
 * A team run as agenda items: its span (start, and end once it ended) and,
 * while it runs, its clock's due time. Pure.
 */
export const runItems = (run, { win, owned, nowMs }) => {
  const startMs = Date.parse(run.runAt);
  const endMs = run.finishedAt ? Date.parse(run.finishedAt) : (run.status === 'running' ? nowMs : startMs);
  if (!(startMs <= win.toMs && endMs >= win.fromMs)) return [];
  const lane = rowOf(run.lead?.neumaId, owned);
  const title = run.name || run.goal || 'team run';
  const start = stampOf(startMs);
  const end = run.finishedAt ? stampOf(endMs) : null;
  const items = [{
    id: `run:${run.id}`, source: 'run', lane, title, day: start.day, time: start.time, status: run.status,
    ...(end ? { endDay: end.day, endTime: end.time } : {}),
  }];
  const dueMs = run.status === 'running' ? dueAtMs(run.clock) : null;
  if (inside(dueMs, win)) items.push({ id: `run-due:${run.id}`, source: 'run-due', lane, title: `${title} — due`, ...stampOf(dueMs), status: 'open' });
  return items;
};

/** A charge with a due time, on the row of the member it was given to. Pure. */
export const chargeItems = (charges, { win, owned }) => charges
  .filter((c) => inside(Date.parse(c.dueAt), win))
  .map((c) => ({ id: `charge:${c.id}`, source: 'charge', lane: rowOf(c.to, owned), title: c.title, ...stampOf(Date.parse(c.dueAt)), status: c.status }));

/** A scheduled (or sent) post, on its author's row. Pure. */
export const postItems = (entries, { win, owned }) => entries
  .filter((e) => POST_STATES.includes(e.status))
  .map((e) => ({ e, ms: Date.parse(e.status === 'sent' ? (e.sentAt || e.scheduledFor) : e.scheduledFor) }))
  .filter(({ ms }) => inside(ms, win))
  .map(({ e, ms }) => ({
    id: `post:${e.id}`, source: 'post', lane: rowOf(e.authorNeumaId, owned),
    title: String(e.text || '').replace(/\s+/g, ' ').slice(0, 80), channel: e.channelId || null,
    ...stampOf(ms), status: e.status,
  }));

/** impure — the work sources for one house. */
export const workSource = async ({ wallet, win, owned, now }) => {
  const nowMs = now.getTime();
  const runs = await listRuns(wallet);
  // a running run's clock lives on its full record, not the listing
  const full = await Promise.all(runs.map(async (r) => (r.status === 'running' ? { ...r, ...((await readRun(r.id, wallet)) || {}) } : r)));
  const officer = await cosDesignation.getOfficer(wallet).catch(() => null);
  const charges = officer?.laneId ? await listDispatches(officer.laneId) : [];
  const [entries, served] = await Promise.all([postQueue.load(), readServed()]);
  return {
    items: [
      ...full.flatMap((run) => runItems(run, { win, owned, nowMs })),
      ...chargeItems(charges, { win, owned }),
      ...postItems(ofHouse(served, entries, wallet), { win, owned }),
    ],
  };
};
