// team-watch.js — the EYE on a working team run (#577).
//
// Design note, 2026-10-13: […]
// Always on, clock or no clock:
//   - a CHECK-IN every `checkIn` minutes of the run's life (default 60; 0 =
//     none — the plan's, changed live by any hand): how the run stands, each
//     part's place, its working time, its clock and its last sign of life;
//   - an ALERT the moment a clock acts or a part gives up (the run keeps its
//     other parts working).
// Both reach the operator's desk (the tray — one line each, the WORKFLOW
// window holds the rest live) and the house's seated CoS: a house post from
// the lead's lane into the Optio's inbox, read at its next turn — the
// office's own grammar (staff/status-sweep.js), never a push into its turn.
// While an Optio is seated it holds dispatch (intents/team-run.js), so it
// usually LEADS the run itself: no post to itself then — its plan of record
// carries the run's standing every turn (plan-record.js withRunLiveness).
//
// impure — a timer; the notification bus; the house post. The words are pure.

import { notifyOperator } from './notification-bus.js';
import { KIND, STANDING } from '../../core/runtime/notification-record.js';
import { cosDesignation } from './staff/cos-designation.js';
import { loadHouseWorkspace } from './house-workspace.js';
import { makePost, appendPost, POST_BODY_MAX } from './house-post.js';
import { clockFor, describeClock, formatMinutes, DEFAULT_CHECK_IN_MINUTES } from './team-clock.js';
import neumaWorkspace from '../../core/workspace/neuma-workspace.js';
import { createLogger } from './logger.js';
import { signalWake } from './house-clock/wake-signal.js';

const log = createLogger('TeamWatch');

/** A working part with no sign of life for this long is named in a check-in. */
export const QUIET_NAMED_MS = 30 * 60_000;

const span = (ms) => formatMinutes(Math.max(0, ms) / 60_000);
const title = (entry) => entry.name || 'Team run';

// pure — where one part stands, in a few words.
const placeOf = (entry, row) => {
  if (row.state !== 'working') return row.state;
  const line = entry.lines?.[row.id];
  if (entry.retries?.[row.id]) return 'stopped short, about to be continued';
  if (line?.state === 'held') return 'held by the run\'s width';
  if (line?.state === 'waiting') return 'waiting its turn for the model';
  return 'working';
};

// pure — a part's working time, the stretch it works now included.
const workedOf = (entry, stepId, now) => (entry.worked?.[stepId] || 0)
  + (entry.workingSince?.[stepId] ? now - entry.workingSince[stepId] : 0);

/**
 * The check-in, whole — the CoS's post, and the source of the desk's line. Pure.
 * @param {Object} entry - the live run
 * @param {number} [now]
 * @returns {{head: string, notable: string[], lines: string[]}}
 */
export const checkInOf = (entry, now = Date.now()) => {
  const rows = entry.board || [];
  const count = (state) => rows.filter((r) => r.state === state).length;
  const age = span(now - Date.parse(entry.startedAt));
  const head = `${title(entry)} — ${age} in: ${count('working')} working, ${count('waiting')} waiting, ${count('done')} done${count('failed') ? `, ${count('failed')} failed` : ''}`;
  const notable = [];
  const lines = rows.map((row) => {
    const clock = clockFor(entry, row.id);
    const passed = entry.clockState?.[row.id];
    const quiet = row.state === 'working' && entry.lastActive?.[row.id] ? now - entry.lastActive[row.id] : null;
    if (passed) notable.push(`${row.member || row.id}'s clock passed`);
    if (quiet != null && quiet >= QUIET_NAMED_MS) notable.push(`${row.member || row.id} quiet ${span(quiet)}`);
    if (row.state === 'failed') notable.push(`${row.member || row.id} failed`);
    return `- ${row.id} · ${row.member || row.neumaId || row.id}: ${placeOf(entry, row)}; worked ${span(workedOf(entry, row.id, now))}`
      + `${clock ? `; clock ${describeClock(clock)}${passed ? ` — PASSED (${passed.then})` : ''}` : ''}`
      + `${quiet != null ? `; last sign of life ${span(quiet)} ago` : ''}`;
  });
  return { head, notable, lines };
};

/** What a clock did, said to the operator and the CoS. Pure. */
export const clockAlertOf = (entry, stepId, state) => {
  const row = (entry.board || []).find((r) => r.id === stepId) || { id: stepId };
  const did = { notify: 'it keeps working', 'wrap-up': 'it is handing in what it has', stop: 'it was stopped — resume the run to continue it' }[state.then] || 'it acted';
  return {
    title: `${title(entry)}: ${row.member || stepId}'s clock passed — ${did}`,
    detail: `${stepId}: ${state.clock}; ${state.by === 'due' ? 'its due time came' : 'its working time ran out'}`,
  };
};

