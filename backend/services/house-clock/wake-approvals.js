/**
 * APPROVALS INSIDE A WAKE — nobody is at the desk to tap a card, and a wake
 * must never hang on one (Design note, 2026-10-16: […]; […]).
 *
 * Every approval-gated act a wake reaches for comes to the broker
 * (tool-approval.js), which asks this route first. The operator's own ALLOW
 * ONCE on exactly this act (one-shot-grants.js) goes first; then the table,
 * the Optio's review's (optio-review.js actRoute):
 *   - an act the charter's `allow` names proceeds — the charter is the
 *     operator's standing yes, and the act ledger records it as the charter's;
 *     so does a read inside the house's own ground;
 *   - the operator's acts — ALWAYS money out, every act the charter's
 *     `escalate` names even where a grant would let it through
 *     (protocol-guard.js holdForWake), posting and email, deletes, reach
 *     outside the ground, the Optio's own acts — are refused in the turn with
 *     an honest reason, FILED as an operator ask, and raised on the tray;
 *   - everything else is reviewed by the Optio (ruling, 2026-10-16): CLEAR runs,
 *     recorded as her yes; HOLD is refused with her reason, filed and raised.
 * None of it waits on a person or holds the wake's place in the line.
 *
 * A TEAM MEMBER's turn (team-member-turn.js) asks the same table under its
 * house's active charter (memberApprovalRoute): its operator's acts are
 * refused and filed like a wake's, naming its run and step; the Optio
 * reviews the rest. It holds what a wake holds (houseHolds).
 *
 * The charter is read at each approval, never once for the whole turn: an
 * edit binds house work already running. A wake whose charter was edited and
 * not approved again files every gated act for the operator; PAUSE stops the
 * next wake, and the one running finishes under its charter.
 *
 * DECISIONS (Design note, 2026-10-16: […]): an ask_operator in house work never waits on a
 * card nobody is watching (operator-ask.js `_askRoute`). Each question is
 * filed as a 'decision' ask and the turn goes on at once (decisionRoute).
 *
 * Team plans have their own road (wake-plan.js): inside the charter's
 * delegation they go to the Optio.
 *
 * impure — the asks store, the notification bus.
 */
import path from 'path';
import { notifyOperator } from '../notification-bus.js';
import { KIND, STANDING } from '../../../core/runtime/notification-record.js';
import { scopeOf } from '../act-ledger.js';
import { createLogger } from '../logger.js';
import { cosDesignation } from '../staff/cos-designation.js';
import { MONEY_OUT, charterStanding } from './charter-shape.js';
import { readCharter } from './charter-store.js';
import { fileAsk, readAsks, closeAsk } from './wake-ledger.js';
import { BENCH_LAUNCH, actPaths, actRoute, houseGround, pathsInGround, reviewAct } from './optio-review.js';
import { askArgs, consumeGrant } from './one-shot-grants.js';

const log = createLogger('HouseClock.Approvals');

/** What a woken seat reads when an act it reached for needs the operator. */
export const WAKE_APPROVAL_REFUSAL = 'This is a house wake — the house woke you for your own work, and nobody is at the desk to approve this act. It was NOT taken: it is filed for your operator, who sees it in the house clock. Carry on with what you can do, and say plainly what waits on them.';

/** What a woken seat reads for one act filed for the operator: why, and where it may work freely when the act reached outside. Pure. */
const wakeRefusal = (why, roots) => `${WAKE_APPROVAL_REFUSAL} Why it needs them: ${why}.`
  + (roots ? ` The house's ground is ${roots.join(' and ')}: reads inside it need no one, so look there instead.` : '');

/** What a seat reads for a relative path: nothing filed, and the full path to name instead. Pure. */
const relativeRefusal = (relative, own) => `"${relative}" is a relative path, and a relative path is read from the backend's folder, not yours, so it was NOT taken and nothing was filed. `
  + `Name the full path: your own folder is ${own}, so you likely mean ${path.join(own, relative)}.`;

