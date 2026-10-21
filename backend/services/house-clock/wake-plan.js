/**
 * A TEAM PLAN IN A WAKE — the Optio approves inside the charter (Founder,
 * 2026-10-16: […]).
 *
 * A lead's plan_submit in its own chat raises the operator's card. In a wake
 * no one is there to rule, so the plan takes the charter's road instead
 * (team-plan.js submitPlan `decide`):
 *   - INSIDE THE DELEGATION — the charter delegates team plans, the plan is
 *     within its member and step counts, an Optio is seated and chartered —
 *     the plan is recorded here and the Optio is woken with it. Its verdict line (wake-thought.js parseVerdicts) is applied
 *     through the plan-of-record path the operator's yes uses
 *     (persistApprovedPlan), stamped `approvedBy: optio` — which the dispatch
 *     gate honours (intents/team-run.js) — and the lead is woken with it.
 *   - THE OPTIO'S OWN PLAN, inside the delegation, is approved by the charter
 *     itself (Design note, 2026-10-16: […]): stamped `approvedBy: charter` at the charter's version and made
 *     her plan of record through the same path. A plan that gives the Optio's
 *     own lane a step still goes to the operator (her no-self-approval term).
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
import { charterSeat, charterStanding } from './charter-shape.js';
import { readCharter } from './charter-store.js';
import { clockDir } from './wake-ledger.js';
import { signalWake } from './wake-signal.js';
import { escalate, CHARTER_CHANGED } from './wake-approvals.js';
import { houseGround, pathsInGround } from './optio-review.js';
import { parseVerdicts } from './wake-thought.js';

const log = createLogger('HouseClock.Plan');
const PLAN_ID = /^plan-[a-f0-9]{12}$/;

const planFile = (wallet, id) => path.join(clockDir(wallet), 'plans', `${id}.json`);

/**
 * Where a wake's plan goes. Pure.
 * @param {{charter: ?Object, lead: string, officer: ?string, steps: Object[], strayWorkspace?: ?string}} args -
 *   charter: the house's charter as it stands now, null when edited and not approved again;
 *   strayWorkspace: the plan's workspace root when it stands outside the house's ground
 * @returns {{to: 'optio'|'charter'} | {to: 'operator', why: string}}
 */