/** A part that will not be continued on its own, said to the operator and the CoS. Pure. */
export const gaveUpAlertOf = (entry, stepId, why) => {
  const row = (entry.board || []).find((r) => r.id === stepId) || { id: stepId };
  return {
    title: `${title(entry)}: ${row.member || stepId} stopped and will not be continued on its own`,
    detail: `${stepId}: ${why}`,
  };
};

// impure — the post into the house's seated Optio's inbox, from the lead's
// lane. None when the house seats no office, the lead IS the office, or the
// office is not a lane of this house (the second fence beside the per-house seat).
const postToOptio = async ({ wallet, from, re, body, reason = 'run-check-in', ref = re }) => {
  const officer = await cosDesignation.getOfficer(wallet).catch(() => null);
  if (!officer?.laneId || officer.laneId === from) return false;
  const house = await neumaWorkspace.listNeumaByOwner(wallet).catch(() => []);
  if (!house.some((lane) => (lane?.neumaId ?? lane) === officer.laneId)) return false;
  const { root } = await loadHouseWorkspace(wallet).catch(() => ({ root: null }));
  if (!root) return false;
  const text = body.length > POST_BODY_MAX ? `${body.slice(0, POST_BODY_MAX - 1)}…` : body;
  const post = await appendPost(root, makePost({ from, to: officer.laneId, re, body: text, now: new Date().toISOString() }));
  // The Optio has work — the run's watch: the house clock may wake it.
  signalWake({ seat: officer.laneId, reason, ref: `${ref}:${post.id}`, detail: { from, re } });
  return true;
};

/**
 * Stand the eye up over a run that just started. Sets the run's hooks for
 * the part runner (a clock acted, a part gave up) and the check-in timer; a
 * hand's new cadence restarts it (entry.rewatch). The stop is entry.stopWatch,
 * called when the run leaves the live map.
 *
 * @param {Object} entry - the live run
 * @param {Object} args
 * @param {string} args.wallet - the operator
 * @param {{neumaId: string, name: string}} args.lead
 * @param {Function} [args.notify] - the desk (notification-bus.js)
 * @param {Function} [args.post] - the CoS's inbox
 */
export const startWatch = (entry, { wallet, lead, notify = notifyOperator, post = postToOptio }) => {
  const actor = { id: lead.neumaId, name: lead.name || lead.neumaId };
  const ref = { runId: entry.id };
  // Each leg fails alone: a card or a post must never cost the run.
  const tell = (kind, card, body, re) => {
    Promise.resolve(notify({ wallet, kind, standing: STANDING.neuma, title: card.title, detail: card.detail, actor, ref }))
      .catch((err) => log.warn('run watch card not raised', { runId: entry.id, error: err.message }));
    Promise.resolve(post({ wallet, from: lead.neumaId, re, body, reason: kind === KIND.runAlert ? 'run-alert' : 'run-check-in', ref: entry.id }))
      .catch((err) => log.warn('run watch post not delivered', { runId: entry.id, error: err.message }));
  };
  entry.onClockPassed = (stepId, state) => {
    const card = clockAlertOf(entry, stepId, state);
    tell(KIND.runAlert, card, `${card.title}.\n${card.detail}.\nRun ${entry.id} — the WORKFLOW window shows it live; team/tune changes its clock or width.`, `Team run ${entry.id}: a clock passed`);
  };
  entry.onPartGaveUp = (stepId, why) => {
    const card = gaveUpAlertOf(entry, stepId, why);
    tell(KIND.runAlert, card, `${card.title}.\n${card.detail}.\nRun ${entry.id} — its other parts keep working; the operator can resume it once it settles.`, `Team run ${entry.id}: a member gave up`);
  };
  let timer = null;
  const checkIn = () => {
    const { head, notable, lines } = checkInOf(entry);
    const card = { title: head, detail: notable.length ? notable.join(' · ') : 'every working part is moving' };
    tell(KIND.runCheckIn, card, [`CHECK-IN — ${head}.`, ...lines, `Run ${entry.id}, led by ${entry.lead}.`].join('\n'), `Team run ${entry.id}: check-in`);
  };
  entry.rewatch = () => {
    if (timer) clearInterval(timer);
    timer = null;
    const minutes = entry.checkIn ?? DEFAULT_CHECK_IN_MINUTES;
    if (!(minutes > 0)) return;
    timer = setInterval(checkIn, Math.round(minutes * 60_000));
    timer.unref?.();
  };
  entry.stopWatch = () => {
    if (timer) clearInterval(timer);
    timer = null;
  };
  entry.rewatch();
};
