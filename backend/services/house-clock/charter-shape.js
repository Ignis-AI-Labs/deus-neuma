/**
 * THE CHARTER'S SHAPE — what a house charter may say, checked at the operator's
 * boundary (Design note, 2026-10-16: the house wakes itself for work […]).
 *
 * The charter is the operator's standing consent for waking: which seats may
 * take a work turn on their own, how often, when the house stays quiet, how
 * often the Optio reviews, what the Optio may approve, and what always comes
 * back to the operator. Everything here is pure: the store (charter-store.js)
 * lands what this module lets through, and nothing else.
 *
 * Two lines no charter can move:
 *   - MONEY OUT is the operator's alone (Founder: […]). A charter can
 *     never allow it, and it always stands in `escalate`.
 *   - The sandbox's reach stays the operator's: filesystem, fs and coding acts
 *     are never pre-allowed by a charter (a wake cannot widen where it writes).
 *
 * Unknown keys are refused, never dropped: an operator who wrote a field
 * expects it to mean something, and a charter that silently ignored it would
 * be consent to something they never read. So are unknown ACT ids in allow
 * and escalate, when the caller hands in the acts the house knows
 * (charter-store.js): a typo in […] would match nothing
 * and hold nothing (2026-10-18 audit).
 */

import { STOPS } from '../company-line/involvement-dial.js';

/** Acts that move money out of the house. Never delegated, never pre-allowed. */
export const MONEY_OUT = Object.freeze(['intents/wallet.send']);

/** Policy servers whose acts a charter can never pre-allow. */
const RESERVED_SERVERS = Object.freeze(['filesystem', 'fs', 'coding']);

export const GOAL_MAX = 500;
export const LINE_MAX = 120;
export const LINES_MAX = 12;
export const SEATS_MAX = 32;
export const DAILY_CAP_MAX = 48;
export const CADENCE_HOURS_MAX = 168;
export const PLAN_MEMBERS_MAX = 16;
export const PLAN_STEPS_MAX = 16;
export const ACTS_MAX = 32;

const LANE_ID = /^[a-zA-Z0-9_-]{1,200}$/;
const POLICY_ID = /^[a-z_]+\/[a-z0-9_.-]+$/;
const CLOCK = /^([01]\d|2[0-3]):([0-5]\d)$/;
const KEYS = Object.freeze(['goal', 'linesOfWork', 'seats', 'quietHours', 'cadence', 'delegation', 'allow', 'escalate', 'involvement']);

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isCount = (v, max) => Number.isInteger(v) && v >= 1 && v <= max;

// pure — a required, bounded, single-paragraph text
const text = (value, field, max) => {
  const t = typeof value === 'string' ? value.trim() : '';
  if (!t) throw new Error(`the charter needs a ${field}`);
  if (t.length > max) throw new Error(`the charter's ${field} exceeds ${max} characters`);
  return t;
};

// pure — 'HH:MM' → minutes after local midnight
export const clockMinutes = (hhmm) => {
  const m = CLOCK.exec(String(hhmm));
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
};

const linesOf = (value) => {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > LINES_MAX) throw new Error(`linesOfWork is a list of at most ${LINES_MAX} lines`);
  return value.map((line) => text(line, 'line of work', LINE_MAX));
};

const seatsOf = (value, ownedLanes) => {
  if (!Array.isArray(value) || value.length === 0) throw new Error('the charter names at least one seat that may wake');
  if (value.length > SEATS_MAX) throw new Error(`the charter names at most ${SEATS_MAX} seats`);
  const seen = new Set();
  return value.map((seat) => {
    if (!isObject(seat)) throw new Error('each seat is {laneId, dailyCap}');
    const laneId = typeof seat.laneId === 'string' ? seat.laneId.trim() : '';
    if (!LANE_ID.test(laneId)) throw new Error(`seat "${seat.laneId}" is not a lawful lane id`);
    if (seen.has(laneId)) throw new Error(`seat ${laneId} is named twice`);
    seen.add(laneId);
    if (ownedLanes && !ownedLanes.includes(laneId)) throw new Error(`seat ${laneId} is not a being of this house`);
    if (!isCount(seat.dailyCap, DAILY_CAP_MAX)) throw new Error(`seat ${laneId} needs a dailyCap from 1 to ${DAILY_CAP_MAX}`);
    return Object.freeze({ laneId, dailyCap: seat.dailyCap });
  });
};

const quietOf = (value) => {
  if (value == null) return null;
  if (!isObject(value)) throw new Error('quietHours is {start, end} as HH:MM local time');
  const start = clockMinutes(value.start);
  const end = clockMinutes(value.end);
  if (start == null || end == null) throw new Error('quietHours start and end are HH:MM local time');
  if (start === end) throw new Error('quietHours start and end must differ');
  return Object.freeze({ start: value.start, end: value.end });
};

