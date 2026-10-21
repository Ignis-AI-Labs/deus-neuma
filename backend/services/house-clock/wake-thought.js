/**
 * THE WAKE'S OPENING NOTE — what a woken seat reads first, and the Optio's
 * verdict line read back out of its reply. Pure.
 *
 * The note opens by naming itself the platform's ([…]): a wake is never phrased as the operator, never injected
 * into a live chat, and never rides the held-words queue (the 7d99f6b11 repeal
 * stands). It names every piece of work the wake carries and its reference,
 * and closes with the wake's law: the charter's goal, nobody at the desk, file
 * what needs the operator (gated acts, decisions through ask_operator) and
 * carry on with everything that does not, money out is always theirs.
 */

import { localDay } from './wake-gate.js';

export const WAKE_HEAD = '[A WAKE — the platform, not your operator]';

/** A calendar moment woken for later than this is told as past ("was due at"), never as now. */
export const LATE_MS = 2 * 60_000;

const clip = (s, n) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

// pure — a calendar moment's local instant: a task's day and HH:MM, or a charge's dueAt
const momentOf = (i) => {
  if (i.reason === 'charge-due') return Date.parse(i.detail?.dueAt ?? '');
  const [y, m, d] = String(i.detail?.day ?? '').split('-').map(Number);
  const [h, mi] = String(i.detail?.time ?? '').split(':').map(Number);
  return new Date(y, m - 1, d, h, mi).getTime();
};

// pure — […] (on its day, when not today) for a moment woken for late, else null
// (2026-10-18 audit: a block missed while the app was closed must not read "starts now")
const lateWords = (i, now) => {
  const at = momentOf(i);
  if (!Number.isFinite(now) || !Number.isFinite(at) || now - at <= LATE_MS) return null;
  const day = localDay(at);
  return `was due at ${new Date(at).toTimeString().slice(0, 5)}${day === localDay(now) ? '' : ` on ${day}`}`;
};

// pure — one line per piece of work, by its reason; `now` tells a calendar moment woken for late
const LINES = Object.freeze({
  post: (i) => `House post waits for you from ${i.detail?.from ?? 'a housemate'}${i.detail?.re ? ` (re: ${clip(i.detail.re, 120)})` : ''} [post ${i.ref}] — collect it with post_check.`,
  dispatch: (i) => `Your Optio filed charge [${i.ref}] "${clip(i.detail?.title, 120)}" to you — it is in your house post; acknowledge it (staff/ack) as you take it up.`,
  'run-ended': (i) => `Your team run ${i.ref} ended (${i.detail?.status ?? 'settled'}). Its report is named in your plan of record — read it and bring the work together for your operator.`,
  'run-check-in': (i) => `A check-in on team run ${String(i.ref).split(':')[0]} reached you as the house's Optio — it is in your house post.`,
  'run-alert': (i) => `An alert on team run ${String(i.ref).split(':')[0]} reached you as the house's Optio — it is in your house post.`,
  cadence: (i) => `Your review cadence (every ${i.detail?.everyHours ?? '?'}h) as the house's Optio: look over the house (staff/house_state, staff/board_list, the charges in your briefing) and move the work the charter's goal needs: to charge a member with work, file the staff/dispatch intent. If anything waits on your operator (your briefing lists the open asks), bring it back to them as one review packet (house/review-packet).`,
  scheduled: (i, now) => {
    const late = lateWords(i, now);
    if (i.detail?.endTime) {
      return late
        ? `Your time block "${clip(i.detail?.title, 120)}" on your calendar ${late} (${i.detail.time}–${i.detail.endTime}) [${i.ref}] — the house was not awake for it; take it up now, or say where it stands (tasks/update).`
        : `Your time block "${clip(i.detail?.title, 120)}" on your calendar starts now (${i.detail.time}–${i.detail.endTime}) [${i.ref}] — take it up.`;
    }
    return late
      ? `"${clip(i.detail?.title, 120)}" on your calendar ${late} and is still open [${i.ref}] — finish it, or say where it stands (tasks/update).`
      : `"${clip(i.detail?.title, 120)}" on your calendar is due now (${i.detail?.time}) and is still open [${i.ref}] — finish it, or say where it stands (tasks/update).`;
  },
  'charge-due': (i, now) => `Your charge [${i.detail?.id ?? i.ref}] "${clip(i.detail?.title, 120)}" from ${i.detail?.from ?? 'the Optio'} ${lateWords(i, now) ?? 'reached its due time'} and is still open — finish it, or ack where it stands (staff/ack).`,
  'run-lost': (i) => `Your team run ${i.ref}${i.detail?.name ? ` ("${clip(i.detail.name, 80)}")` : ''} was LOST when the backend stopped${Number.isInteger(i.detail?.completed) ? ` (${i.detail.completed} of ${i.detail.steps} parts done)` : ''}. Decide: pick it up by filing team/run {"resume": "${i.ref}"}, or say why it should not resume.`,
  'plan-verdict': (i) => {
    const v = i.detail?.verdict;
    const name = i.detail?.name ? ` "${clip(i.detail.name, 80)}"` : '';
    if (v === 'approve') return `The Optio APPROVED your team plan${name} inside the charter [plan ${i.ref}]. It is your standing plan of record: file team/run to put your team to work.`;
    if (v === 'revise') return `The Optio asked for REVISIONS to your team plan${name} [plan ${i.ref}]: ${clip(i.detail?.notes, 600) || 'it named none'}. Revise it and submit it again (plan_submit).`;
    return `The Optio did not rule on your team plan${name} [plan ${i.ref}], so it went to your operator. Do not file team/run for it.`;
  },
});

