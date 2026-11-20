// positions-view.js — how the POSITIONS window reads. Pure.
//
// One row per position on the left (the seat first — CHIEF OF STAFF — then its short form and
// title, COS · OPTIO, who holds it, how many decisions wait); the chosen position's hub on
// the right. SHINKEI: every count is the length of the list it opens.

import { STAGES, MORE, isPipelineTab } from '../company-line/sales-pipeline-view.js';

// The sales position's hub is its pipeline (company-line/SalesPipeline.jsx): its stages in order, then what is not a stage.
const pipelineTabs = () => [...STAGES, ...MORE].map((s) => ({ id: s.id, label: s.label }));

/** The tabs of one position's hub: its functions, then SETTINGS (what it may be switched on or off to use) when it has any, then THEIR EYES. */
export const hubTabs = (position) => (position.office === 'cro' ? pipelineTabs() : [
  // SETUP leads while a needed step is open; once all are done it stays, last, for the optional ones.
  ...(position.setup && position.setup.done < position.setup.total ? [{ id: '_setup', label: `SETUP · ${position.setup.done}/${position.setup.total}` }] : []),
  ...position.functions.map((f) => ({ id: f.id, label: f.label })),
  ...(position.connections.length ? [{ id: '_switches', label: `SETTINGS · ${position.connections.filter((c) => c.on).length}/${position.connections.length}` }] : []),
  { id: '_eyes', label: 'THEIR EYES' },
  ...(position.setup && position.setup.done >= position.setup.total ? [{ id: '_setup', label: 'SETUP · DONE' }] : []),
]);

/** One setup step's line: who does it, and whether it is done. */
export const stepWords = (s) => `${s.done ? 'DONE' : s.optional ? 'OPTIONAL' : s.who === 'operator' ? 'YOURS' : 'THE SEAT\'S'} — ${s.label}`;

/** The rail row of one position. */
export const railRow = (position) => ({
  office: position.office,
  seat: position.seat,
  acronym: position.acronym,
  plain: position.plain,
  title: position.title,
  holder: position.holder?.name ?? null,
  waiting: position.waiting.length,
  off: position.connections.filter((c) => !c.on).length,
  // How many needed setup steps are still open (0: fully set up, or not measured).
  setupOpen: position.setup ? position.setup.total - position.setup.done : 0,
  setup: position.setup ? `${position.setup.done}/${position.setup.total}` : null,
});

/** What the rail says under the house: how many positions are held and how many decisions wait in all. */
export const railSummary = (positions) => {
  const held = positions.filter((p) => p.holder).length;
  const waiting = positions.reduce((n, p) => n + p.waiting.length, 0);
  return `${held}/${positions.length} HELD · ${waiting} WAITING ON YOU`;
};

/** The position to show: the one asked for, else the first with something waiting, else the first. */
export const pickPosition = (positions, office) =>
  positions.find((p) => p.office === office) ?? positions.find((p) => p.waiting.length) ?? positions[0] ?? null;

/** The tab to show inside a hub: the one asked for when the hub has it, else its first function. */
// The sales hub opens on SETUP while it is not done, then on DISCOVER; an older SETUP door lands on its stage.
const salesTab = (position, tab) => {
  const asked = tab === '_setup' ? 'setup' : tab;
  if (isPipelineTab(asked)) return asked;
  return position.setup && position.setup.done < position.setup.total ? 'setup' : 'discover';
};
export const pickTab = (position, tab) => {
  if (position.office === 'cro') return salesTab(position, tab);
  return hubTabs(position).some((t) => t.id === tab) ? tab : hubTabs(position)[0].id;
};

/** The members a seat may be given to, as select options; the holder is left out. */
export const seatOptions = (members, position) =>
  members.filter((m) => m.laneId !== position.holder?.laneId).map((m) => ({ value: m.laneId, label: m.name }));

/** What the operator asks the seat's holder when they want to be walked through one of their own steps. */
export const helpAsk = (s) => `Walk me through this setup step for your position, one action at a time, and tell me what you need from me to finish it: ${s.label}. ${s.how}`;

/**
 * A house title and the seat it names (Design note, 2026-11-16: one function, one place — a title that names a
 * company position and the seat of that position are the same office, said twice). For a member whose
 * title is a position's own (Mercator, CMO, …): that position, whether this member holds its seat, and
 * who does. null when the title names no position.
 * @param {{neumaId: string, title: ?string}} member
 * @param {object[]} positions - the board's positions
 * @returns {?{office: string, plain: string, held: boolean, holder: ?string, words: string}}
 */
export const titleSeat = (member, positions) => {
  // A house title names its seat by the title word (Optio), the short form (COS) or the seat itself.
  const named = String(member?.title ?? '').trim().toLowerCase();
  const position = (positions ?? []).find((p) => named && [p.title, p.acronym, p.seat].some((n) => String(n ?? '').toLowerCase() === named));
  if (!position) return null;
  const held = position.holder?.laneId === member.neumaId;
  return {
    office: position.office, plain: position.seat, held, holder: position.holder?.name ?? null,
    words: held ? `HOLDS THE ${position.seat} SEAT` : `TITLE ONLY — THE ${position.seat} SEAT IS ${position.holder ? `HELD BY ${String(position.holder.name).toUpperCase()}` : 'EMPTY'}`,
  };
};

/** Does this seat work this stage of the sale? */
export const stageIsMine = (stage, office) => (stage?.seats ?? []).includes(office);

/** The sale's line on one position's hub: how many stages, and which this seat works. */
export const saleLine = (sale, office) => {
  const mine = (sale?.stages ?? []).filter((s) => stageIsMine(s, office)).map((s) => s.n);
  return [`${sale.stages.length} STAGES`, mine.length ? { text: `THIS SEAT WORKS ${mine.join(', ')}`, tone: 'on' } : 'THIS SEAT GUARDS EVERY STAGE'];
};

/** Is the limit the operator typed a whole number the house accepts? */
export const capOk = (text) => /^\d{1,6}$/.test(String(text).trim());
