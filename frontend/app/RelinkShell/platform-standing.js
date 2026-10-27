// platform-standing.js — a platform's standing read as three facts: can it
// speak (KEYS), who speaks for it (HOLDER), who works it (CREW).
//
// THE HOLDER FOLLOWS THE SEAT (Design note, 2026-10-23: […] So a channel's holder is the house's
// marketing seat by default, and the only beings ever offered as its holder
// are the ones the house model already seats in marketing:
//
//   1. the house's seated CMO (marketing/cmo-designation.js — one per house),
//   2. a member whose on-chain founding seat is the CMO function (Legatus;
//      the label law lets a house word the seat its own way, so the
//      position "CMO" and the seat's full name match too),
//   3. the members the operator seated on THIS platform's crew
//      (sector-crew.js — the sector's marketing team).
//
// No other house member is offered. MARKETING is not COMMUNICATIONS
// (docs/governance/house-roles.md): the Praeco is not offered.
//
// HOUSES NEVER CONFUSED: every input is one house's own read (its roster, its
// CMO record, its crew). A lane named by the CMO record or the crew that is
// not in THIS house's roster is never offered and never bound — fail closed;
// the binding route re-checks ownership on every bind.
//
// pure — records in, standing out.

import { TITLE_LEGEND } from './founding-titles.js';

const CMO_SEAT = TITLE_LEGEND.find((t) => t.position === 'CMO');

/** pure — does this founding-seat label name the CMO function? */
export const isMarketingTitle = (title) => {
  if (typeof title !== 'string' || !title.trim()) return false;
  const word = title.trim().toLowerCase();
  return [CMO_SEAT.title, CMO_SEAT.position, CMO_SEAT.seat].some((w) => w.toLowerCase() === word);
};

const nameOf = (m) => m?.name || m?.neumaId;

/**
 * pure — the beings this house may hand a platform to, the seated CMO first,
 * each with the seat that makes it eligible ('CMO' | its founding title | 'CREW').
 * @param {{roster: Array<{neumaId: string, name?: string, title?: string, participantKind?: string}>,
 *   cmoLaneId: ?string, crew: Array<{neumaId: string}>}} house - ONE house's records
 * @returns {Array<{neumaId: string, name: string, seat: string, witness: boolean}>}
 */
export const holderCandidates = ({ roster, cmoLaneId, crew }) => {
  const members = Array.isArray(roster) ? roster : [];
  const out = [];
  const offer = (m, seat) => {
    if (m && !out.some((o) => o.neumaId === m.neumaId)) {
      out.push({ neumaId: m.neumaId, name: nameOf(m), seat, witness: m.participantKind === 'witness' });
    }
  };
  offer(members.find((m) => cmoLaneId && m.neumaId === cmoLaneId), 'CMO');
  for (const m of members) if (isMarketingTitle(m.title)) offer(m, m.title.trim().toUpperCase());
  const crewIds = new Set((Array.isArray(crew) ? crew : []).map((c) => c?.neumaId));
  for (const m of members) if (crewIds.has(m.neumaId)) offer(m, 'CREW');
  return out;
};

/**
 * pure — the KEYS fact: 'unset' | 'failing' | 'proven' | 'set', and the
 * account a flight test proved (null when unproven, never invented).
 * @param {{configured: boolean}} channel
 * @param {?{ok: boolean, account?: {name?: string}}} test
 */
export const keysStanding = (channel, test) => {
  const account = test?.ok === true && test.account?.name ? `@${test.account.name}` : null;
  if (!channel?.configured) return { state: 'unset', account: null, blocked: true };
  if (test?.ok === false) return { state: 'failing', account: null, blocked: true };
  return { state: test?.ok === true ? 'proven' : 'set', account, blocked: false };
};

/**
 * pure — the HOLDER fact and what the window should do about it.
 *   held          — a binding stands (holder named, with its seat)
 *   auto          — keys set, no holder, a CMO seated: bind the CMO (autoBind)
 *   awaiting-keys — a CMO seated, no keys yet: the CMO takes it once they are set
 *   released      — the operator released it here; the CMO waits for their word
 *   no-seat       — no holder and no CMO: […]
 * blocked = no one may post because no one holds it (keys aside).
 * @param {{channel: {configured: boolean, binding: ?{neumaId: string}},
 *   roster: Array<object>, cmoLaneId: ?string, crew: Array<object>, released: boolean}} input
 */
export const holderStanding = ({ channel, roster, cmoLaneId, crew, released }) => {
  const offered = holderCandidates({ roster, cmoLaneId, crew });
  const cmo = offered.find((c) => c.seat === 'CMO') ?? null;
  const boundId = channel?.binding?.neumaId ?? null;
  if (boundId) {
    const member = (Array.isArray(roster) ? roster : []).find((m) => m.neumaId === boundId);
    const seated = offered.find((c) => c.neumaId === boundId);
    const holder = seated ?? {
      neumaId: boundId, name: nameOf(member) ?? boundId, seat: null, witness: member?.participantKind === 'witness',
    };
    return { state: 'held', holder, cmo, offered, autoBind: null, blocked: false };
  }
  if (!cmo) return { state: 'no-seat', holder: null, cmo: null, offered, autoBind: null, blocked: true };
  if (released) return { state: 'released', holder: null, cmo, offered, autoBind: null, blocked: true };
  if (!channel?.configured) return { state: 'awaiting-keys', holder: null, cmo, offered, autoBind: null, blocked: false };
  return { state: 'auto', holder: null, cmo, offered, autoBind: cmo.neumaId, blocked: true };
};
