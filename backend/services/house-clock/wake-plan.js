/**
 * A TEAM PLAN IN A WAKE — the Optio approves inside the charter (Founder,
 * 2026-10-16: […]).
 *
 * A lead's plan_submit in its own chat raises the operator's card. In a wake
 * no one is there to rule, so the plan takes the charter's road instead
 * (team-plan.js submitPlan `decide`):
 *   - INSIDE THE DELEGATION — the charter delegates team plans, the plan is
 *     within its member and step counts, an Optio is seated, chartered, and is
 *     not the lead itself — the plan is recorded here and the Optio is woken
 *     with it. Its verdict line (wake-thought.js parseVerdicts) is applied
 *     through the plan-of-record path the operator's yes uses
 *     (persistApprovedPlan), stamped `approvedBy: optio` — which the dispatch
 *     gate honours (intents/team-run.js) — and the lead is woken with it.
 *   - OUTSIDE IT, or no verdict — the plan goes to the operator: filed as an
 *     ask, raised on the tray. Nothing runs.
 *
 * `<realm>/<wallet>/house-clock/plans/<id>.json`, one per plan, every verdict
 * on the record.
 *
 * impure — the realm, the designation store, the lead's plan of record.
 */
import { randomBytes } from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { writeJsonAtomic } from '../user-realm.js';
import neumaWorkspace from '../../../core/workspace/neuma-workspace.js';
import { cosDesignation } from '../staff/cos-designation.js';
import { persistApprovedPlan, operatorRoster } from '../team-plan.js';
import { createLogger } from '../logger.js';
import { charterSeat } from './charter-shape.js';
import { clockDir } from './wake-ledger.js';
import { signalWake } from './wake-signal.js';
import { escalate } from './wake-approvals.js';
import { parseVerdicts } from './wake-thought.js';

const log = createLogger('HouseClock.Plan');
const PLAN_ID = /^plan-[a-f0-9]{12}$/;

const planFile = (wallet, id) => path.join(clockDir(wallet), 'plans', `${id}.json`);

/**
 * Where a wake's plan goes. Pure.
 * @param {{charter: Object, lead: string, officer: ?string, steps: Object[]}} args
 * @returns {{to: 'optio'} | {to: 'operator', why: string}}
 */
export const planRouting = ({ charter, lead, officer, steps }) => {
  const d = charter.delegation;
  if (!d.teamPlans) return { to: 'operator', why: 'the charter does not delegate team plans to the Optio' };
  if (!officer) return { to: 'operator', why: 'no Optio is seated to approve it' };
  if (officer === lead) return { to: 'operator', why: 'the Optio never approves its own plan' };
  if (!charterSeat(charter, officer)) return { to: 'operator', why: 'the Optio is not a seat the charter lets wake' };
  const members = new Set(steps.map((s) => s.neumaId)).size;
  if (members > d.maxMembers) return { to: 'operator', why: `the plan has ${members} members — the charter delegates at most ${d.maxMembers}` };
  if (steps.length > d.maxSteps) return { to: 'operator', why: `the plan has ${steps.length} steps — the charter delegates at most ${d.maxSteps}` };
  return { to: 'optio' };
};