// pure — a plan put before the Optio, whole enough to rule on
const planReview = (i, plan, charter) => {
  if (!plan) return `A team plan [plan ${i.ref}] was put before you, but its record could not be read — rule nothing on it.`;
  const p = plan.plan;
  const names = p.memberNames || {};
  const members = new Set(p.steps.map((s) => s.neumaId));
  return [
    `${plan.leadName || plan.lead} put a team plan before you, the house's Optio, to approve inside the charter [plan ${plan.id}].`,
    `Plan${p.name ? ` "${clip(p.name, 80)}"` : ''}: ${clip(p.goal, 600)}`,
    ...p.steps.map((s) => `- ${s.id} · ${names[s.neumaId] || s.neumaId}: ${clip(s.task, 300)}${s.needs?.length ? ` (after ${s.needs.join(', ')})` : ''}`),
    `Workspace, where every member writes once you approve: ${p.workspace?.root ?? 'none named — a fresh arena of its own'}.`,
    `The charter's lines of work: ${charter.linesOfWork.length ? charter.linesOfWork.join('; ') : 'none named — the goal alone'}. It lets you approve at most ${charter.delegation.maxMembers} members and ${charter.delegation.maxSteps} steps (this plan: ${members.size} and ${p.steps.length}).`,
    `Approve only a plan that serves the charter's goal and stays inside its lines of work. Rule by ending your reply with ONE line: "VERDICT ${plan.id}: APPROVE" or "VERDICT ${plan.id}: REVISE — <what must change>". No verdict line sends the plan to your operator.`,
  ].join('\n');
};

// pure — how the seat takes an allowed act again, exactly as it was filed
const retake = (ask) => {
  if (!ask.args) return `take ${ask.tool} again with exactly the arguments you used`;
  const json = JSON.stringify(ask.args);
  return ask.tool.startsWith('intents/')
    ? `file the intent again (a new file in your intents/) with exactly this content: ${json}`
    : `call ${ask.tool} with exactly these arguments: ${json}`;
};

// pure — what the operator's answer means for the seat, by the ask's kind
const ANSWERED = Object.freeze({
  allow: (a) => `They ALLOWED ONCE your ${a.tool}${a.scope ? ` (${clip(a.scope, 200)})` : ''}. Take it now: ${retake(a)}. It is allowed once, for exactly those arguments; anything different is refused and filed again.`,
  deny: (a) => `They DENIED your ${a.tool}${a.scope ? ` (${clip(a.scope, 200)})` : ''}. Do not take it again; carry on without it.`,
  approve: (a) => `They APPROVED your team plan [plan ${a.planId}]. It is your standing plan of record: file team/run to put your team to work.`,
  revise: (a) => `They asked for REVISIONS to your team plan [plan ${a.planId}] — their notes follow. Revise it and submit it again (plan_submit).`,
  reply: (a) => `You asked them: "${clip(a.question, 600)}".${a.answer.option ? ` They chose: ${a.answer.option}.` : ''}`,
});

// pure — the operator's answer, relayed: the platform's line, then their own words exactly as written
const answerLines = (i, ask) => {
  if (!ask?.answer) return `Your operator answered what you filed for them [ask ${i.ref}], but its record could not be read — ask them in your next sitting.`;
  return [
    `Your operator ANSWERED what you filed for them [ask ${ask.id}]. ${ANSWERED[ask.answer.decision](ask)}`,
    ...(ask.answer.text ? ['Your operator\'s own words, verbatim, between the markers (the platform relays them unedited):', '<<<', ask.answer.text, '>>>'] : []),
  ].join('\n');
};

