// CoS briefing — the Optio's office section, composed FRESH from the real
// stores each turn: the house roster (the office's address book), the posts
// waiting in the office's house inbox, the standing plan of record, and the
// house's recent team runs.
//
// The empty-string law holds absolutely: any lane but the seated Optio's —
// and any store failure — yields '', so every other being's prompt is
// byte-identical to before this office existed. Every string crossing into
// the prompt is whitespace-collapsed and length-capped, the same sanitation
// the HOUSE SEAT and CMO sections carry.

import { cosDesignation } from './cos-designation.js';
import { houseSeatFor, chargeOfTitle } from '../house-titles.js';
import { loadHouseWorkspace } from '../house-workspace.js';
import { readNewPosts } from '../house-post.js';
import { listRuns } from '../team-run-store.js';
import { computeHouseState } from './house-state.js';
import { OPEN_DISPATCH_STATUSES, TERMINAL_DISPATCH_STATUSES } from './dispatch-store.js';
import neumaWorkspace from '../../../core/workspace/neuma-workspace.js';
import { createLogger } from '../logger.js';

const log = createLogger('Staff.Briefing');

const POST_PREVIEW_CAP = 5;
const RUN_CAP = 5;

// One bounded line, never structure: roster titles/names and post bodies all
// cross a file boundary into prompt text.
const clean = (s, max = 80) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

const rosterLines = (seat, selfId) => seat.roster.map((r) => {
  const charge = chargeOfTitle(r.title);
  const holder = r.neumaId === selfId ? 'YOU'
    : r.isWitness ? 'your operator'
      : r.name ? clean(r.name, 60) : 'a housemate (not on a lane)';
  return `- ${clean(r.title, 60)} — ${holder}${charge ? ` — ${charge}` : ''}`;
});

const postLines = (posts) => {
  if (!posts.count) return ['None — the office inbox is clear.'];
  const recent = posts.recent.map((m) =>
    `- ${clean(m.from, 60)}${m.re ? ` — "${clean(m.re, 80)}"` : ''}: ${clean(m.body, 120)}`);
  return [
    `${posts.count} unread post(s) wait for you — collect them with post_check before you close the session.`,
    ...recent,
    ...(posts.count > POST_PREVIEW_CAP ? [`- …and ${posts.count - POST_PREVIEW_CAP} more.`] : []),
    ...(posts.torn ? [`(${posts.torn} torn line(s) in the inbox — post_check surfaces them strictly.)`] : []),
  ];
};

const runLine = (run) =>
  `- ${clean(run.name || run.id, 60)} — ${clean(run.status, 20)}${run.finishedAt ? `, finished ${clean(run.finishedAt, 30)}` : ' (in flight)'}`;

const DAY_MS = 86_400_000;

// One line per open charge, honest about the wait. Pure.
const chargeLines = (dispatches, now) => {
  const charges = dispatches?.charges ?? [];
  if (!charges.length) return ['The drawer is empty — staff/dispatch files a standing charge.'];
  const open = charges.filter((c) => OPEN_DISPATCH_STATUSES.includes(c.status));
  return [
    `${dispatches.open} open of ${dispatches.total} charge(s) — staff/dispatch files, staff/dispatch-update moves:`,
    ...charges.slice(0, 5).map((c) => {
      const age = Number.isFinite(Date.parse(c.filedAt))
        ? `${Math.max(0, Math.floor((now - Date.parse(c.filedAt)) / DAY_MS))}d`
        : '?';
      const closed = TERMINAL_DISPATCH_STATUSES.includes(c.status) ? ` (${c.status})` : '';
      const due = c.dueAt ? `, due ${clean(c.dueAt, 30)}` : '';
      return `- [${clean(c.id, 30)}] "${clean(c.title, 60)}" → ${clean(c.to, 40)} — dispatched ${age} ago${due}${closed}`;
    }),
    ...(open.some((c) => c.dueAt && Date.parse(c.dueAt) < now)
      ? ['At least one charge is PAST DUE — carry it to the operator; escalation is the office\'s move, not a failure.']
      : []),
  ];
};

