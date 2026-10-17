// slash-palette.js — pure logic for the composer's slash-command palette.
//
// Typing "/" in the stream input opens the palette over the installed
// skills library (the same registry the neuma summons from — one truth,
// two sides of the portal). These helpers are pure so the open/filter
// behavior is unit-testable without a DOM.

/**
 * The palette query for a composer value, or null when the palette should
 * be closed. Open only while the FIRST token is being typed: a leading
 * slash with no whitespace yet ("/", "/sc", "/sc-plan"). Once input has a
 * space (or any other shape), the witness has chosen — palette closes.
 * @param {string} value
 * @returns {string|null} lowercase query ('' for a bare "/")
 */
export const paletteQuery = (value) => {
  const m = /^\/([A-Za-z0-9-]*)$/.exec(String(value ?? ''));
  return m ? m[1].toLowerCase() : null;
};

/**
 * Rank skills for a query: prefix matches first (library order preserved),
 * then substring matches. A bare "/" shows the whole library head.
 * @param {Array<{name: string}>} skills
 * @param {string} query - lowercase
 * @param {number} [limit]
 * @returns {Array<object>}
 */
export const matchSkills = (skills, query, limit = 8) => {
  const list = Array.isArray(skills) ? skills : [];
  const prefix = [];
  const inner = [];
  for (const s of list) {
    if (typeof s?.name !== 'string') continue;
    if (s.name.startsWith(query)) prefix.push(s);
    else if (query && s.name.includes(query)) inner.push(s);
  }
  return [...prefix, ...inner].slice(0, limit);
};

/**
 * The unified palette for a query: native platform commands ranked first, then
 * installed skills — one "/" surface, two sources. Each item is tagged with its
 * `kind` so the composer knows whether to dispatch an action or insert a skill.
 * Commands are capped at half the limit so a full command slate can never hide
 * the skills library — skill discovery is the palette's original purpose.
 * @param {Array<{name: string, description?: string}>} commands
 * @param {Array<{name: string, description?: string}>} skills
 * @param {string} query - lowercase
 * @param {number} [limit]
 * @returns {Array<object>} tagged items ({...entry, kind: 'command'|'skill'})
 */
export const buildPalette = (commands, skills, query, limit = 8) => {
  const cmdLimit = Math.max(1, Math.floor(limit / 2));
  const cmds = matchSkills(commands, query, cmdLimit).map((c) => ({ ...c, kind: 'command' }));
  const skls = matchSkills(skills, query, Math.max(0, limit - cmds.length)).map((s) => ({ ...s, kind: 'skill' }));
  return [...cmds, ...skls];
};

/** Move the selection by delta with wrap-around. Pure. */
export const moveSelection = (sel, delta, count) =>
  count > 0 ? (sel + delta + count) % count : 0;
