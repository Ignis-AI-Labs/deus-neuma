// position-seating — the seating a house's members decide together, kept for the operator to apply.
//
// Design note, 2026-11-15: […]
//
// Seating by hand is the POSITIONS window's SEAT, one position at a time. Seating by council is this:
// the members sit together, decide who holds what, and one of them files the result (house/seating).
// It seats nobody. The operator reads it on POSITIONS and applies it, and each seat then goes through
// its own office's route, where that seat's rules stand. One record per house, the latest filing:
// `<realm>/<wallet>/house-seating.json`. impure (fs) except where marked pure.
import fsp from 'node:fs/promises';
import path from 'node:path';
import { housePositionFile } from '../social/house-positions.js';
import { POSITIONS } from './position-map.js';

const FILE = 'house-seating.json';
const WHY_MAX = 1200;

// pure — a position by its seat (Chief of Staff), its short form (COS), its title (Optio) or its
// function word (MANAGEMENT), any case
const positionNamed = (raw) => {
  const k = String(raw ?? '').trim().toLowerCase();
  return POSITIONS.find((p) => [p.office, p.seat, p.acronym, p.title, p.plain].some((n) => String(n).toLowerCase() === k)) ?? null;
};

/**
 * The seating as filed, judged against the house's members. Pure.
 * @param {{seats?: Record<string, string>, why?: string}} payload seats: position (office, plain name or
 *   title) → member (lane id or name)
 * @param {Array<{laneId: string, name: string}>} members the house's members
 * @returns {{ok: true, value: {seats: Array<{office: string, plain: string, title: string, laneId: string, name: string}>, why: string}}
 *   | {ok: false, reason: string}}
 */
export const seatingFields = (payload, members) => {
  const raw = payload?.seats;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).length === 0) {
    return { ok: false, reason: 'seats maps each position to the member who holds it, e.g. {"SALES": "Rowan"}' };
  }
  const memberOf = (who) => {
    const k = String(who ?? '').trim().toLowerCase();
    const byLane = members.find((m) => m.laneId.toLowerCase() === k);
    if (byLane) return { member: byLane };
    const named = members.filter((m) => String(m.name).toLowerCase() === k);
    return named.length === 1 ? { member: named[0] } : { ambiguous: named.length > 1 };
  };
  const seats = [];
  for (const [where, who] of Object.entries(raw)) {
    const position = positionNamed(where);
    if (!position) return { ok: false, reason: `no position is called "${where}" — the positions are ${POSITIONS.map((p) => `${p.seat} (${p.acronym})`).join(', ')}` };
    if (seats.some((s) => s.office === position.office)) return { ok: false, reason: `the ${position.seat} is named twice` };
    const found = memberOf(who);
    if (found.ambiguous) return { ok: false, reason: `"${who}" names more than one member — file its lane id instead` };
    if (!found.member) return { ok: false, reason: `"${who}" is not a member of this house — its members are ${members.map((m) => m.name).join(', ')}` };
    const { member } = found;
    if (seats.some((s) => s.laneId === member.laneId)) return { ok: false, reason: `${member.name} is given two positions: one member holds one position` };
    seats.push({ office: position.office, seat: position.seat, acronym: position.acronym, title: position.title, plain: position.plain, laneId: member.laneId, name: member.name });
  }
  const why = String(payload?.why ?? '').trim();
  if (!why) return { ok: false, reason: 'why says, in a few lines, how the house decided' };
  // in the positions' own order, whatever order they were filed in
  seats.sort((a, b) => POSITIONS.findIndex((p) => p.office === a.office) - POSITIONS.findIndex((p) => p.office === b.office));
  return { ok: true, value: { seats, why: why.slice(0, WHY_MAX) } };
};

/** The house's filed seating, or null. impure */
export const readSeating = async (wallet) => {
  try { return JSON.parse(await fsp.readFile(housePositionFile(wallet, FILE), 'utf8')); } catch { return null; }
};

/** Keep a filed seating whole (tmp + rename), replacing any before it. impure */
export const writeSeating = async (wallet, record) => {
  const file = housePositionFile(wallet, FILE);
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(record, null, 2), { mode: 0o600 });
  await fsp.rename(tmp, file);
  return record;
};

/** The operator applied or set the seating aside: it leaves the board. impure */
export const clearSeating = async (wallet) => {
  await fsp.rm(housePositionFile(wallet, FILE), { force: true });
};