/**
 * The office's board, read fresh from the real stores — shared by the prompt
 * briefing below and the desk's GET /api/v1/staff/board. impure; every part
 * fails soft on its own so one broken store never blanks the whole board.
 * `house` carries the one computed fold (house-state.js: roster loads, the
 * dispatch drawer, queue/leads posture) beside the office's own reads.
 * @param {string|null} wallet
 * @param {string} laneId
 * @returns {Promise<{seat: Object|null, posts: {count: number, torn: number, recent: Array},
 *   plan: Object|null, runs: Array, house: Object|null}>}
 */
export const cosBoardSnapshot = async (wallet, laneId) => {
  const [seat, ground, plan, runs, house] = await Promise.all([
    wallet ? houseSeatFor(wallet, laneId).catch(() => null) : null,
    wallet ? loadHouseWorkspace(wallet).catch(() => ({ root: null })) : { root: null },
    // The lawful read path: the workspace engine holds the DEK; a plan whose
    // bytes cannot be opened reads as no plan, never as a key on a hot path.
    neumaWorkspace.readPlanRecord(laneId).catch(() => null),
    wallet ? listRuns(wallet).catch(() => []) : Promise.resolve([]),
    wallet ? computeHouseState({ wallet, laneId }).catch(() => null) : Promise.resolve(null),
  ]);
  let posts = { count: 0, torn: 0, recent: [] };
  if (ground?.root) {
    const { messages, torn } = await readNewPosts(ground.root, laneId).catch(() => ({ messages: [], torn: 0 }));
    posts = { count: messages.length, torn, recent: messages.slice(-POST_PREVIEW_CAP).reverse() };
  }
  return { seat, posts, plan, runs: runs.slice(0, RUN_CAP), house };
};

/** The Optio office briefing; every non-seated lane receives an empty section. impure. */
export const cosBriefingSection = async (connection) => {
  const neumaId = connection.companion?.neumaId;
  if (!neumaId) return '';
  try {
    const officer = await cosDesignation.getOfficer(connection.walletAddress);
    if (officer?.laneId !== neumaId) return '';
    const { seat, posts, plan, runs, house } = await cosBoardSnapshot(connection.walletAddress, neumaId);
    return [
      '## CHIEF OF STAFF OFFICE',
      'You hold the Optio office — you are the house\'s chief of staff, the operator\'s standing delegate for managing the house\'s other beings. Doctrine: staff/playbook.md; standing charges: staff/dispatches/. While you hold this office, the house\'s dispatch crosses YOU — a team filing from another lane is denied and sent to your house inbox. Every working team run of the house is yours to govern: how many parts work at once, each clock, the check-ins — team/tune; every desk sees who changed what.',
      '',
      '### The house as it stands',
      seat
        ? [`House ${clean(seat.houseName, 60) || '(unnamed)'} — the roster is your address book; post through house/post:`, ...rosterLines(seat, neumaId)].join('\n')
        : 'No founding receipt seats you yet — the roster reads empty until the operator\'s house record stands. Ask before assuming a seat.',
      '',
      '### The dispatch drawer',
      ...chargeLines(house?.dispatches ?? null, Date.now()),
      '',
      '### House post waiting for you',
      ...postLines(posts),
      ...(plan ? [
        '',
        '### The standing plan of record',
        `Goal: ${clean(plan.goal, 200)} — ${plan.steps.length} step(s)${plan.approvedAt ? `, approved ${clean(plan.approvedAt, 30)}` : ''}. Run it with team/run; a new plan replaces it through plan_submit and the operator's card.`,
      ] : []),
      '',
      '### Recent team runs',
      runs.length ? runs.map(runLine).join('\n') : 'None recorded — the house has not run a team yet.',
    ].join('\n');
  } catch (error) {
    log.warn('CoS briefing failed', { neumaId, error: error.message });
    return '';
  }
};
