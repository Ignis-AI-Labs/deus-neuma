// standing-marks.js — an account's standing as three marks (show-dont-tell
// audit, finding 11): can it speak (KEYS), who speaks as it (HOLDER), who
// works its platform (CREW). Each is a level the LevelMark draws — ok, warm
// (set, not yet proven), fault (posting is blocked by it), unknown (not read
// yet) — named on hover, and, where it is not fine, the door to its fix:
// the keys → that account's Channel keys row; no holder and no CMO → SEAT A
// CMO; no holder → the holder picker, in place. A refusal's own reason stays
// on screen beside its mark (LESS TEXT 4).
//
// THIS HOUSE ONLY: the holder is this account's own binding, named from this
// house's roster — a lane the roster does not hold shows as '—', its id on
// hover, never a guessed name.
//
// Every function here is pure.

import { keysStanding } from '../platform-standing.js';

/** SEAT A CMO: MARKETING's SEAT, the CMO row marked (doors/door-plan.js). */
export const SEAT_DOOR = Object.freeze({ kind: 'marketing', tab: 'seat', reveal: '[data-cmo-row]' });

const KEYS_WORD = Object.freeze({ unset: 'not set', failing: 'refused', set: 'set, not yet proven live', proven: 'proven' });

/**
 * @param {?{configured: boolean, id: string, name: string}} channel
 * @param {?{ok: boolean, detail?: string, account?: {name?: string}}} test - the platform's flight test
 * @param {?string} accountId
 * @returns {{fact: 'keys', level: string, title: string, reason: ?string, door: ?{door: object, label: string}}}
 */
export const keysMark = (channel, test, accountId) => {
  if (!channel) return { fact: 'keys', level: 'unknown', title: 'KEYS · not read yet', reason: null, door: null };
  const k = keysStanding(channel, test);
  const level = k.blocked ? 'fault' : k.state === 'proven' ? 'ok' : 'warm';
  const reason = k.state === 'failing' ? (test?.detail || 'the platform refused the keys') : null;
  return {
    fact: 'keys', level, reason,
    title: `KEYS · ${KEYS_WORD[k.state]}${k.account ? ` as ${k.account}` : ''}`,
    door: k.blocked ? { door: { kind: 'keys', channelId: channel.id, accountId: accountId || null }, label: k.state === 'unset' ? 'SET KEYS' : 'FIX KEYS' } : null,
  };
};

/**
 * This account's holder: the member its own binding names.
 * @param {{account: ?{id: string, binding?: ?{neumaId: string}}|undefined,
 *   roster: ReadonlyArray<{neumaId: string, name?: string}>, cmo: ?{neumaId: string, name?: string}, read: boolean,
 *   awaitingKeys?: boolean}} input
 *   account — undefined while the house's accounts are unread, null when it holds none here;
 *   cmo — the house's seated CMO (null: no one holds the seat); read — the house's standing has answered;
 *   awaitingKeys — the platform's first account, no keys yet: the CMO takes it once they are set (platform-standing.js)
 * @returns {{fact: 'holder', level: string, name: ?string, title: string, door: ?{seat: boolean, label: string}}}
 */
export const holderMark = ({ account, roster, cmo, read, awaitingKeys = false }) => {
  if (account === undefined) return { fact: 'holder', level: 'unknown', name: null, title: 'HOLDER · reading the house', door: null };
  const boundId = account?.binding?.neumaId || null;
  if (boundId) {
    const member = (roster || []).find((m) => m.neumaId === boundId);
    const name = member?.name || null;
    return { fact: 'holder', level: 'ok', name: name || '—', title: `HOLDER · ${name || `a lane this house does not list (${boundId})`} — speaks as this account`, door: null };
  }
  if (!read) return { fact: 'holder', level: 'unknown', name: null, title: 'HOLDER · reading the house', door: null };
  // No account here yet: only what the house's seat will do once its keys open the first one.
  if (!account && (!cmo || !awaitingKeys)) {
    return cmo ? { fact: 'holder', level: 'unknown', name: null, title: 'HOLDER · no account here yet', door: null }
      : { fact: 'holder', level: 'fault', name: null, title: 'HOLDER · no account here yet, and no one holds the marketing seat', door: { seat: true, label: 'SEAT A CMO' } };
  }
  if (!cmo) {
    return { fact: 'holder', level: 'fault', name: null, title: 'HOLDER · none — no being may post; no one holds the marketing seat yet', door: { seat: true, label: 'SEAT A CMO' } };
  }
  // Nothing to do here but the keys: the window binds the CMO the moment they are set.
  if (awaitingKeys) return { fact: 'holder', level: 'warm', name: null, title: `HOLDER · ${cmo.name || cmo.neumaId} (CMO) holds it once the keys are set`, door: null };
  return { fact: 'holder', level: 'fault', name: null, title: `HOLDER · none — no being may post (the CMO is ${cmo.name || cmo.neumaId})`, door: { seat: false, label: 'HOLDER' } };
};

/**
 * The platform's crew: how many work it, named on hover; it stands for every account of the platform.
 * @param {ReadonlyArray<{neumaId: string}>} crew
 * @param {ReadonlyArray<{neumaId: string, name?: string}>} roster
 * @param {string} channelName
 * @returns {{fact: 'crew', level: string, count: number, title: string}}
 */
export const crewMark = (crew, roster, channelName) => {
  const names = (crew || []).map((m) => (roster || []).find((r) => r.neumaId === m.neumaId)?.name || m.neumaId);
  return {
    fact: 'crew', level: 'ok', count: names.length,
    title: `CREW · ${names.length ? names.join(' · ') : 'no one'} — the ${channelName} crew works every ${channelName} account`,
  };
};
