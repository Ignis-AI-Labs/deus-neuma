/**
 * HOUSE STATE — the one computed answer to […].
 *
 * The seated Optio's own report (2026-09-15) named the gap: it could read the
 * pipeline, the queue, the leads, and its own ledger — but no one call said
 * […]. This module computes the WHOLE
 * posture from the real stores in one call, the way marketing's
 * pipeline-state.js computes the posting pipeline: never a maintained copy.
 *
 * THE PRIVACY LAW: cross-lane reads stop at COUNTS and STATUSES. A seat's
 * task ledger is DEK-encrypted sovereign state — the platform engine may read
 * it (it holds the keys), and what crosses into the house view is how many
 * tasks are live, never a single word of them. Unread-post counts ride
 * `peekUnread` — read-only, never advances a seat's cursor.
 *
 * Every leg fails soft on its own, the cosBoardSnapshot law: one broken store
 * never blanks the house.
 */

import { houseSeatFor } from '../house-titles.js';
import { loadHouseWorkspace } from '../house-workspace.js';
import { peekUnread } from '../house-post.js';
import { queuePosture } from '../marketing/pipeline-state.js';
import { postQueue } from '../social/post-queue.js';
import { campaignStoreFor } from '../marketing/campaign-store.js';
import { leadLedgerFor } from '../leads/lead-ledger.js';
import { houseKey } from './cos-designation.js';
import { listRuns } from '../team-run-store.js';
import { listDispatches, OPEN_DISPATCH_STATUSES, TERMINAL_DISPATCH_STATUSES } from './dispatch-store.js';
import { listEntries, OPEN_BOARD_STATUSES, BOARD_STALE_MS } from './board-store.js';
import neumaWorkspace from '../../../core/workspace/neuma-workspace.js';

const LIVE_TASK_STATUSES = new Set(['open', 'active']);

// impure — one seat's open work, counts only (THE PRIVACY LAW above). Null
// when the lane has no readable ledger — an absent reading is honest.
const seatLoad = async (neumaId) => {
  try {
    const { tasks } = await neumaWorkspace.readTaskLedger(neumaId);
    return tasks.reduce((counts, t) => {
      if (LIVE_TASK_STATUSES.has(t.status)) counts.live += 1;
      return counts;
    }, { live: 0 });
  } catch {
    return null;
  }
};

// impure — the house's OWN lead ledger, counts only; no house, no leads.
const leadCounts = async (wallet) => {
  const leads = wallet
    ? await leadLedgerFor(wallet).then((ledger) => ledger.load()).catch(() => [])
    : [];
  return {
    total: leads.length,
    byStatus: leads.reduce((acc, lead) => {
      acc[lead.status] = (acc[lead.status] || 0) + 1;
      return acc;
    }, {}),
  };
};

// impure — the house board's posture: per-seat active work (TITLES — the
// board is authored shared state, the ground's own law) and the stale count
// (audit G7: an open entry nobody has touched in a week is an orphan the
// fold surfaces, not a fact it hides).
const boardFold = async (houseRoot) => {
  if (!houseRoot) return { open: 0, stale: 0, entries: [], byOwner: {} };
  const entries = await listEntries(houseRoot).catch(() => []);
  const now = Date.now();
  const open = entries.filter((e) => OPEN_BOARD_STATUSES.includes(e.status));
  const withStale = open.map((e) => ({
    ...e,
    stale: now - Date.parse(e.updatedAt) > BOARD_STALE_MS,
  }));
  return {
    open: open.length,
    stale: withStale.filter((e) => e.stale).length,
    entries: withStale.slice(0, 10),
    byOwner: withStale.reduce((acc, e) => {
      (acc[e.owner] = acc[e.owner] || []).push(e);
      return acc;
    }, {}),
  };
};

