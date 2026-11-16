/**
 * house/wake — a house member sets what wakes it (Design note, 2026-11-15: […]). See house-clock/wake-rules.js.
 *
 *   {add: {kind, ...}, ...}  a rule: time, price, lp-value, new-pools, posts
 *   {remove: id}             drop one
 *   {list: true}             its rules, what each last did, and whether it can wake at all
 *
 * Any member of the house files it, from a chat or a wake. Its rules wake it
 * only through the house clock, inside the charter: seated, its daily cap, the
 * quiet hours. A shape the platform refuses is refused as invalid, so the
 * member's fix to the same file runs (intent-sweep.js).
 */
import neumaWorkspace from '../../../core/workspace/neuma-workspace.js';
import { seatOf } from '../flight-check.js';
import { readCharter } from '../house-clock/charter-read.js';
import { charterStanding, charterSeat } from '../house-clock/charter-shape.js';
import { normalizeRule, changeWakeRules, readWakeRules, ruleWords } from '../house-clock/wake-rules.js';

const lower = (v) => String(v ?? '').toLowerCase();

// impure — the member's lane when it belongs to this connection's house; null otherwise.
const ownLane = async (connection) => {
  const laneId = connection?.companion?.neumaId;
  const wallet = lower(connection?.walletAddress);
  if (!laneId || !wallet || seatOf(connection) === 'witness') return null;
  const lanes = (await neumaWorkspace.listNeumaByOwner(wallet).catch(() => [])).map((o) => o.neumaId);
  return lanes.includes(laneId) ? laneId : null;
};

// impure — whether the clock can wake this member at all, in one line.
const standingLine = async (wallet, laneId) => {
  const charter = await readCharter(lower(wallet)).catch(() => null);
  const standing = charterStanding(charter);
  if (standing === 'none') return 'YOU CANNOT WAKE YET: your house has no charter. Set one up: house/charter {goal, seat: {dailyCap}}.';
  if (standing === 'paused') return 'YOUR OPERATOR HAS THE HOUSE PAUSED: rules fire, but their wakes wait until they resume it.';
  const seat = charterSeat(charter, laneId);
  if (!seat) return 'YOU ARE NOT SEATED in the house charter, so rules cannot wake you: house/charter {"seat": {"dailyCap": 24}}.';
  return `You may wake up to ${seat.dailyCap} times a day${charter.quietHours ? `; quiet ${charter.quietHours.start}-${charter.quietHours.end} (wakes wait)` : ''}.`;
};

// pure — the rules as lines, with what each last did.
const listLines = (rules) => (rules.length ? rules.map((r) => `- ${ruleWords(r)}${r.done ? ' · DONE' : ''}${r.lastFiredAt ? ` · last fired ${r.lastFiredAt.slice(0, 16).replace('T', ' ')}: ${r.lastFired}` : ''}${r.held ? ` · its wake was held: ${r.held}` : ''}${r.waiting ? ` · waiting: ${r.waiting}` : ''}`) : ['- none: house posts from anyone in the house wake you, and so does your calendar']);

export const houseWakeIntent = Object.freeze({
  name: 'house/wake',
  policyTool: 'house.wake',
  fieldsForPrompt: '{add: {kind, ...}, label?, note?} | {remove: ruleId} | {list: true}',
  descriptionForPrompt: 'Set what wakes you, on your own. add one rule: '
    + '{kind: "time", at: "YYYY-MM-DDTHH:MM"} once (local time) · {kind: "time", daily: "HH:MM", days?: ["mon", ...]} · {kind: "time", everyMinutes: 15 or more} · '
    + '{kind: "price", token: a symbol Umbrae trades or a Base address, above or below: dollars} · {kind: "lp-value", above or below: dollars} (your LP wallet\'s worth) · '
    + '{kind: "new-pools", network?: "base", minLiquidityUsd?: 25000} · {kind: "posts", from: "anyone" | "nobody" | [housemates\' lane ids]} (who may wake you with a house post; anyone by default). '
    + 'Give a rule a label and a note: the note is read back to you when it fires (what to do then). A price or worth rule fires when it crosses into its level, not every look while it stays there. '
    + '{remove: id} drops one; {list: true} shows them, what each last did, and whether you can wake at all (you must be seated in the house charter). Up to 16 rules.',
  availableFor: async ({ connection }) => ((await ownLane(connection)) ? {} : null),
  validate: async (payload, { connection }) => {
    const laneId = await ownLane(connection);
    if (!laneId) return { ok: false, status: 'denied', reason: 'Only a member of this house sets its own wake rules.' };
    if (payload?.list === true) return { ok: true, value: { laneId, wallet: connection.walletAddress, list: true } };
    if (typeof payload?.remove === 'string' && payload.remove.trim()) return { ok: true, value: { laneId, wallet: connection.walletAddress, remove: payload.remove.trim() } };
    const add = payload?.add && typeof payload.add === 'object' ? { label: payload.label, note: payload.note, ...payload.add } : null;
    if (!add) return { ok: false, status: 'invalid', reason: 'house/wake needs {add: {kind, ...}}, {remove: id} or {list: true}' };
    try {
      normalizeRule(add, { now: Date.now() });
    } catch (err) {
      return { ok: false, status: 'invalid', reason: `house/wake: ${err.message}` };
    }
    return { ok: true, value: { laneId, wallet: connection.walletAddress, add } };
  },
  summarize: (p) => (p?.list ? 'list my wake rules' : p?.remove ? `remove wake rule ${p.remove}` : `add a ${p?.add?.kind ?? '?'} wake rule`),
  // impure — writes (or reads) the member's own rules.
  execute: async ({ laneId, wallet, list, remove, add }) => {
    if (list) {
      const { rules } = await readWakeRules(laneId);
      return { ok: true, detail: [`YOUR WAKE RULES (${rules.length} of 16):`, ...listLines(rules), await standingLine(wallet, laneId)].join('\n') };
    }
    const out = await changeWakeRules(laneId, remove ? { remove } : { add });
    if (!out.ok) return { ok: false, reason: `house/wake: ${out.reason}` };
    return {
      ok: true,
      detail: `${remove ? `Rule ${remove} removed.` : `Rule set: ${ruleWords(out.rule)}.`} You hold ${out.rules.length} rule(s). ${await standingLine(wallet, laneId)}`,
    };
  },
});