/** Why a wake's act went to the operator once its charter changed under it. */
export const CHARTER_CHANGED = 'the house\'s charter was changed while this wake ran, and the change is not approved yet';

/** What a member reads when an act it reached for is filed for the operator. */
export const MEMBER_FILED_REFUSAL = 'This act needs your operator\'s approval, and nobody is at the desk during a team run. It was NOT taken: it is filed for your operator, who answers it in the house clock. Carry on with what you can do inside the team workspace, and name what waits on them in your status.';

/** What a member reads when the Optio held its act: her reason, so it can correct itself. Pure. */
const optioHoldRefusal = (reason) => `The house's Optio reviewed this act and HELD it: ${reason}. It was NOT taken; your operator was alerted and decides it. If the Optio is right, correct the act and carry on; if not, carry on with what you can do and say plainly what waits on your operator.`;

// pure — the tray card's title for one filed ask
const askTitle = (work, ask) => {
  if (ask.kind === 'plan') return `${work.name}'s wake sent a team plan to you`;
  if (ask.kind === 'decision') return `${work.name} asks for your decision — filed for you`;
  if (ask.review === 'hold') return `The Optio held ${work.name}'s ${ask.tool} — filed for you`;
  return `${work.name}'s ${work.teamRun ? 'team step' : 'wake'} was refused ${ask.tool} — filed for you`;
};

// pure — the seat's own OPEN ask for exactly this act, if it filed one already:
// the same tool and arguments (or, unhashed, the same reach) and the same route
const sameOpenAct = (asks, seat, ask) => (ask.kind !== 'act' ? null : asks.find((a) => a.status === 'open'
  && a.kind === 'act' && a.seat === seat && a.tool === ask.tool && (a.review ?? null) === (ask.review ?? null)
  && (a.argsHash ?? null) === (ask.argsHash ?? null) && (a.argsHash || a.scope === ask.scope)) ?? null);

// pure — the seat's open asks for the same act on the same file, with other arguments
const olderAttempts = (asks, seat, ask) => {
  const file = ask.kind === 'act' ? ask.args?.path : null;
  if (typeof file !== 'string' || !file) return [];
  return asks.filter((a) => a.status === 'open' && a.kind === 'act' && a.seat === seat && a.tool === ask.tool
    && (a.review ?? null) === (ask.review ?? null) && a.args?.path === file && a.argsHash !== ask.argsHash);
};

/**
 * File one thing house work could not do or decide without the operator, and
 * tell them. impure. Rejects only when the ask itself could not be written.
 * An act the seat already filed, still open, is not filed or sent again: the
 * operator sees it once (2026-10-17: one seat filed the same read eleven times).
 * @param {Object} work - { wallet, seat, name, wakeId, sessionId, escalations, teamRun? }
 * @param {Object} ask - { kind, tool?, planId?, scope?, question?, options?, why }
 * @returns {Promise<Object>} the filed ask
 */
const fileForOperator = async (work, ask) => {
  work.escalations.push({ ...ask, at: new Date().toISOString() });
  const open = await readAsks(work.wallet).catch(() => []);
  const already = sameOpenAct(open, work.seat, ask);
  if (already) return already;
  const filed = await fileAsk(work.wallet, {
    wakeId: work.wakeId, seat: work.seat, sessionId: work.sessionId,
    ...(work.teamRun ? { runId: work.teamRun.runId, stepId: work.teamRun.stepId } : {}),
    ...ask,
  });
  // A newer attempt at the same file supersedes the seat's older ones still open: the operator
  // answers the act as it now stands, once (2026-10-18: fifteen held writes of one findings file).
  for (const old of olderAttempts(open, work.seat, ask)) {
    await closeAsk(work.wallet, { id: old.id, by: 'house', note: `superseded by the newer attempt [${filed.id}]` }).catch(() => {});
  }
  Promise.resolve(notifyOperator({
    wallet: work.wallet,
    kind: KIND.houseWake,
    standing: STANDING.neuma,
    title: askTitle(work, ask),
    detail: ask.kind === 'decision' ? ask.question : ask.why,
    actor: { id: work.seat, name: work.name },
    ref: { sessionId: work.sessionId, wakeId: work.wakeId, askId: filed.id },
  })).catch(() => {});
  return filed;
};