// impure — the house's OWN campaign bench and posting failures, folded for
// the dashboard (audit G6: one call includes the cadence and the recent
// failures — the two the CoS found sitting silent). No house, no bench.
const campaignFold = async (wallet) => {
  const campaigns = wallet
    ? await campaignStoreFor(wallet).then((bench) => bench.load()).catch(() => [])
    : [];
  return {
    total: campaigns.length,
    live: campaigns.filter((c) => (c.status || '') === 'active').map((c) => c.name || c.id),
  };
};

// impure — is this queue entry the house's own? The post queue is still ONE
// machine-wide store (slice C of docs/work/house-isolation.md stamps the
// house on it), so attribution is the best this fold can read today: staged
// by the house's operator, or authored by a lane whose owner.json names the
// house in THIS process's workspace root. Residual caveat, said plainly: a
// same-named lane of another house in this root would read as ours until the
// queue carries its house.
const ownedByHouse = async (entry, house, owners) => {
  if (houseKey(entry.queuedBy) === house) return true;
  const lane = entry.authorNeumaId || (houseKey(entry.queuedBy) ? null : entry.queuedBy);
  if (!lane) return false;
  if (!owners.has(lane)) {
    owners.set(lane, neumaWorkspace.readOwner(lane).then((o) => houseKey(o?.wallet), () => null));
  }
  return (await owners.get(lane)) === house;
};

const failureFold = async (wallet) => {
  const house = houseKey(wallet);
  if (!house) return [];
  const entries = await postQueue.load().catch(() => []);
  const owners = new Map();
  const failed = [];
  for (const e of entries) {
    if (e.status === 'failed' && await ownedByHouse(e, house, owners)) failed.push(e);
  }
  return failed
    .sort((a, b) => String(b.failedAt || '').localeCompare(String(a.failedAt || '')))
    .slice(0, 5)
    .map((e) => ({ id: e.id, channel: e.channelId ?? null, error: e.error ?? 'unknown failure', failedAt: e.failedAt ?? null }));
};

/**
 * WHO IS WORKING — the lean fold the desk's activity chip polls (Founder,
 * 2026-09-15: […]). One row per seat with live work, best status first: working >
 * received > dispatched > open. Drawer + board + roster names only — no
 * queue/git walks, this is polled. Fail-soft on every leg. impure.
 * @param {string|null} wallet
 * @param {string|null} officerLane
 * @returns {Promise<Array<{neumaId: string, name: string|null, seat: string|null,
 *   status: string, task: string, since: string|null}>>}
 */
export const houseActivity = async (wallet, officerLane) => {
  if (!officerLane) return [];
  const seat = await houseSeatFor(wallet, officerLane).catch(() => null);
  const ground = await loadHouseWorkspace(wallet).catch(() => ({ root: null }));
  const nameOf = (laneId) => seat?.roster.find((r) => r.neumaId === laneId)?.name ?? null;
  const titleOf = (laneId) => seat?.roster.find((r) => r.neumaId === laneId)?.title ?? null;

  const rows = [];
  const drawer = await listDispatches(officerLane).catch(() => []);
  for (const d of drawer) {
    if (!OPEN_DISPATCH_STATUSES.includes(d.status)) continue;
    rows.push({
      neumaId: d.to,
      name: nameOf(d.to),
      seat: titleOf(d.to),
      status: d.status,
      task: d.title,
      since: d.ackAt ?? d.filedAt,
    });
  }
  if (ground.root) {
    const entries = await listEntries(ground.root).catch(() => []);
    for (const e of entries) {
      if (e.status !== 'working') continue;
      if (rows.some((r) => r.neumaId === e.owner && r.task === e.title)) continue;
      rows.push({
        neumaId: e.owner,
        name: nameOf(e.owner),
        seat: titleOf(e.owner),
        status: 'working',
        task: e.title,
        since: e.updatedAt,
      });
    }
  }
  const rank = { working: 0, received: 1, dispatched: 2, open: 3 };
  return rows
    .map((r) => ({ ...r, name: r.name ?? r.neumaId }))
    .sort((a, b) => (rank[a.status] ?? 9) - (rank[b.status] ?? 9)
      || String(a.since ?? '').localeCompare(String(b.since ?? '')));
};

