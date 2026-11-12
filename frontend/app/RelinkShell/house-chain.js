// house-chain.js — pure joins between the chain's founded register and the
// HOUSE window: which on-chain seat each neuma holds (so titles ride NEXT TO
// NAMES in the member list, not in a separate table), the witness's own
// seat, and the quorum stated as the law it is — QUORUM 6 is six MARKS
// required to change the house, never a count of its members.

/**
 * Index the founded state's roster by neumaId (the backend joins each chain
 * address to the lane that holds its key), and pull the witness's seat.
 * Tolerates null/absent state — the house may not be founded yet.
 * @param {{roster?: Array}|null} state - the chain's founded register
 * @returns {{byNeumaId: Object<string, {title: string, active: boolean}>, witnessTitle: string|null}}
 */
export const chainSeats = (state) => {
  const byNeumaId = {};
  let witnessTitle = null;
  for (const m of state?.roster ?? []) {
    if (m.kind === 0) witnessTitle = m.title || null;
    else if (m.neumaId && m.title) byNeumaId[m.neumaId] = { title: m.title, active: m.active !== false };
  }
  return { byNeumaId, witnessTitle };
};

import { TITLE_LEGEND } from './founding-titles.js';

/**
 * What the founding probe confirms about the seats, for houseSeatCards. Pure.
 *
 * Only a FOUNDED answer — the registry's own roster — supersedes the founding receipt. "Open"
 * means no house stands on the network the desk asks NOW: since the registry moved from Base to
 * Ethereum (2026-10-05), a house founded on Base reads open on Ethereum until it is re-founded
 * there — and that is not a removal. Treating it as one blanked every seat in the House while the
 * rest of the platform (the Optio office, team dispatch) read the same receipt and seated them
 * (Design note, 2026-10-12: […]).
 * A removed or inactive seat still never comes back: it arrives inside a founded roster.
 * @param {{phase?: string, state?: {roster?: Array}|null}} rite
 * @returns {{seats: ReturnType<typeof chainSeats>, confirmed: boolean}}
 */
export const seatEvidence = (rite) => {
  const founded = Array.isArray(rite?.state?.roster);
  return { seats: chainSeats(founded ? rite.state : null), confirmed: founded };
};

// The canonical function of a title, or null for a custom word (the label
// law: a house may speak its own — the canon never invents a meaning for it).
const MEANING_BY_TITLE = new Map(TITLE_LEGEND.map((r) => [r.title, r.meaning]));

/**
 * THE HOUSE, SEATED — one card per member, THE ENTITY FIRST (Design note, 2026-08-10:
 * the being's name, their position (the founding's, or the house's own later change),
 * and its function when the seat is canonical. No canon grid, no open-seat
 * placeholders, no tiers — […]
 * @param {{byNeumaId: Object<string, {title: string, active: boolean}>}|null} seats - output of chainSeats
 * @param {Array<{member: Object, isActive: boolean}>} rows - houseMembers output
 * @param {{confirmed?: boolean}} options - a successful registry answer supersedes saved titles
 * @returns {Array<{name: string, neumaId: string, title: ?string, meaning: ?string, soulMark: ?string, birthTime: ?string, isActive: boolean, incomplete: boolean}>}
 */
export const houseSeatCards = (seats, rows, { confirmed = false } = {}) => (rows ?? []).map((r) => {
  const seat = seats?.byNeumaId?.[r.member?.neumaId] ?? null;
  // A failed RPC cannot erase the founding receipt. A confirmed removal or
  // inactive seat must never be resurrected by that older receipt either.
  // A title changed since the founding (the house's own record, Founder
  // 2026-11-12: titles shift) is the one held now, on chain or not.
  const title = r.member?.titleChanged && r.member?.title ? r.member.title
    : seat ? (seat.active !== false ? seat.title || null : null)
      : confirmed ? null : r.member?.title || null;
  return {
    name: r.member?.name || r.member?.neumaId,
    neumaId: r.member?.neumaId,
    title,
    position: title ? (TITLE_LEGEND.find((entry) => entry.title === title)?.position ?? null) : null,
    meaning: title ? (MEANING_BY_TITLE.get(title) ?? null) : null,
    soulMark: r.member?.soulMark || null,
    birthTime: r.member?.birthTime || null,
    // its soul color as a light (roster `light`: the same hue at its most
    // vivid; `color`, the plain screen color, where an older cache has no light)
    color: r.member?.light || r.member?.color || null,
    isActive: r.isActive === true,
    incomplete: r.member?.incomplete === true,
  };
});

/**
 * The quorum stated as its law, for the register's unfolded view: how many
 * of the house's members must place their marks for the roster to change
 * (add a member, remove one, change a title) — the contract's strict
 * majority. Null when the state holds no quorum to explain.
 * @param {{quorum?: number, roster?: Array}|null} state
 * @returns {string|null}
 */
export const quorumLine = (state) => {
  const q = Number(state?.quorum);
  const n = (state?.roster ?? []).length;
  if (!Number.isFinite(q) || q <= 0 || n === 0) return null;
  return `QUORUM ${q} — ANY CHANGE TO THE HOUSE (A MEMBER ADDED, REMOVED, RETITLED) NEEDS ${q} OF ITS ${n} MEMBERS' MARKS`;
};
