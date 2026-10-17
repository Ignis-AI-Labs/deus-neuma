// skill-tree-layout.js — pure geometry for THE CRAFT's skill tree.
//
// Turns the installed library (with its authored dependency edges) plus a
// neuma's honest acquisition record into positioned nodes on an abstract
// grid. Organization: categories stack as titled blocks (each gets a
// header row); within a block, dependency depth flows left→right in bands,
// and a band with many skills WRAPS into adjacent sub-columns instead of
// growing one endless vertical stack — a flat 18-skill category reads as a
// compact grid, not a tower. Everything here is real installed structure
// and real usage biography — no XP, no levels, no fabricated progression
// (docs/architecture/measurement/stats-and-benchmarks.md).
//
// Pure: defined inputs → deep-frozen output, zero side effects.

const UNCATEGORIZED = 'uncategorized';

/**
 * Dependency depth of one skill: 0 for roots, 1 + max depth of installed
 * dependencies otherwise. Dangling deps (not installed) are ignored; a cycle
 * (registry validation reports those separately) breaks at re-entry instead
 * of recursing forever.
 */
const depthOf = (name, byName, seen = new Set()) => {
  if (seen.has(name)) return 0;
  const skill = byName.get(name);
  if (!skill) return 0;
  const deps = (skill.dependencies || []).filter((d) => byName.has(d));
  if (deps.length === 0) return 0;
  const nextSeen = new Set(seen).add(name);
  return 1 + Math.max(...deps.map((d) => depthOf(d, byName, nextSeen)));
};

/**
 * Build the tree layout.
 *
 * @param {Array<{name: string, description: string, category?: string|null,
 *   version?: string|null, plugin?: string|null, dependencies?: string[],
 *   unlocks?: string[]}>} skills — the installed library (GET /api/v1/skills)
 * @param {Array<{skill: string, firstAcquiredAt: string, lastUsedAt: string,
 *   usageCount: number}>} acquisitions — the neuma's tree.json record
 * @param {{maxPerColumn?: number}} [opts] — rows before a band wraps sideways
 * @returns {{nodes: Array, edges: Array<{from: string, to: string}>,
 *   categories: Array<{name: string, headerRow: number, startRow: number,
 *   endRow: number}>, cols: number, rows: number, acquiredCount: number}}
 *   deep-frozen
 */
export const buildSkillTree = (skills = [], acquisitions = [], { maxPerColumn = 6 } = {}) => {
  const byName = new Map(skills.map((s) => [s.name, s]));
  const acquiredBy = new Map(acquisitions.map((a) => [a.skill, a]));

  const annotated = skills.map((s) => {
    const record = acquiredBy.get(s.name) || null;
    return {
      name: s.name,
      description: s.description,
      category: s.category || UNCATEGORIZED,
      version: s.version || null,
      plugin: s.plugin || null,
      dependencies: (s.dependencies || []).filter((d) => byName.has(d)),
      unlocks: (s.unlocks || []).filter((u) => byName.has(u)),
      acquired: record !== null,
      firstAcquiredAt: record?.firstAcquiredAt || null,
      lastUsedAt: record?.lastUsedAt || null,
      usageCount: record?.usageCount ?? 0,
      depth: depthOf(s.name, byName),
      col: 0,
      row: 0,
    };
  });

  // Category blocks, alphabetical; inside a block, depth bands left→right,
  // each band wrapping into sub-columns of at most maxPerColumn rows.
  const categoryNames = [...new Set(annotated.map((n) => n.category))].sort();
  const categories = [];
  const nodes = [];
  let base = 0;

  for (const catName of categoryNames) {
    const headerRow = base;
    const startRow = base + 1;
    let bandStart = 0;
    let blockRows = 1;

    const inCategory = annotated.filter((n) => n.category === catName);
    const depths = [...new Set(inCategory.map((n) => n.depth))].sort((a, b) => a - b);
    for (const depth of depths) {
      const band = inCategory
        .filter((n) => n.depth === depth)
        .sort((a, b) => a.name.localeCompare(b.name));
      band.forEach((node, i) => {
        node.col = bandStart + Math.floor(i / maxPerColumn);
        node.row = startRow + (i % maxPerColumn);
        nodes.push(node);
      });
      blockRows = Math.max(blockRows, Math.min(band.length, maxPerColumn));
      bandStart += Math.ceil(band.length / maxPerColumn);
    }

    const endRow = startRow + blockRows - 1;
    categories.push({ name: catName, headerRow, startRow, endRow });
    base = endRow + 1;
  }

  // Edges only between installed skills — dependency (from) unlocks (to).
  const edges = nodes.flatMap((node) =>
    node.dependencies.map((dep) => ({ from: dep, to: node.name })));

  const layout = {
    // depth was only scaffolding for band assignment — col/row carry the
    // final geometry, so it is not part of the contract.
    nodes: nodes.map(({ depth, ...node }) => {
      Object.freeze(node.dependencies);
      Object.freeze(node.unlocks);
      return Object.freeze(node);
    }),
    edges: edges.map(Object.freeze),
    categories: categories.map(Object.freeze),
    cols: nodes.reduce((m, n) => Math.max(m, n.col + 1), 0),
    rows: base,
    acquiredCount: nodes.filter((n) => n.acquired).length,
  };
  Object.freeze(layout.nodes);
  Object.freeze(layout.edges);
  Object.freeze(layout.categories);
  return Object.freeze(layout);
};

/**
 * Filter the library by a witness's search text — name, description, and
 * category all match case-insensitively. Empty query returns the input.
 * @param {Array<Object>} skills
 * @param {string} query
 * @returns {Array<Object>}
 */
export const filterSkills = (skills, query) => {
  const q = (query || '').trim().toLowerCase();
  if (!q) return skills;
  return skills.filter((s) =>
    s.name.toLowerCase().includes(q) ||
    (s.description || '').toLowerCase().includes(q) ||
    (s.category || UNCATEGORIZED).toLowerCase().includes(q));
};