/**
 * File one thing a wake could not do, and tell the operator. impure, never
 * throws — the turn goes on whatever the record does.
 * @param {Object} wake - { wallet, seat, name, wakeId, sessionId, escalations }
 * @param {Object} ask - { kind, tool?, planId?, scope?, why }
 */
export const escalate = (wake, ask) => {
  fileForOperator(wake, ask)
    .catch((err) => log.error('a house ask could not be filed', { seat: wake.seat, error: err.message }));
};

/**
 * The broker's route for house work: the table, then the Optio's review.
 * impure (the designation, the ground, the review, escalate). Never throws
 * past a deny.
 * @param {Object} work - { wallet, seat, name, wakeId, sessionId, escalations, teamRun?, assignment?, statedIntent? }
 * @param {{charterFor: () => Promise<?Object>, extraRoots?: string[]}} opts - charterFor: the charter that stands now, or null
 * @returns {(req: {tool: string, args?: Object, scope?: string, signal?: AbortSignal}) =>
 *   Promise<{decision: 'allow'|'deny', by?: string, approvedBy?: Object, refusal?: string}>}
 */
const houseActRoute = (work, { charterFor, extraRoots = [] }) => async ({ tool, args, scope, signal }) => {
  const label = String(tool || '');
  const charter = await charterFor();
  // No charter stands for a member: refused, unfiled, as its refusal says.
  if (!charter && work.teamRun) return { decision: 'deny' };
  // The operator's ALLOW ONCE on this exact act (one-shot-grants.js): used here, never again.
  const grant = await consumeGrant(work.wallet, { seat: work.seat, tool: label, args });
  if (grant) return { decision: 'allow', by: 'operator', approvedBy: { kind: 'operator', askId: grant.askId } };
  // The arguments ride the ask (hashed, and whole while short): an ALLOW ONCE grants exactly them.
  const ask = { kind: 'act', tool: label, scope: scope ? String(scope).slice(0, 300) : scopeOf(args), ...askArgs(args) };
  // A wake's charter edited under it and not approved again: every gated act is the operator's.
  if (!charter) {
    escalate(work, { ...ask, why: CHARTER_CHANGED });
    return { decision: 'deny', refusal: wakeRefusal(CHARTER_CHANGED, null) };
  }
  const [officer, roots] = await Promise.all([
    cosDesignation.getOfficer(work.wallet).then((o) => o?.laneId ?? null, () => null),
    houseGround(work.wallet, work.seat, extraRoots),
  ]);
  const paths = actPaths(label, args);
  // A relative path resolves from the backend's own folder, never the seat's: refuse it with the
  // seat's full path rather than file a reach the seat never meant (2026-10-17: "charter" read as the repo).
  const relative = paths.find((p) => typeof p === 'string' && p && !path.isAbsolute(p));
  if (relative) return { decision: 'deny', refusal: relativeRefusal(relative, roots[0]) };
  const inGround = await pathsInGround(paths, roots);
  const route = actRoute({ charter, tool: label, args, seat: work.seat, officer, inGround });
  if (route.to === 'allow') return { decision: 'allow', by: route.by };
  if (route.to === 'operator') {
    escalate(work, { ...ask, why: route.why });
    return { decision: 'deny', refusal: work.teamRun ? MEMBER_FILED_REFUSAL : wakeRefusal(route.why, inGround ? null : roots) };
  }
  const verdict = await reviewAct({
    optio: officer, act: { tool: label, args }, member: work.name,
    statedIntent: work.statedIntent?.() ?? '', assignment: work.assignment ?? '', goal: charter.goal,
  }, { signal });
  if (verdict.verdict === 'clear') return { decision: 'allow', by: 'optio-review', approvedBy: { kind: 'optio-review', optio: officer } };
  escalate(work, { ...ask, review: 'hold', why: `the Optio held it: ${verdict.reason}` });
  return { decision: 'deny', refusal: optioHoldRefusal(verdict.reason) };
};

