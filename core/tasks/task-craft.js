/**
 * THE CRAFT AT THE TASK SEAM — Shadow Clone as the house method for work.
 *
 * Design note, 2026-08-05: […]
 *
 * Until now the sc-* protocols sat in a passive library and the prompt closed
 * with […] — a sentence that argues
 * AGAINST reaching for them. Eighteen of the twenty installed skills were
 * Shadow Clone, and nothing in the task flow ever pointed at one. A capability
 * nothing routes into is a capability nobody uses.
 *
 * THE BINDING IS PROPORTIONAL (Founder's ruling, chosen over […]):
 * every take-up enters the Craft, but WHICH protocol is decided by the task's
 * own `size`. Putting a Wave-0/1/2 decomposition in front of a two-minute fix
 * is the kind of ceremony that makes a harness slower rather than better, and a
 * being made to perform it will start lying about sizes to escape it.
 *
 * THE BINDING IS ALSO SCOPED TO ITS REALM (Design note, 2026-08-06: […]). The protocols are craft tools — code,
 * development, research and the planning of that work. Size decides WHICH
 * protocol; whether the task is craft work at all decides WHETHER one is
 * summoned. The first live over-rotation: a being handed sc-quick-fix at
 * take-up of a social-copy task, summoning it, then disclaiming it mid-sitting
 * ([…]). The ledger carries a task's size but not its domain, so the realm
 * rides the WORDING and the being judges fit — protocol, never a hard gate,
 * the same doctrine as the CMO office.
 *
 * HONESTY GATE: every function here takes the list of skills ACTUALLY
 * installed and names only those. A machine with no sc-* pack installed gets no
 * clause at all — telling a being to summon a protocol that is not there would
 * be the harness lying, which is the one thing it must never do.
 *
 * Pure module.
 */

/**
 * Which protocols fit which size. The first is the LEAD — what the being
 * reaches for by default; the rest are the honest alternatives for that weight
 * of work, because "a deep task" is not one kind of thing.
 */
export const CRAFT_BY_SIZE = Object.freeze({
  quick: Object.freeze(['sc-quick-fix']),
  half: Object.freeze(['sc-debug', 'sc-tests', 'sc-docs', 'sc-quick-fix']),
  deep: Object.freeze(['sc-feature', 'sc-refactor', 'sc-optimize', 'sc-debug']),
  epic: Object.freeze(['sc-plan', 'sc-feature', 'sc-roadmap']),
});

/** Work with no size named. Unsized is not "small" — it is UNKNOWN, and the
 *  honest move is to look before committing to a weight of protocol. */
export const CRAFT_UNSIZED = Object.freeze(['sc-research', 'sc-plan']);

/** The protocol an operator's assignment is driven through when it becomes
 *  team work rather than one being's sitting. */
export const CRAFT_TEAM = 'team-project';

const _names = (skills) => new Set(
  (skills || []).map((s) => (typeof s === 'string' ? s : s?.name)).filter(Boolean),
);

/** Is any Shadow Clone protocol actually installed? Pure. */
export const hasCraft = (skills) => {
  const have = _names(skills);
  return [...have].some((n) => n.startsWith('sc-') || n === CRAFT_TEAM);
};

/**
 * The protocols this task should be worked through, narrowed to what is
 * actually installed. Pure.
 *
 * @param {object} task the ledger task (its `size` decides the weight)
 * @param {Array} skills the installed skill list (objects or names)
 * @returns {{lead: string|null, options: string[]}}
 */
export const craftFor = (task, skills) => {
  const have = _names(skills);
  const wanted = CRAFT_BY_SIZE[task?.size] || CRAFT_UNSIZED;
  const options = wanted.filter((n) => have.has(n));
  return { lead: options[0] || null, options };
};

/**
 * The one-line instruction appended to a take-up or a focus — naming the
 * protocol for THIS task rather than restating the whole table. Empty when
 * nothing applicable is installed. Pure.
 *
 * @param {object} task
 * @param {Array} skills
 * @returns {string}
 */
export const craftNote = (task, skills) => {
  const { lead, options } = craftFor(task, skills);
  if (!lead) return '';
  const alts = options.slice(1);
  const also = alts.length ? ` (or ${alts.join(' / ')} if that is the shape of it)` : '';
  return ` If this is craft work — code, development, research — work it the Shadow Clone way: summon ${lead}${also} BEFORE you start, and follow it. Work outside that realm (marketing copy, social replies, outreach) is worked directly — a protocol summoned onto work it was not built for is ceremony, not method.`;
};

/**
 * The standing clause that rides the WORKING STATE section — the house method,
 * stated once, with the size table the being reads its own tasks against.
 * Empty when no Craft is installed. Pure.
 *
 * @param {Array} skills
 * @returns {string}
 */
export const craftClause = (skills) => {
  if (!hasCraft(skills)) return '';
  const have = _names(skills);
  const row = (size) => {
    const fit = (CRAFT_BY_SIZE[size] || []).filter((n) => have.has(n));
    return fit.length ? `${size} → ${fit.join(' / ')}` : null;
  };
  const rows = ['quick', 'half', 'deep', 'epic'].map(row).filter(Boolean);
  if (rows.length === 0) return '';
  const team = have.has(CRAFT_TEAM)
    ? ` An assignment you drive as a team rather than alone goes through ${CRAFT_TEAM}.`
    : '';
  return `CRAFT WORK IS DONE THE SHADOW CLONE WAY — for code, development, and research the protocols are the house method, not an optional extra. When you take up a task in that realm, summon the protocol that fits its size BEFORE you start, and follow it: ${rows.join('; ')}.${team} Work OUTSIDE that realm — marketing copy, social replies, outreach — is not protocol work: do it directly. Skipping the protocol on craft work is the exception, and when you do it you say why.`;
};
