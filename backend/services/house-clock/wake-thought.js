/**
 * THE WAKE'S OPENING NOTE — what a woken seat reads first, and the Optio's
 * verdict line read back out of its reply. Pure.
 *
 * The note opens by naming itself the platform's ([…]): a wake is never phrased as the operator, never injected
 * into a live chat, and never rides the held-words queue (the 7d99f6b11 repeal
 * stands). It names every piece of work the wake carries and its reference,
 * and closes with the wake's law: the charter's goal, nobody at the desk, acts
 * that need the operator are filed for them, money out is always theirs.
 */

export const WAKE_HEAD = '[A WAKE — the platform, not your operator]';

const clip = (s, n) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

// pure — one line per piece of work, by its reason
const LINES = Object.freeze({
  post: (i) => `House post waits for you from ${i.detail?.from ?? 'a housemate'}${i.detail?.re ? ` (re: ${clip(i.detail.re, 120)})` : ''} [post ${i.ref}] — collect it with post_check.`,
  dispatch: (i) => `Your Optio filed charge [${i.ref}] "${clip(i.detail?.title, 120)}" to you — it is in your house post; acknowledge it (staff/ack) as you take it up.`,
  'run-ended': (i) => `Your team run ${i.ref} ended (${i.detail?.status ?? 'settled'}). Its report is named in your plan of record — read it and bring the work together for your operator.`,
  'run-check-in': (i) => `A check-in on team run ${String(i.ref).split(':')[0]} reached you as the house's Optio — it is in your house post.`,
  'run-alert': (i) => `An alert on team run ${String(i.ref).split(':')[0]} reached you as the house's Optio — it is in your house post.`,
  cadence: (i) => `Your review cadence (every ${i.detail?.everyHours ?? '?'}h) as the house's Optio: look over the house (house_state, the board, open charges) and move the work the charter's goal needs.`,
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
    `The charter's lines of work: ${charter.linesOfWork.length ? charter.linesOfWork.join('; ') : 'none named — the goal alone'}. It lets you approve at most ${charter.delegation.maxMembers} members and ${charter.delegation.maxSteps} steps (this plan: ${members.size} and ${p.steps.length}).`,
    `Approve only a plan that serves the charter's goal and stays inside its lines of work. Rule by ending your reply with ONE line: "VERDICT ${plan.id}: APPROVE" or "VERDICT ${plan.id}: REVISE — <what must change>". No verdict line sends the plan to your operator.`,
  ].join('\n');
};

/**
 * The wake's opening note. Pure.
 * @param {{items: Object[], charter: Object, plans?: Object<string, Object>}} args -
 *   plans: plan-review records by id (wake-plan.js)
 * @returns {string}
 */
export const wakeThought = ({ items, charter, plans = {} }) => {
  const work = items.map((i) => (i.reason === 'plan-review'
    ? planReview(i, plans[i.ref], charter)
    : (LINES[i.reason] || ((x) => `Work for you: ${x.reason} [${x.ref}].`))(i)));
  return [
    `${WAKE_HEAD} The house woke you for your own work — ${items.length === 1 ? 'one thing waits' : `${items.length} things wait`}:`,
    ...work,
    '',
    `This is a WORK turn the house took on its own, inside the charter your operator approved: "${clip(charter.goal, 300)}". `
      + 'Nobody is at the desk. An act that needs your operator\'s approval is not taken in a wake — it is filed for them, and you carry on with what you can do. '
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
