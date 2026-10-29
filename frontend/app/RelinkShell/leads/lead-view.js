// lead-view.js — the house lead ledger read as LEADS shows it
// (show-dont-tell-audit.md finding 5): the funnel's stages and how many stand
// in each, the press that narrows the list to one stage, a lead's holder by
// the member's NAME (never a lane code), its last touch, the ⋯ menu's
// choices, and — only where the house's CMO can honestly act on it — the
// hand-over that drafts the ask in the CMO's chat.
//
// THE HAND-OVER IS HONEST (design language § SHOW, DON'T TELL 5): the seated
// CMO reads the ledger with `lead_list` (a read every bound being holds) and
// moves a lead with the `leads/touch` intent — status, a note, and
// `ownerNeumaId` to take it (portal-tools/crew-desk-tools.js,
// intents/lead-acts.js); every filing asks the operator as intents do. No new
// power: the prompt names exactly those acts.
//
// THIS HOUSE ONLY: names come from this house's roster; a lane it does not
// list reads '—', its id on hover.
//
// Every function here is pure.

/** The funnel's stages, first sighting to the end (the ledger's own LEAD_STATUSES order). */
export const LEAD_STAGES = Object.freeze(['cold', 'contacted', 'replied', 'qualified', 'won', 'lost']);

/** Lanes that are not a platform: they carry no platform mark. */
const NOT_A_PLATFORM = new Set(['email', 'other', '', null, undefined]);

/**
 * The stages in the ledger's order (the board's own list where it gave one), each with its count.
 * @param {ReadonlyArray<{status: string}>} leads
 * @param {ReadonlyArray<string>} [statuses]
 * @returns {Array<{stage: string, count: number}>}
 */
export const funnelOf = (leads, statuses = LEAD_STAGES) => {
  const order = statuses?.length ? statuses : LEAD_STAGES;
  const extra = [...new Set((leads || []).map((l) => l.status).filter((s) => s && !order.includes(s)))];
  return [...order, ...extra].map((stage) => ({ stage, count: (leads || []).filter((l) => l.status === stage).length }));
};

/** The leads standing at `stage`, or every lead while nothing narrows them. */
export const leadsAt = (leads, stage) => (stage ? (leads || []).filter((l) => l.status === stage) : [...(leads || [])]);

/** A stage's place in the funnel, 0..1 (lost stands apart: null). */
export const stageShare = (stage) => {
  if (stage === 'lost') return null;
  const i = LEAD_STAGES.indexOf(stage);
  return i < 0 ? null : i / (LEAD_STAGES.indexOf('won'));
};

/** The platform a lead surfaced on, when it is one (email and other are not). */
export const platformOf = (lead) => (NOT_A_PLATFORM.has(lead?.channelId) ? null : lead.channelId);

/**
 * Who holds a lead, by name.
 * @param {{ownerNeumaId?: ?string}} lead
 * @param {ReadonlyArray<{neumaId: string, name?: string}>} roster - this house's members
 * @returns {?{name: string, title: string}} null while no one holds it
 */
export const holderOf = (lead, roster) => {
  if (!lead?.ownerNeumaId) return null;
  const name = (roster || []).find((m) => m.neumaId === lead.ownerNeumaId)?.name || null;
  return { name: name || '—', title: name ? `held by ${name}` : `held by a lane this house does not list (${lead.ownerNeumaId})` };
};

/** The lead's last touch: when, and the last note it carries. */
export const lastTouchOf = (lead) => {
  const touches = Array.isArray(lead?.touches) ? lead.touches : [];
  return { at: touches.at(-1)?.at || lead?.createdAt || null, note: [...touches].reverse().find((t) => t.note)?.note || null };
};

/**
 * The row's ⋯ menu: move it to a stage (its own checked), a note, removal.
 * @param {ReadonlyArray<string>} stages
 * @param {string} current
 */
export const leadMenuItems = (stages, current) => Object.freeze([
  ...stages.map((s) => ({ kind: 'item', id: `stage:${s}`, label: s.toUpperCase(), checked: s === current })),
  { kind: 'separator' },
  { kind: 'item', id: 'note', label: 'ADD A NOTE…' },
  { kind: 'item', id: 'remove', label: 'REMOVE…', danger: true },
]);

/**
 * HAND TO CMO for a lead no one holds: the seated CMO of this house, the ask
 * drafted. Null when the lead is held, no one holds the seat, or the seat's
 * lane is not this house's own member (never a witness).
 * @param {{id: string, name?: string, contact?: string, status: string, channelId?: string, ownerNeumaId?: ?string}} lead
 * @param {?{laneId: string}} cmo - the house's CMO seat (use-cmo-seat.js)
 * @param {ReadonlyArray<{neumaId: string, name?: string, participantKind?: string}>} roster
 * @returns {?{neumaId: string, name: string, prompt: string}}
 */
export const leadHandTo = (lead, cmo, roster) => {
  if (!lead || lead.ownerNeumaId || !cmo?.laneId) return null;
  const member = (roster || []).find((m) => m.neumaId === cmo.laneId && m.participantKind !== 'witness');
  if (!member) return null;
  const id = String(lead.id).slice(0, 8);
  const who = lead.name || lead.contact || id;
  const where = platformOf(lead) ? `, from ${lead.channelId}` : '';
  return {
    neumaId: member.neumaId,
    name: member.name || member.neumaId,
    prompt: [
      `Take the lead ${who} [${id}] (${lead.status}${where}) — no one holds it yet.`,
      `Read it with lead_list, then file leads/touch with id ${id} and ownerNeumaId "${member.neumaId}" to hold it, and work it from there;`,
      'each move is its own leads/touch, with a note of what happened. Record only what you actually saw.',
    ].join(' '),
  };
};