export const planRouting = ({ charter, lead, officer, steps, strayWorkspace = null }) => {
  if (!charter) return { to: 'operator', why: CHARTER_CHANGED };
  const d = charter.delegation;
  if (!d.teamPlans) return { to: 'operator', why: 'the charter does not delegate team plans to the Optio' };
  if (!officer) return { to: 'operator', why: 'no Optio is seated to approve it' };
  if (!charterSeat(charter, officer)) return { to: 'operator', why: 'the Optio is not a seat the charter lets wake' };
  const members = new Set(steps.map((s) => s.neumaId)).size;
  if (members > d.maxMembers) return { to: 'operator', why: `the plan has ${members} members — the charter delegates at most ${d.maxMembers}` };
  if (steps.length > d.maxSteps) return { to: 'operator', why: `the plan has ${steps.length} steps — the charter delegates at most ${d.maxSteps}` };
  // An approved workspace becomes every member's write root: only the operator widens the house's reach.
  if (strayWorkspace) return { to: 'operator', why: `the plan names a workspace outside the house's ground (${strayWorkspace})` };
  if (officer !== lead) return { to: 'optio' };
  if (steps.some((s) => s.neumaId === officer)) return { to: 'operator', why: 'the plan gives the Optio steps of her own, and the Optio never approves her own work' };
  return { to: 'charter' };
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
 * plan, under the charter as it stands at the plan — an edit binds the wake
 * already running, as it binds its acts (wake-approvals.js). impure. Resolves
 * at once — never a card, never a wait.
 * @param {Object} wake - { wallet, seat, name, wakeId, sessionId, escalations }
 * @returns {(connection: Object, req: Object) => Promise<{status: string, note: string}>}
 */
export const wakePlanRoute = (wake) => async (_connection, req) => {
  const officer = (await cosDesignation.getOfficer(wake.wallet).catch(() => null))?.laneId ?? null;
  const written = await readCharter(wake.wallet).catch(() => null);
  const charter = ['active', 'paused'].includes(charterStanding(written)) ? written : null;
  const root = req.workspace?.root ?? null;
  const inGround = !root || await pathsInGround([root], await houseGround(wake.wallet, wake.seat));
  const route = planRouting({ charter, lead: wake.seat, officer, steps: req.steps, strayWorkspace: inGround ? null : root });
  const label = req.name ? `"${req.name}"` : 'you submitted';
  const id = `plan-${randomBytes(6).toString('hex')}`;
  const record = {
    v: 1, id, status: route.to === 'operator' ? 'with-operator' : 'with-optio', lead: wake.seat, leadName: wake.name, optio: officer,
    leadSessionId: wake.sessionId, submittedAt: new Date().toISOString(), fromWake: wake.wakeId,
    plan: {
      name: req.name ?? null, goal: req.goal, steps: req.steps, memberNames: req.memberNames || {},
      ...(req.workspace ? { workspace: req.workspace } : {}),
      ...(req.clock ? { clock: req.clock } : {}),
      ...(req.concurrency ? { concurrency: req.concurrency } : {}),
      ...(req.checkIn != null ? { checkIn: req.checkIn } : {}),
    },
  };
  if (route.to === 'operator') {
    // Recorded, so the operator's APPROVE in the house clock can make it the plan of record (ask-answer.js).
    await writeJsonAtomic(planFile(wake.wallet, id), record);
    escalate(wake, { kind: 'plan', planId: id, why: `${route.why}: ${String(req.goal).slice(0, 200)}` });
    return {
      status: 'escalated',
      note: `Your plan ${label} was NOT approved: ${route.why}. It is filed for your operator [plan ${id}], who rules on it in the house clock — nobody is at the desk now. Do not file team/run for it; the house wakes you with their answer.`,
    };
  }
  if (route.to === 'charter') return charterApproves(wake, charter, record, label);
  await writeJsonAtomic(planFile(wake.wallet, id), record);
  signalWake({ seat: officer, reason: 'plan-review', ref: id, detail: { lead: wake.seat, name: req.name ?? null } });
  const optioName = await seatName(officer);
  return {
    status: 'routed',
    note: `Your plan ${label} went to ${optioName}, the house's Optio, who approves team plans inside the charter [plan ${id}]. It is NOT approved yet — the house will wake you with its verdict. Do not file team/run until then.`,
  };
};

// impure — the Optio's own plan inside the delegation: the charter IS the
// yes, recorded at its version and applied as the Optio's yes is
const charterApproves = async (wake, charter, record, label) => {
  const version = charter.approvedVersion ?? charter.version;
  const at = new Date().toISOString();
  let approvedAt = null;
  try {
    approvedAt = await applyApproval(wake.wallet, record, { kind: 'charter', version, wakeId: wake.wakeId });
  } catch (err) {
    log.error('the charter\'s approval could not be applied', { planId: record.id, error: err.message });
  }
  await writeJsonAtomic(planFile(wake.wallet, record.id), {
    ...record,
    status: approvedAt ? 'approved' : 'with-operator',
    verdict: approvedAt ? { verdict: 'approve', notes: '', by: 'charter', version, at, wakeId: wake.wakeId, approvedAt } : null,
  });
  if (!approvedAt) {
    escalate(wake, { kind: 'plan', planId: record.id, why: `the charter's approval could not be applied: ${String(record.plan.goal).slice(0, 200)}` });
    return { status: 'escalated', note: `Your plan ${label} could not be made your plan of record, so it is filed for your operator [plan ${record.id}]. Do not file team/run for it.` };
  }
  return {
    status: 'charter-approved',
    note: `Your plan ${label} is inside the charter's delegation, so the charter (version ${version}) approved it [plan ${record.id}]. It is your standing plan of record: file team/run to put your team to work.`,
  };
};

// impure — a yes inside the charter (the Optio's, or the charter's own) or
// the operator's own answer, made the lead's plan of record through the
// operator's yes path
const applyApproval = async (wallet, record, approvedBy) => {
  const roster = await operatorRoster(wallet);
  const approvedAt = new Date().toISOString();
  const lead = { companion: { neumaId: record.lead }, sessionId: record.leadSessionId };
  await persistApprovedPlan(lead, Object.freeze({ ...record.plan }), roster, { approvedAt });
  const stored = await neumaWorkspace.readPlanRecord(record.lead);
  if (!stored || stored.approvedAt !== approvedAt) throw new Error('the plan of record did not land');
  await neumaWorkspace.writePlanRecord(record.lead, { ...stored, approvedBy: { ...approvedBy, planId: record.id } });
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
        approvedAt = await applyApproval(wake.wallet, record, { kind: 'optio', laneId: record.optio, wakeId: wake.wakeId });
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

/**
 * The operator rules on a plan that came to them (ask-answer.js): APPROVE
 * makes it the lead's plan of record, stamped approvedBy operator; REVISE
 * sends it back with their notes. impure. Throws when the plan is not the
 * operator's to rule (no record, or ruled already) or its yes did not land.
 * @param {string} wallet
 * @param {{askId: string, planId: string, decision: 'approve'|'revise', text?: string}} ruling
 */
export const operatorRulesPlan = async (wallet, { askId, planId, decision, text = '' }) => {
  const record = await readWakePlan(wallet, planId);
  if (!record || record.status !== 'with-operator') throw new Error(`plan ${planId} is not waiting on you (${record?.status ?? 'no record'})`);
  const at = new Date().toISOString();
  const approvedAt = decision === 'approve' ? await applyApproval(wallet, record, { kind: 'operator', askId }) : null;
  await writeJsonAtomic(planFile(wallet, planId), {
    ...record,
    status: approvedAt ? 'approved' : 'revised',
    verdict: { verdict: decision, notes: text, by: 'operator', askId, at, approvedAt },
  });
};
