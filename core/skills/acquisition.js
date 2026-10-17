// #22 S2 — Skill acquisition tracking (honest).
//
// "Honest" is the load-bearing word here: a neuma has acquired a skill iff
// they have actually used it. No XP from keyword detection, no level
// progression from heuristics — the only signal is the act itself. The
// neuma either invoked the skill (success) or didn't.
//
// Tree shape (v2 — formalized this slice):
//   {
//     version: '2.0.0',
//     acquisitions: [
//       { skill, firstAcquiredAt, lastUsedAt, usageCount },
//       ...
//     ]
//   }
//
// firstAcquiredAt — set ONCE at first use, never mutated
// lastUsedAt      — bumped on every recorded use
// usageCount      — strictly monotonic; >= 1 once recorded
//
// Backward-tolerant of legacy v1 (`{ skills: [], version: '1.0.0' }`): a
// legacy tree has no acquisitions, so applyAcquisition treats it as a
// fresh start and writes back the v2 shape. The v1 `skills` array was
// never populated by any production code so there's no data to migrate.
//
// This module exposes only pure functions. The locked read-modify-write
// wrapper lives on the workspace (recordSkillUse) because the per-file
// lock IS the workspace's serialization mechanism (_withFileLock), and
// reaching across to invoke it from here would couple this module to
// workspace internals it shouldn't know about.

const NAME_RE = /^[a-z][a-z0-9-]*$/;
const TREE_VERSION = '2.0.0';

/**
 * Validate + normalize an input tree into the v2 shape. Pure.
 * Accepts:
 *   - null / undefined → fresh empty v2 tree
 *   - legacy v1 `{ skills: [], version: '1.0.0' }` → fresh empty v2 tree
 *   - v2 tree → returns a shallow copy with acquisitions in a fresh array
 *               (caller can mutate the array without aliasing the input)
 * Throws on a malformed tree (non-object, wrong-shape acquisitions).
 */
// Returns { tree, warnings? }. Pure — no side effects. Defensive warnings
// surface as structured findings the impure caller (recordSkillUse) emits
// via the proper logger. ai6 R2.1 — keeping the module genuinely pure
// (R1.5 originally console.warn'd, which violated RULE 3 and broke the
// "only pure functions" header claim).
const normalizeTree = (tree) => {
  const warnings = [];
  if (tree === null || tree === undefined) {
    return { tree: { version: TREE_VERSION, acquisitions: [] }, warnings };
  }
  if (typeof tree !== 'object' || Array.isArray(tree)) {
    throw new Error('skill tree must be an object');
  }
  if (!('acquisitions' in tree)) {
    if (Array.isArray(tree.skills) && tree.skills.length > 0) {
      warnings.push({
        kind: 'discarded-v1-skills',
        detail: `discarding non-empty v1 'skills' array (${tree.skills.length} entries)`,
        count: tree.skills.length,
      });
    }
    return { tree: { version: TREE_VERSION, acquisitions: [] }, warnings };
  }
  if (!Array.isArray(tree.acquisitions)) {
    throw new Error('skill tree `acquisitions` must be an array');
  }
  // Defensive: validate every entry has the v2 shape.
  for (const a of tree.acquisitions) {
    if (a === null || typeof a !== 'object') {
      throw new Error('each acquisition must be an object');
    }
    if (typeof a.skill !== 'string' || !NAME_RE.test(a.skill)) {
      throw new Error(`acquisition.skill must be kebab-case (got ${JSON.stringify(a.skill)})`);
    }
    if (typeof a.firstAcquiredAt !== 'string') {
      throw new Error(`acquisition.firstAcquiredAt must be a string (got ${JSON.stringify(a.firstAcquiredAt)})`);
    }
    if (typeof a.lastUsedAt !== 'string') {
      throw new Error(`acquisition.lastUsedAt must be a string (got ${JSON.stringify(a.lastUsedAt)})`);
    }
    if (typeof a.usageCount !== 'number' || a.usageCount < 1 || !Number.isInteger(a.usageCount)) {
      throw new Error(`acquisition.usageCount must be a positive integer (got ${JSON.stringify(a.usageCount)})`);
    }
  }
  return {
    tree: {
      version: TREE_VERSION,
      acquisitions: tree.acquisitions.map((a) => ({ ...a })),
    },
    warnings,
  };
};