/** One plan's record, or null. impure. */
export const readWakePlan = async (wallet, id) => {
  if (!PLAN_ID.test(String(id))) return null;
  try {
    return JSON.parse(await fs.readFile(planFile(wallet, id), 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
};

/** A seat's own name, from its DNA (the lane id when unreadable). impure. */
export const seatName = async (laneId) => {
  const dna = await neumaWorkspace.readDNA(laneId).catch(() => null);
  return dna?.identity?.name || dna?.name || laneId;
};

/**
 * The `decide` a wake hands submitPlan: the charter's road for the lead's
 * plan. impure. Resolves at once — never a card, never a wait.
 * @param {Object} wake - { wallet, seat, name, wakeId, sessionId, charter, escalations }
 * @returns {(connection: Object, req: Object) => Promise<{status: string, note: string}>}
 */
export const wakePlanRoute = (wake) => async (_connection, req) => {
  const officer = (await cosDesignation.getOfficer(wake.wallet).catch(() => null))?.laneId ?? null;
  const route = planRouting({ charter: wake.charter, lead: wake.seat, officer, steps: req.steps });
  const label = req.name ? `"${req.name}"` : 'you submitted';
  if (route.to === 'operator') {
    escalate(wake, { kind: 'plan', why: `${route.why}: ${String(req.goal).slice(0, 200)}` });
    return {
      status: 'escalated',
      note: `Your plan ${label} was NOT approved: ${route.why}. It is filed for your operator, who rules on team plans at the desk — nobody is there now. Do not file team/run for it; tell your operator about it when they next speak with you.`,
    };
  }
  const id = `plan-${randomBytes(6).toString('hex')}`;
  await writeJsonAtomic(planFile(wake.wallet, id), {
    v: 1, id, status: 'with-optio', lead: wake.seat, leadName: wake.name, optio: officer,
    leadSessionId: wake.sessionId, submittedAt: new Date().toISOString(), fromWake: wake.wakeId,
    plan: {
      name: req.name ?? null, goal: req.goal, steps: req.steps, memberNames: req.memberNames || {},
      ...(req.workspace ? { workspace: req.workspace } : {}),
      ...(req.clock ? { clock: req.clock } : {}),
      ...(req.concurrency ? { concurrency: req.concurrency } : {}),
      ...(req.checkIn != null ? { checkIn: req.checkIn } : {}),
    },
  });
  signalWake({ seat: officer, reason: 'plan-review', ref: id, detail: { lead: wake.seat, name: req.name ?? null } });
  const optioName = await seatName(officer);
  return {
    status: 'routed',
    note: `Your plan ${label} went to ${optioName}, the house's Optio, who approves team plans inside the charter [plan ${id}]. It is NOT approved yet — the house will wake you with its verdict. Do not file team/run until then.`,
  };
};

// impure — the Optio's yes, made the lead's plan of record (the operator's yes path)
const applyApproval = async (wallet, record, wakeId) => {
  const roster = await operatorRoster(wallet);
  const approvedAt = new Date().toISOString();
  const lead = { companion: { neumaId: record.lead }, sessionId: record.leadSessionId };
  await persistApprovedPlan(lead, Object.freeze({ ...record.plan }), roster, { approvedAt });
  const stored = await neumaWorkspace.readPlanRecord(record.lead);
  if (!stored || stored.approvedAt !== approvedAt) throw new Error('the plan of record did not land');
  await neumaWorkspace.writePlanRecord(record.lead, {
    ...stored, approvedBy: { kind: 'optio', laneId: record.optio, planId: record.id, wakeId },
  });
  return approvedAt;
};

/**
 * After the Optio's wake: rule every plan it was shown, from its own words.
 * impure. Never throws — a plan that cannot be applied goes to the operator.
 * @param {Object} wake - { wallet, seat, name, wakeId, sessionId, escalations }
 * @param {Object[]} items - the wake's queue items
 * @param {string} text - the Optio's reply
 * @returns {Promise<Array<{planId: string, verdict: string}>>}
 */
export const settlePlanReviews = async (wake, items, text) => {
  const ids = items.filter((i) => i.reason === 'plan-review').map((i) => i.ref);
  const verdicts = parseVerdicts(text, ids);
  const settled = [];
  for (const id of ids) {
    const record = await readWakePlan(wake.wallet, id).catch(() => null);
    if (!record || record.status !== 'with-optio') continue;
    let ruled = verdicts[id] ?? null;
    let approvedAt = null;
    if (ruled?.verdict === 'approve') {
      try {
        approvedAt = await applyApproval(wake.wallet, record, wake.wakeId);
      } catch (err) {
        log.error('the Optio\'s approval could not be applied', { planId: id, error: err.message });
        ruled = null;
      }
    }
    const status = !ruled ? 'with-operator' : ruled.verdict === 'approve' ? 'approved' : 'revised';
    if (!ruled) escalate(wake, { kind: 'plan', planId: id, why: `the Optio did not rule on ${record.leadName}'s plan: ${String(record.plan.goal).slice(0, 200)}` });
    await writeJsonAtomic(planFile(wake.wallet, id), {
      ...record, status, verdict: ruled ? { ...ruled, by: wake.seat, at: new Date().toISOString(), wakeId: wake.wakeId, approvedAt } : null,
    });
    signalWake({
      seat: record.lead, reason: 'plan-verdict', ref: id,
      detail: { verdict: ruled?.verdict ?? 'none', name: record.plan.name, notes: ruled?.notes ? ruled.notes.slice(0, 300) : null },
    });
    settled.push({ planId: id, verdict: ruled?.verdict ?? 'none' });
  }
  return settled;
};