// pure — the platform's own record of a run's web reads, set beside whatever its report claims
// (2026-10-18: findings claimed four sources "opened live today"; the operator's record could not check it)
const WEB_READ_SHOWN = 12;
const webReadWords = (reads) => {
  if (!reads.length) {
    return 'The platform recorded NO web reads by its members during the run: any source its report says was opened, fetched or checked live was not reached through this house — treat such a claim as unverified, and say so to your operator.';
  }
  const shown = reads.slice(0, WEB_READ_SHOWN).map((r) => `${r.tool.replace(/^web\//, '')} "${clip(r.scope, 100)}"${r.status === 'error' ? ' (failed)' : ''}`);
  return `The platform recorded ${reads.length} web read(s) by its members during the run: ${shown.join('; ')}${reads.length > WEB_READ_SHOWN ? `; …and ${reads.length - WEB_READ_SHOWN} more` : ''}. A source the report claims beyond these was not reached through this house.`;
};

// pure — where the seat works, said every wake: a fresh sitting remembers no refusal from the last one
// (2026-10-18: the Optio listed the folder above every member's lane at the start of each review)
const groundWords = ({ own, house }) => `Your own folder is ${own}; `
  + (house ? `the house's shared ground is ${house}. Work and look there; ` : 'this house has no shared ground yet, so work in your own folder; ')
  + 'every other member\'s folder is theirs, sealed. ';

/**
 * The wake's opening note. Pure.
 * @param {{items: Object[], charter: Object, plans?: Object<string, Object>, answers?: Object<string, Object>,
 *   ground?: ?{own: string, house: ?string}, now?: ?number}} args - plans: plan-review records by id (wake-plan.js); answers:
 *   answered asks by id (operator-answer items); ground: the seat's own folder and the house's shared one; now: the
 *   wake's instant (epoch ms), so a calendar moment woken for late reads "was due at" (none: every moment reads as now)
 * @returns {string}
 */
export const wakeThought = ({ items, charter, plans = {}, answers = {}, ground = null, now = null, webReads = {} }) => {
  const work = items.map((i) => {
    if (i.reason === 'plan-review') return planReview(i, plans[i.ref], charter);
    if (i.reason === 'operator-answer') return answerLines(i, answers[i.ref]);
    const line = (LINES[i.reason] || ((x) => `Work for you: ${x.reason} [${x.ref}].`))(i, now);
    return i.reason === 'run-ended' && webReads[i.ref] ? `${line} ${webReadWords(webReads[i.ref])}` : line;
  });
  return [
    `${WAKE_HEAD} The house woke you for your own work — ${items.length === 1 ? 'one thing waits' : `${items.length} things wait`}:`,
    ...work,
    '',
    // The charter whole — its goal at full length (the shape allows GOAL_MAX) and
    // its lines of work: the operator's direction to the house, never clipped
    // away (2026-10-16 live test: a cut goal and unseen lines hid two tasks).
    `This is a WORK turn the house took on its own, inside the charter your operator approved: "${charter.goal}". `
      + `Its lines of work: ${charter.linesOfWork?.length ? charter.linesOfWork.map((l) => `"${l}"`).join('; ') : 'none named — the goal alone'}. `
      + (ground ? groundWords(ground) : '')
      + 'Nobody is at the desk, and nothing here waits for them. File what needs your operator, then carry on with everything that does not: '
      + 'an act that needs their approval is filed for them when you reach for it (it is not taken), and a decision only they can make goes to them through ask_operator, which files it and returns at once. '
      + 'Stop only where you truly cannot move forward without them. '
      + 'Money out is always theirs. Say plainly what you did and what waits on them: your operator reads this sitting.',
  ].join('\n');
};

/**
 * The Optio's verdicts, read from its reply: "VERDICT <planId>: APPROVE" or
 * […]. A bare "VERDICT:" counts only when one
 * plan was before it. The last word on a plan stands. Pure.
 * @param {string} text - the Optio's reply
 * @param {string[]} planIds - the plans this wake put before it
 * @returns {Object<string, {verdict: 'approve'|'revise', notes: string}>}
 */
export const parseVerdicts = (text, planIds) => {
  const out = {};
  const re = /^[ \t>*_-]*VERDICT(?:\s+([A-Za-z0-9_-]+))?\s*:\s*\**\s*(APPROVE|REVISE)\b\**[ \t]*[:—–-]*[ \t]*(.*)$/gim;
  for (const m of String(text || '').matchAll(re)) {
    const id = m[1] && planIds.includes(m[1]) ? m[1] : (!m[1] && planIds.length === 1 ? planIds[0] : null);
    if (!id) continue;
    out[id] = { verdict: m[2].toLowerCase(), notes: m[3].trim().slice(0, 2000) };
  }
  return out;
};