/**
 * What house work holds for the operator even where a standing grant would
 * let it through (protocol-guard.js holdForWake): ALWAYS money out and a
 * benchmark launch, and every act the charter escalates. A wake and a team
 * member hold the same. Pure.
 * @param {?Object} charter - the stored record, or null
 * @returns {Set<string>} policy ids (`server/tool`)
 */
export const houseHolds = (charter) => new Set([...MONEY_OUT, BENCH_LAUNCH, ...(charter?.escalate ?? [])]);

/** The holds of the house's charter as it is written now, approved or not. impure, never throws. */
export const readHouseHolds = async (wallet) => houseHolds(await readCharter(wallet).catch(() => null));

// impure — the house's charter as it stands NOW, when its standing is one of `stands`. Every act the
// charter as written escalates joins the turn's `holds` from then on: holding more only asks the operator.
const liveCharter = (wallet, holds, stands) => async () => {
  const charter = await readCharter(wallet).catch(() => null);
  for (const id of charter?.escalate ?? []) holds?.add(id);
  return stands.includes(charterStanding(charter)) ? charter : null;
};

/**
 * The broker's route for one wake, under its house's charter as it stands at
 * each act — paused included, since the wake already running finishes. impure.
 * @param {Object} wake - { wallet, seat, name, wakeId, sessionId, escalations, holds, assignment?, statedIntent? }
 */
export const wakeApprovalRoute = (wake) => houseActRoute(wake, { charterFor: liveCharter(wake.wallet, wake.holds, ['active', 'paused']) });

// pure — one member's work record: its run and step name every ask it files
const memberWork = ({ teamRun = null, ...member }) => ({
  ...member, wakeId: null, escalations: [], teamRun: teamRun ?? { runId: null, stepId: null },
});

/**
 * The broker's route for a team member's turn, under its house's ACTIVE
 * charter — no charter, or a paused one, refuses as before, unfiled. impure.
 * @param {{wallet: string, seat: string, name: string, sessionId: ?string, assignment: string,
 *   statedIntent: () => string, extraRoots?: string[], teamRun?: ?{runId: string, stepId: string}, holds?: Set<string>}} member
 */
export const memberApprovalRoute = (member) => houseActRoute(memberWork(member), {
  charterFor: liveCharter(member.wallet, member.holds, ['active']),
  extraRoots: member.extraRoots ?? [],
});

// pure — what the seat reads once its questions are filed
const filedWords = (filed) => `Filed for your operator as ${filed.length === 1 ? 'a decision' : `${filed.length} decisions`} [${filed.map((a) => `ask ${a.id}`).join(', ')}]. `
  + 'They answer in the house clock, and the house wakes you with their answer. Do not wait for it: carry on now with everything that does not need them.';

/**
 * The ask_operator route for house work: each question filed as a decision
 * ask, answered at once with where it went. impure. Resolves null when no
 * active charter stands to file it under (the asker hears no one can answer).
 * @param {Object} work - { wallet, seat, name, wakeId, sessionId, escalations, teamRun? }
 * @param {() => Promise<?Object>} charterFor
 * @returns {(questions: Array<{question: string, header: string, options: Array<{label: string}>}>) => Promise<?string>}
 */
const decisionRoute = (work, charterFor) => async (questions) => {
  if (!(await charterFor())) return null;
  const filed = [];
  for (const q of questions) {
    filed.push(await fileForOperator(work, {
      kind: 'decision',
      question: q.question,
      ...(q.header ? { header: q.header } : {}),
      options: q.options.map((o) => o.label),
      why: 'a decision only you can make',
    }));
  }
  return filedWords(filed);
};

/** A wake's ask_operator route. impure. */
export const wakeDecisionRoute = (wake) => decisionRoute(wake, async () => wake.charter);

/** A team member's ask_operator route, under its house's active charter. impure. */
export const memberDecisionRoute = (member) => decisionRoute(memberWork(member), liveCharter(member.wallet, null, ['active']));
