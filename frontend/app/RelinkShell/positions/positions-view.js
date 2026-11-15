// positions-view.js — how the POSITIONS window reads. Pure.
//
// One row per position on the left (the plain function first, the title
// second, who holds it, how many decisions wait); the chosen position's hub on
// the right. SHINKEI: every count is the length of the list it opens.

/** The tabs of one position's hub: its functions, then SWITCHES when it has any, then THEIR EYES. */
export const hubTabs = (position) => [
  // SETUP leads while a needed step is open; once all are done it stays, last, for the optional ones.
  ...(position.setup && position.setup.done < position.setup.total ? [{ id: '_setup', label: `SETUP · ${position.setup.done}/${position.setup.total}` }] : []),
  ...position.functions.map((f) => ({ id: f.id, label: f.label })),
  ...(position.connections.length ? [{ id: '_switches', label: `SWITCHES · ${position.connections.filter((c) => c.on).length}/${position.connections.length}` }] : []),
  { id: '_eyes', label: 'THEIR EYES' },
  ...(position.setup && position.setup.done >= position.setup.total ? [{ id: '_setup', label: 'SETUP · DONE' }] : []),
];

/** One setup step's line: who does it, and whether it is done. */
export const stepWords = (s) => `${s.done ? 'DONE' : s.optional ? 'OPTIONAL' : s.who === 'operator' ? 'YOURS' : 'THE SEAT\'S'} — ${s.label}`;

/** The rail row of one position. */
export const railRow = (position) => ({
  office: position.office,
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
export const pickTab = (position, tab) => (hubTabs(position).some((t) => t.id === tab) ? tab : hubTabs(position)[0].id);

/** The members a seat may be given to, as select options; the holder is left out. */
export const seatOptions = (members, position) =>
  members.filter((m) => m.laneId !== position.holder?.laneId).map((m) => ({ value: m.laneId, label: m.name }));

/** What the operator asks the seat's holder when they want to be walked through one of their own steps. */
export const helpAsk = (s) => `Walk me through this setup step for your position, one action at a time, and tell me what you need from me to finish it: ${s.label}. ${s.how}`;
