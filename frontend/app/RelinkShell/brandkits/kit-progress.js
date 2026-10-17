// kit-progress — how far along a kit is, computed HERE rather than fetched.
//
// WHY NOT JUST USE THE SERVER'S `readiness`. Because it is a round trip stale
// the moment somebody types. The rail shows twelve sections with a count beside
// each; if those counts only moved on save, the rail would be wrong for the
// entire time an operator is actually working — which is the only time it is
// being read. So the counts recompute on every keystroke from the draft in
// hand.
//
// ⚠️ THAT MEANS `holds()` BELOW IS A SECOND COPY OF THE GATE'S RULE, and a
// second copy is exactly what this codebase says not to build. It is allowed
// here for one reason and held to one condition: the reason is that the
// alternative is a progress indicator that lies, and the condition is
// test/unit/kit-progress.test.js, which runs this function against the REAL
// kitReadiness over a spread of kits and fails the moment the two disagree. A
// duplicate pinned to its original is a cache; an unpinned one is a fork.
//
// The server's readiness stays authoritative for the roster list and for the
// verbatim refusal report — the things that describe what is SAVED.
//
// Pure throughout.

/**
 * Is one field satisfied? Pure.
 *
 * A twin of `holds` in backend/services/branding/kit-readiness.js. Every branch
 * exists there; none may be added here alone.
 */
export const holds = (value, kind) => {
  if (kind === 'text') return typeof value === 'string' && value.trim().length > 0;
  if (kind === 'list') return Array.isArray(value);
  if (kind === 'list1') return Array.isArray(value) && value.length > 0;
  if (kind === 'number') return Number.isFinite(value);
  if (kind === 'boolean') return typeof value === 'boolean';
  if (kind === 'object') return Boolean(value) && typeof value === 'object' && Object.keys(value).length > 0;
  return false;
};

/** Read a dotted path. Pure. */
const at = (kit, dotted) =>
  String(dotted).split('.').reduce((node, part) => (node == null ? undefined : node[part]), kit);

/**
 * Every form section with its live count, plus which of its fields are gaps.
 * Pure.
 *
 * The gaps ride along per section so a field can be marked WHERE IT IS EDITED
 * rather than in a separate list somebody has to cross-reference. That was the
 * old panel's shape — a "STILL NEEDED" block naming paths like
 * `logoRules.minWidthPx`, three sections away from any box you could type in.
 *
 * @param {{sections: Array<{id, label, fields: Array<{path, kind}>}>}} form
 * @param {object} kit the draft
 * @returns {Array<{id, label, layout, note, done, total, ready, gaps: string[]}>}
 */
export const sectionProgress = (form, kit) =>
  (form?.sections || []).map((section) => {
    const gaps = section.fields
      .filter((field) => !holds(at(kit, field.path), field.kind))
      .map((field) => field.path);
    return {
      id: section.id,
      label: section.label,
      layout: section.layout,
      note: section.note || null,
      total: section.fields.length,
      done: section.fields.length - gaps.length,
      ready: gaps.length === 0,
      gaps,
    };
  });

/** The whole kit's standing, from the same numbers the rail shows. Pure. */
export const overallProgress = (form, kit) => {
  const sections = sectionProgress(form, kit);
  const total = sections.reduce((n, s) => n + s.total, 0);
  const done = sections.reduce((n, s) => n + s.done, 0);
  return {
    sections,
    done,
    total,
    ready: total > 0 && done === total,
    sectionsReady: sections.filter((s) => s.ready).length,
  };
};

/** The first section that still has a gap, for where to open on. Pure.
 *  A panel whose job is getting a kit FINISHED should not open on a section
 *  that is already done. */
export const firstUnfinished = (form, kit) =>
  sectionProgress(form, kit).find((s) => !s.ready)?.id
  || form?.sections?.[0]?.id
  || null;

/**
 * A stable string for one kit, for comparing two of them. Pure.
 *
 * Key-ORDERED, because JSON.stringify preserves insertion order and `setPath`
 * rebuilds objects — so an edit that puts a key back where it was would read as
 * a change forever. This is what lets the UNSAVED pip go OUT when somebody
 * types a character and deletes it again, which is the whole point of a dirty
 * flag rather than a mutation counter.
 */
export const canon = (value) => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canon).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canon(value[k])}`).join(',')}}`;
};

/** Has this draft moved away from what was last saved? Pure. */
export const isDirty = (draft, saved) => canon(draft) !== canon(saved);
