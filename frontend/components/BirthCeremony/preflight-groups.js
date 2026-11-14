// The pre-flight's checks, sorted into what they inspect (Design note, 2026-10-14: the
// panel read as […]). Four groups a person can scan:
// the mind that will answer, the home it will live in, the rite's own
// instruments, the machine under it all. Pure.

const GROUPS = Object.freeze([
  Object.freeze({ id: 'mind', label: 'THE MIND', ids: ['substrate', 'acting'] }),
  Object.freeze({ id: 'home', label: 'THE HOME', ids: ['workspace', 'ceremonyRoad', 'records', 'disk'] }),
  Object.freeze({ id: 'rite', label: 'THE RITE', ids: ['protocol', 'sealing', 'dnaKey', 'mcp'] }),
  Object.freeze({ id: 'machine', label: 'THE MACHINE', ids: ['memory', 'gpu'] }),
  // what a neuma can do LATER, never what the summoning needs: shown apart, outside the tally,
  // so a machine that can summon and talk reads fully clear
  Object.freeze({ id: 'optional', label: 'OPTIONAL · NOT NEEDED TO SUMMON OR TALK', ids: ['forge'], optional: true }),
]);
const OTHER = Object.freeze({ id: 'other', label: 'MORE CHECKS' });

/** The group a check belongs to; checks the panel has never met fall to MORE CHECKS. */
export const groupOf = (checkId) => GROUPS.find((group) => group.ids.includes(checkId)) || OTHER;

/** Whether a check is an optional capability (outside the summoning and its tally). */
export const isOptional = (checkId) => Boolean(groupOf(checkId).optional);

/** Count checks by status. */
const tally = (checks) => ({
  total: checks.length,
  pass: checks.filter((c) => c.status === 'pass').length,
  warn: checks.filter((c) => c.status === 'warn').length,
  fail: checks.filter((c) => c.status === 'fail').length,
});

/** A group's own line: all clear, or what in it needs a look (optional: what is available). */
export const groupLine = (checks, { optional = false } = {}) => {
  const t = tally(checks);
  if (optional) return t.pass === t.total ? 'ALL AVAILABLE' : `${t.pass} OF ${t.total} AVAILABLE ON THIS MACHINE`;
  if (t.fail) return `${t.fail} TO RESOLVE`;
  if (t.warn) return `${t.pass} / ${t.total} CLEAR · ${t.warn} NOTE${t.warn > 1 ? 'S' : ''}`;
  return `${t.pass} / ${t.total} CLEAR`;
};

/** The panel's headline while checks arrive and once they have. */
export const tallyLine = (shown, total) => {
  const t = tally(shown);
  if (shown.length < total) return `INSPECTING · ${shown.length} OF ${total}`;
  const notes = [t.fail ? `${t.fail} TO RESOLVE` : '', t.warn ? `${t.warn} NOTE${t.warn > 1 ? 'S' : ''}` : ''].filter(Boolean);
  return [`${t.pass} OF ${t.total} CLEAR`, ...notes].join(' · ');
};