/**
 * The whole house, computed. impure (disk, stores).
 * @param {{wallet?: string|null, laneId?: string|null}} who - the OFFICER's
 *   wallet and lane (the drawer and the plan of record are the office's)
 * @returns {Promise<{roster: Array, dispatches: Array, plan: Object|null,
 *   runs: Array, queue: Object, leads: Object, ownInbox: {count: number}}>}
 */
export const computeHouseState = async ({ wallet = null, laneId = null } = {}) => {
  const seat = await houseSeatFor(wallet, laneId).catch(() => null);
  const ground = await loadHouseWorkspace(wallet).catch(() => ({ root: null }));
  const drawer = await listDispatches(laneId).catch(() => []);
  const open = drawer.filter((d) => OPEN_DISPATCH_STATUSES.includes(d.status));

  const roster = await Promise.all((seat?.roster ?? [])
    .filter((r) => r.neumaId && r.neumaId !== laneId)
    .map(async (r) => {
      const [inbox, load] = await Promise.all([
        ground.root ? peekUnread(ground.root, r.neumaId).catch(() => ({ count: 0 })) : Promise.resolve({ count: 0 }),
        seatLoad(r.neumaId),
      ]);
      return {
        neumaId: r.neumaId,
        title: r.title ?? null,
        name: r.name ?? null,
        unreadPost: inbox.count,
        liveTasks: load ? load.live : null,
        openCharges: open.filter((d) => d.to === r.neumaId).length,
      };
    }));

  const board = await boardFold(ground.root).catch(() => ({ open: 0, stale: 0, entries: [], byOwner: {} }));
  const rosterWithBoard = roster.map((r) => ({
    ...r,
    boardWork: (board.byOwner[r.neumaId] || []).slice(0, 3).map((e) => ({ id: e.id, title: e.title, status: e.status, stale: e.stale })),
  }));

  const [plan, runs, queue, leads, ownInbox, campaigns, failures] = await Promise.all([
    laneId ? neumaWorkspace.readPlanRecord(laneId).catch(() => null) : Promise.resolve(null),
    wallet ? listRuns(wallet).catch(() => []) : Promise.resolve([]),
    queuePosture().catch(() => ({ error: 'queue store unreadable' })),
    leadCounts(wallet),
    ground.root ? peekUnread(ground.root, laneId).catch(() => ({ count: 0 })) : Promise.resolve({ count: 0 }),
    campaignFold(wallet),
    failureFold(wallet),
  ]);

  return {
    houseName: seat?.houseName ?? null,
    roster: rosterWithBoard,
    board: { open: board.open, stale: board.stale, entries: board.entries },
    dispatches: { open: open.length, total: drawer.length, charges: drawer.slice(0, 10) },
    plan: plan ? { goal: plan.goal, approvedAt: plan.approvedAt ?? null, steps: plan.steps?.length ?? 0 } : null,
    runs: runs.slice(0, 5),
    queue,
    leads,
    campaigns,
    failures,
    ownInbox: { count: ownInbox.count },
  };
};

const daysAgo = (iso, now) => {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((now - t) / 86_400_000));
};

/**
 * The house state as the being reads it — the `house_state` tool's answer.
 * Pure. `now` stamps the aging so the text is honest about waits.
 * @param {Object} state - a computeHouseState product
 * @param {number} now - epoch ms
 * @returns {string}
 */