const cadenceOf = (value) => {
  if (value == null) return null;
  if (!isObject(value) || !isCount(value.everyHours, CADENCE_HOURS_MAX)) {
    throw new Error(`cadence is {everyHours} from 1 to ${CADENCE_HOURS_MAX}`);
  }
  return Object.freeze({ everyHours: value.everyHours });
};

const delegationOf = (value) => {
  const d = value == null ? {} : value;
  if (!isObject(d)) throw new Error('delegation is {teamPlans, maxMembers, maxSteps}');
  if (d.teamPlans != null && typeof d.teamPlans !== 'boolean') throw new Error('delegation.teamPlans is true or false');
  const maxMembers = d.maxMembers ?? 4;
  const maxSteps = d.maxSteps ?? 8;
  if (!isCount(maxMembers, PLAN_MEMBERS_MAX)) throw new Error(`delegation.maxMembers is from 1 to ${PLAN_MEMBERS_MAX}`);
  if (!isCount(maxSteps, PLAN_STEPS_MAX)) throw new Error(`delegation.maxSteps is from 1 to ${PLAN_STEPS_MAX}`);
  return Object.freeze({ teamPlans: d.teamPlans === true, maxMembers, maxSteps });
};

// The involvement dial (company/involvement-dial.js): how close the operator
// stands to the house's company work. Unwritten is null — the line then
// stands at the dial's default.
const involvementOf = (value) => {
  if (value == null) return null;
  if (!STOPS.includes(value)) throw new Error(`involvement is one of ${STOPS.join(', ')}`);
  return value;
};

const actsOf = (value, field, knownActs) => {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > ACTS_MAX) throw new Error(`${field} is a list of at most ${ACTS_MAX} acts`);
  const out = [];
  for (const raw of value) {
    const id = typeof raw === 'string' ? raw.trim() : '';
    if (!POLICY_ID.test(id)) throw new Error(`"${raw}" in ${field} is not an act id (server/tool, e.g. intents/social.post)`);
    if (knownActs && !knownActs.has(id)) throw new Error(`"${id}" in ${field} is not an act this house knows — check its spelling (e.g. intents/social.post, web/web_search)`);
    if (!out.includes(id)) out.push(id);
  }
  return out;
};

/**
 * Check and normalize what an operator wrote. Pure — throws on anything
 * unlawful, with a message the operator can act on.
 *
 * @param {Object} input - the charter's fields as written
 * @param {{ownedLanes?: string[], knownActs?: ?Set<string>}} [opts] - the house's own lanes (seats must be
 *   among them); the act ids allow and escalate may name (none: any well-formed id)
 * @returns {Readonly<Object>} goal, linesOfWork, seats, quietHours, cadence, delegation, allow, escalate, involvement
 */
export const normalizeCharter = (input, { ownedLanes = null, knownActs = null } = {}) => {
  if (!isObject(input)) throw new Error('a charter is an object');
  const unknown = Object.keys(input).filter((k) => !KEYS.includes(k));
  if (unknown.length) throw new Error(`the charter has no field ${unknown.map((k) => `"${k}"`).join(', ')}`);
  const allow = actsOf(input.allow, 'allow', knownActs);
  for (const id of allow) {
    if (MONEY_OUT.includes(id)) throw new Error(`${id} moves money out — that is always the operator's to approve`);
    if (RESERVED_SERVERS.includes(id.split('/')[0])) throw new Error(`${id} reaches the sandbox — a charter cannot widen where a wake writes`);
  }
  const escalate = actsOf(input.escalate, 'escalate', knownActs);
  if (allow.some((id) => escalate.includes(id))) throw new Error('an act cannot be both allowed and escalated');
  return Object.freeze({
    goal: text(input.goal, 'goal', GOAL_MAX),
    linesOfWork: Object.freeze(linesOf(input.linesOfWork)),
    seats: Object.freeze(seatsOf(input.seats, ownedLanes)),
    quietHours: quietOf(input.quietHours),
    cadence: cadenceOf(input.cadence),
    delegation: delegationOf(input.delegation),
    allow: Object.freeze(allow),
    // Money out always comes back to the operator, written or not.
    escalate: Object.freeze([...new Set([...escalate, ...MONEY_OUT])]),
    involvement: involvementOf(input.involvement),
  });
};

/**
 * Where a charter stands. Pure.
 * @param {?Object} charter - the stored record
 * @returns {'none'|'unapproved'|'paused'|'active'}
 */
export const charterStanding = (charter) => {
  if (!charter) return 'none';
  if (!charter.approvedAt || charter.approvedVersion !== charter.version) return 'unapproved';
  if (charter.paused) return 'paused';
  return 'active';
};

/** The seat's row in the charter, or null when it may not wake. Pure. */
export const charterSeat = (charter, laneId) => charter?.seats?.find((s) => s.laneId === laneId) ?? null;
