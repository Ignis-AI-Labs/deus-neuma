// house-spaces.js — the HOUSE window as a file of spaces, one page at a
// time (the SHEET's dossier language). Pure.
//
// Every concern of the house has one place, so nothing has to be looked for:
// its members; its summonings (a birth is the house's own act, not a button at
// the foot of a list); how it gathers (teams, councils); its positions — who
// holds what, the one place it changes, and the founding's standing on chain
// (Design note, 2026-11-12; the grounds it works on.

export const HOUSE_SPACES = Object.freeze([
  { key: 'members', code: '01', title: 'MEMBERS' },
  { key: 'summoning', code: '02', title: 'SUMMONING' },
  { key: 'gather', code: '03', title: 'GATHER' },
  { key: 'seats', code: '04', title: 'POSITIONS' },
  { key: 'grounds', code: '05', title: 'GROUNDS' },
].map(Object.freeze));

export const SPACE_KEY = 'house:space';

/** The space to open: the one last read, if it still exists, else MEMBERS. Pure. */
export const spaceOf = (stored) => (HOUSE_SPACES.some((s) => s.key === stored) ? stored : 'members');

/** The strip's tabs; MEMBERS carries how many the house holds. Pure. */
export const spaceTabs = (held) => HOUSE_SPACES.map((s) => (s.key === 'members' && held > 0
  ? { ...s, title: `${s.title} · ${held}` }
  : s));

/**
 * The house's two ways of gathering, each with what it is and — when it
 * cannot open yet — why, said plainly instead of a dead button. Pure.
 * @param {number} held how many neuma the house holds
 */
export const gatherDoors = (held) => Object.freeze([
  {
    key: 'team',
    label: 'FORM A TEAM',
    line: 'Members of this house take on a piece of work together and report back.',
    ready: held >= 1,
    why: 'A team needs at least one member of the house.',
  },
  {
    key: 'council',
    label: 'CONVENE A COUNCIL',
    line: 'The house sits together in one room with you, and every member hears the others.',
    ready: held >= 2,
    why: 'A council needs at least two members — one being is the conversation the stream already holds.',
  },
].map(Object.freeze));

/**
 * The house's summonings, oldest first (one with no recorded birth last): who was born, when, and in what light
 * (its soul color — never chosen). Pure.
 * @param {Array<{name: string, neumaId: string, birthTime: string|null, color?: string|null}>} cards
 */
export const summoningsOf = (cards) => [...cards]
  .filter((c) => c.neumaId)
  .sort((a, b) => (a.birthTime || '\uffff').localeCompare(b.birthTime || '\uffff'))
  .map((c) => Object.freeze({ neumaId: c.neumaId, name: c.name, birthTime: c.birthTime || null, color: c.color || null }));