export const formatHouseStateForBeing = (state, now = Date.now()) => {
  const lines = ['## HOUSE STATE'];
  lines.push(state.houseName
    ? `House ${state.houseName} — ${state.roster.length} other seat(s) on the roster.`
    : 'No founding receipt seats the office yet — the roster reads empty.');

  lines.push('', '### The seats and what they owe');
  if (!state.roster.length) {
    lines.push('No other seats stand.');
  } else {
    for (const s of state.roster) {
      const who = s.name || s.neumaId;
      lines.push(`- ${s.title || 'seat'} ${who} — ${s.openCharges} open charge(s) · ${s.unreadPost} unread post(s) · `
        + `${s.liveTasks === null ? 'task load unreadable' : `${s.liveTasks} live task(s)`}`);
      for (const w of s.boardWork ?? []) {
        lines.push(`    · [${w.id}] "${w.title}" — ${w.status}${w.stale ? ' (STALE — untouched a week or more)' : ''}`);
      }
    }
  }

  lines.push('', '### The house board');
  lines.push(state.board.open
    ? `${state.board.open} open entr${state.board.open === 1 ? 'y' : 'ies'}${state.board.stale ? ` — ${state.board.stale} STALE (untouched a week or more)` : ''}`
    : 'No open entries — board/add posts one.');
  for (const e of state.board.entries) {
    if (e.stale) lines.push(`- STALE: [${e.id}] "${e.title}" → ${e.owner} (open since ${e.filedAt})`);
  }

  lines.push('', '### Recent posting failures');
  lines.push(state.failures.length
    ? state.failures.map((f) => `- [${f.id}] ${f.channel || 'channel ?'} — ${f.error}${f.failedAt ? ` (${f.failedAt})` : ''}`).join('\n')
    : 'None recorded.');

  lines.push('', '### Campaigns');
  lines.push(state.campaigns.total
    ? `${state.campaigns.total} declared — live: ${state.campaigns.live.join(', ') || 'none active'}`
    : 'None declared.');

  lines.push('', '### The dispatch drawer');
  if (!state.dispatches.total) {
    lines.push('No charges filed yet — staff/dispatch files one.');
  } else {
    lines.push(`${state.dispatches.open} open of ${state.dispatches.total} charge(s):`);
    for (const d of state.dispatches.charges) {
      const age = daysAgo(d.filedAt, now);
      const ageText = age === null ? 'age unknown' : age === 0 ? 'today' : `${age}d ago`;
      const due = d.dueAt ? ` · due ${d.dueAt}` : '';
      const closed = TERMINAL_DISPATCH_STATUSES.includes(d.status) ? ` · ${d.status}${d.doneAt ? ` ${d.doneAt}` : ''}` : '';
      const note = d.note ? ` · note: ${d.note}` : '';
      lines.push(`- [${d.id}] "${d.title}" → ${d.to} · dispatched ${ageText}${due}${closed}${note}`);
    }
  }

  lines.push('', '### The standing plan of record');
  lines.push(state.plan
    ? `Goal: ${state.plan.goal} — ${state.plan.steps} step(s)${state.plan.approvedAt ? `, approved ${state.plan.approvedAt}` : ''}. Run it with team/run.`
    : 'None — compose one and file plan_submit for the operator\'s card.');

  lines.push('', '### Recent team runs');
  lines.push(state.runs.length
    ? state.runs.map((r) => `- ${r.name || r.id} — ${r.status}${r.finishedAt ? `, finished ${r.finishedAt}` : ' (in flight)'}`).join('\n')
    : 'None recorded.');

  lines.push('', '### The posting pipeline and the leads ledger');
  const q = state.queue;
  lines.push(q.error
    ? `queue: ${q.error}`
    : `queue: ${q.pendingApproval ?? 0} pending approval · ${q.awaitingSend ?? 0} awaiting send · ${q.failed ?? 0} failed`
      + `${q.nextScheduled ? ` · next scheduled ${q.nextScheduled}` : ''}`);
  lines.push(`leads: ${state.leads.total} total (${Object.entries(state.leads.byStatus).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'})`);
  lines.push(state.ownInbox.count
    ? `your office inbox: ${state.ownInbox.count} unread — collect with post_check.`
    : 'your office inbox: clear.');
  return lines.join('\n');
};
