/**
 * STATUS SWEEP — the standing ask behind every open charge (the Optio
 * office's cadence), as a scheduler leg beside the post and security
 * schedulers.
 *
 * THE DOCTRINE, and why this is a post and not a command: a seat acts when it
 * next speaks — nothing in this house remotely invokes a lane. What the
 * machinery owes the office is that the ask never silently dies in a drawer:
 * each tick, an OPEN charge past its cadence whose holder has not been asked
 * (or whose last ask already went uncollected) gets a status-check house post
 * from the officer's lane — a REAL post through the same grammar as any other,
 * riding the same knock to the seat's next turn. The seat collects, replies
 * through house/post, and the officer's hand moves the charge. The wait stays
 * VISIBLE (the board ages every charge); a charge past its due date surfaces
 * in the briefing for the officer to carry to the OPERATOR — escalation is
 * the office's move.
 *
 * Each house seats its own Optio (cos-designation.js), so the sweep walks
 * every seated house and asks inside that house's own ground — one house's
 * office never posts into another's. Two desks share one realm, so a sweep
 * walks only the houses this backend serves, and only an Optio that is that
 * house's lane on this backend's grounds (house-served.js) — lane ids are
 * not unique across houses.
 */

import { cosDesignation } from './cos-designation.js';
import { loadHouseWorkspace } from '../house-workspace.js';
import { makePost, appendPost, readNewPosts } from '../house-post.js';
import { listDispatches, readDispatch, recordStatusCheck, OPEN_DISPATCH_STATUSES } from './dispatch-store.js';
import { readServed, laneHouse } from '../house-served.js';
import { createLogger } from '../logger.js';

const log = createLogger('Staff.StatusSweep');

/** How often the sweep LOOKS. Pure constant (the tick, not the cadence). */
export const STATUS_TICK_MS = 6 * 60 * 60 * 1000;

/** How long a charge may sit before the office asks where it stands. */
export const STATUS_CADENCE_MS = 24 * 60 * 60 * 1000;

export const statusCheckSubject = (title) => `Status check — ${title}`;

// pure — is there an UNCOLLECTED status check for this charge already waiting
// in the holder's inbox? (A collected one was answered to; ask again.)
const checkWaitsUnread = async (root, to, charge) => {
  const subject = statusCheckSubject(charge.title);
  try {
    const { messages } = await readNewPosts(root, to);
    return messages.some((m) => m.from === charge.from && m.re === subject && m.body.includes(charge.id));
  } catch {
    return false; // an unreadable inbox reads as nothing-waiting; the post re-asks
  }
};

// impure — one house's pass: its Optio's open charges, asked inside its own
// ground. Returns what it checked and asked.
const sweepHouse = async (wallet, laneId, nowMs, cadenceMs) => {
  const drawer = await listDispatches(laneId).catch(() => []);
  const open = drawer.filter((d) => d.status === 'dispatched' || OPEN_DISPATCH_STATUSES.includes(d.status));
  if (!open.length) return { checked: 0, asked: [] };

  const asked = [];
  let root = null;
  for (const summary of open) {
    const charge = await readDispatch(laneId, summary.id).catch(() => null);
    if (!charge) continue;
    const filed = Date.parse(charge.filedAt);
    const lastChecked = charge.lastCheckedAt ? Date.parse(charge.lastCheckedAt) : Number.NaN;
    const sinceAsk = Number.isNaN(lastChecked) ? nowMs - filed : nowMs - lastChecked;
    if (!(sinceAsk >= cadenceMs)) continue;
    if (!root) root = (await loadHouseWorkspace(wallet).catch(() => ({ root: null }))).root ?? null;
    if (!root) {
      log.warn('status sweep found no house ground for a charge', { id: charge.id, house: wallet });
      continue;
    }
    if (await checkWaitsUnread(root, charge.to, charge)) continue;
    const post = makePost({
      from: laneId,
      to: charge.to,
      body: `Status check on charge [${charge.id}] "${charge.title}"${charge.dueAt ? ` (due ${charge.dueAt})` : ''}: where does it stand? `
        + 'Reply through house/post — your reply is the evidence the office records against the charge.',
      re: statusCheckSubject(charge.title),
      now: new Date(nowMs).toISOString(),
    });
    await appendPost(root, post);
    await recordStatusCheck(laneId, charge.id, post.ts).catch((err) => {
      log.warn('status-check stamp failed — the next tick may re-ask', { id: charge.id, error: err.message });
    });
    asked.push({ id: charge.id, to: charge.to });
  }
  return { checked: open.length, asked };
};

/**
 * One sweep pass over every house this backend serves that seats an Optio. impure (reads the
 * designations, the drawers, house inboxes; appends status-check posts).
 * Never throws — a failed house costs a log line, never the server or the
 * next house.
 * @param {number} nowMs - epoch ms (injected so tests own the clock)
 * @param {{cadenceMs?: number}} [opts]
 * @returns {Promise<{checked: number, asked: Array<{id: string, to: string}>}>}
 */
export const statusTick = async (nowMs = Date.now(), { cadenceMs = STATUS_CADENCE_MS } = {}) => {
  const [seated, served] = await Promise.all([
    cosDesignation.seatedHouses().catch((err) => {
      log.error('status sweep could not list the seated houses', { error: err.message });
      return [];
    }),
    readServed(),
  ]);
  const houses = seated.filter(({ wallet, officer }) => laneHouse(served, officer.laneId, wallet));
  let checked = 0;
  const asked = [];
  for (const { wallet, officer } of houses) {
    const pass = await sweepHouse(wallet, officer.laneId, nowMs, cadenceMs).catch((err) => {
      log.warn('status sweep failed for a house', { house: wallet, error: err.message });
      return { checked: 0, asked: [] };
    });
    checked += pass.checked;
    asked.push(...pass.asked);
  }
  if (asked.length) log.info('status checks filed', { asked });
  return { checked, asked };
};

/**
 * Start the slow heartbeat. Never blocks the server's listen; the interval is
 * unref'd so it cannot hold the process open. Double-start safe.
 * @returns {() => void} stop
 */
// impure
export const startStatusScheduler = ({ intervalMs = STATUS_TICK_MS } = {}) => {
  const timer = setInterval(() => {
    statusTick().catch((err) => log.error('status tick failed', { error: err.message }));
  }, intervalMs);
  timer.unref?.();
  log.info('status sweep standing', { everyMs: intervalMs });
  return () => clearInterval(timer);
};