/**
 * Apply a skill use to a tree. Pure transform — returns a NEW tree object.
 * First use creates the acquisition; subsequent uses bump usageCount +
 * lastUsedAt while keeping firstAcquiredAt fixed.
 *
 * @param {object|null} tree - prior tree (any of v1, v2, or null)
 * @param {string} skillName - kebab-case skill name
 * @param {string} nowIso - ISO-8601 timestamp for this recording
 * @returns {{
 *   tree: object,
 *   acquisition: {skill, firstAcquiredAt, lastUsedAt, usageCount},
 *   warnings: Array<{kind, detail, ...}>,
 * }}
 *   `warnings` is normally empty; the impure caller (workspace.
 *   recordSkillUse) surfaces any entries through the structured logger.
 * @throws on invalid skillName, malformed tree, or unparseable nowIso
 */
export const applyAcquisition = (tree, skillName, nowIso) => {
  if (typeof skillName !== 'string' || !NAME_RE.test(skillName)) {
    throw new Error(`applyAcquisition: skillName must be kebab-case (got ${JSON.stringify(skillName)})`);
  }
  // ai6 R1.4 — Date.parse validates it's a real ISO/RFC-2822 string.
  // firstAcquiredAt is set ONCE and never corrected; accepting "garbage"
  // would permanently corrupt the record + break lexicographic comparison
  // (clock-skew defense relies on chronologically meaningful sortable strings).
  if (typeof nowIso !== 'string' || nowIso.trim() === '' || !Number.isFinite(Date.parse(nowIso))) {
    throw new Error(`applyAcquisition: nowIso must be a parseable ISO timestamp (got ${JSON.stringify(nowIso)})`);
  }
  const { tree: next, warnings } = normalizeTree(tree);
  const existing = next.acquisitions.find((a) => a.skill === skillName);
  let acquisition;
  if (existing) {
    // Monotonic invariants: usageCount strictly increases; firstAcquiredAt
    // NEVER changes; lastUsedAt only moves forward (clock-skew defense —
    // if caller's nowIso is older than recorded lastUsedAt, keep the
    // recorded one).
    existing.usageCount += 1;
    if (nowIso > existing.lastUsedAt) existing.lastUsedAt = nowIso;
    acquisition = existing;
  } else {
    acquisition = {
      skill: skillName,
      firstAcquiredAt: nowIso,
      lastUsedAt: nowIso,
      usageCount: 1,
    };
    next.acquisitions.push(acquisition);
  }
  return { tree: next, acquisition: { ...acquisition }, warnings };
};

/**
 * Pure read helper: did this neuma's tree record an acquisition for skillName?
 * @param {object|null} tree
 * @param {string} skillName
 * @returns {boolean}
 */
export const hasAcquisition = (tree, skillName) => {
  if (!tree || !Array.isArray(tree.acquisitions)) return false;
  return tree.acquisitions.some((a) => a.skill === skillName);
};

/**
 * Pure read helper: list of acquisitions sorted by firstAcquiredAt ASC.
 * @param {object|null} tree
 * @returns {Array<{skill, firstAcquiredAt, lastUsedAt, usageCount}>}
 */
export const listAcquisitions = (tree) => {
  if (!tree || !Array.isArray(tree.acquisitions)) return [];
  return [...tree.acquisitions]
    .sort((a, b) => a.firstAcquiredAt.localeCompare(b.firstAcquiredAt))
    .map((a) => ({ ...a }));
};

export const TREE_VERSION_LATEST = TREE_VERSION;
