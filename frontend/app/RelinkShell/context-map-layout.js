// context-map-layout.js — pure geometry for the CONTEXT MAP's memory-graph field.
//
// Turns the server's memory graph (`GET /api/workspace/:id/memory/graph` →
// {nodes, edges, communities}) into positioned circles on an abstract plane.
// Organization: communities sit at evenly spaced angles on a ring; inside a
// community, members unfurl on a golden-angle phyllotaxis spiral around the
// community center — a deterministic sunflower packing, no force simulation.
// Node radius is scaled by REAL measured betweenness centrality (Brandes over
// the actual crystallized-memory graph) — no XP, no invented weights, no
// fabricated importance (docs/architecture/measurement/stats-and-benchmarks.md).
//
// Coordinates are abstract units; the component maps them to px later
// (same contract as skill-tree-layout.js). Pure: defined inputs →
// deep-frozen output, zero side effects, zero Math.random / Date.now.

/** Golden angle in radians (137.508°) — the phyllotaxis divergence angle. */
const GOLDEN_ANGLE = 137.508 * (Math.PI / 180);

/** Stable string key for a node id of any primitive type. */
const keyOf = (id) => String(id);

/**
 * Phyllotaxis offset for the n-th member of a cluster (0-based):
 * r = c·√n, θ = n·137.508°. n = 0 sits exactly on the cluster center.
 */
const phyllotaxisOffset = (n, c) => {
  const r = c * Math.sqrt(n);
  const theta = n * GOLDEN_ANGLE;
  return { dx: r * Math.cos(theta), dy: r * Math.sin(theta) };
};

/**
 * Build the memory-graph field layout.
 *
 * @param {{nodes?: Array<{id: string|number, label?: string,
 *   degree?: number, betweenness?: number}>,
 *   edges?: Array<{source: string|number, target: string|number, w?: number}>,
 *   communities?: Array<{id?: string|number, label?: string,
 *   memberIds?: Array<string|number>}>}} graph — B-06 route shape; missing
 *   betweenness reads as 0, missing memberIds as [].
 * @param {{ringRadius?: number, spiralSpacing?: number,
 *   rMin?: number, rMax?: number}} [opts] — abstract-unit knobs
 * @returns {{nodes: Array<{id, label, x, y, r, communityIndex}>,
 *   edges: Array<{source, target, x1, y1, x2, y2}>,
 *   communityRings: Array<{cx: number, cy: number, label: string}>,
 *   bounds: {minX: number, minY: number, maxX: number, maxY: number}}}
 *   deep-frozen; empty graph → empty arrays with zeroed bounds.
 */
export const buildContextMapLayout = (
  { nodes = [], edges = [], communities = [] } = {},
  { ringRadius = 100, spiralSpacing = 8, rMin = 3, rMax = 10 } = {},
) => {
  const byId = new Map(nodes.map((n) => [keyOf(n.id), n]));

  // Betweenness → radius scale. Real measured values only; a graph where
  // nothing bridges anything (maxB = 0) renders every node at rMin.
  const betweennessOf = (n) => (Number.isFinite(n.betweenness) ? n.betweenness : 0);
  const maxB = nodes.reduce((m, n) => Math.max(m, betweennessOf(n)), 0);
  const radiusOf = (n) =>
    maxB === 0 ? rMin : rMin + (rMax - rMin) * (betweennessOf(n) / maxB);

  // Communities in stable order (label, else id, string compare); members
  // deduped across communities — first sorted community wins a shared node.
  const sortedCommunities = [...communities]
    .map((c) => ({
      label: c.label != null ? String(c.label) : String(c.id ?? ''),
      memberIds: c.memberIds || [],
    }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const claimed = new Set();
  const groups = sortedCommunities.map((c, i) => {
    const members = [...new Set(c.memberIds.map(keyOf))]
      .filter((k) => byId.has(k) && !claimed.has(k))
      .sort((a, b) => a.localeCompare(b));
    members.forEach((k) => claimed.add(k));
    return { label: c.label, members, communityIndex: i };
  });

  // Communityless nodes form one final group; they carry communityIndex -1
  // and their gathering point gets no ring — it is not a detected community.
  const loose = [...byId.keys()]
    .filter((k) => !claimed.has(k))
    .sort((a, b) => a.localeCompare(b));
  const allGroups = loose.length > 0
    ? [...groups, { label: null, members: loose, communityIndex: -1 }]
    : groups;

  // Group i of G sits at angle 2π·i/G on the ring; a lone group sits at
  // (R, 0) by the same formula — abstract units, the component recenters.
  const placedGroups = allGroups.map((g, i) => {
    const angle = (2 * Math.PI * i) / allGroups.length;
    return {
      ...g,
      cx: ringRadius * Math.cos(angle),
      cy: ringRadius * Math.sin(angle),
    };
  });

  const positioned = new Map();
  const outNodes = [];
  for (const group of placedGroups) {
    group.members.forEach((k, n) => {
      const src = byId.get(k);
      const { dx, dy } = phyllotaxisOffset(n, spiralSpacing);
      const node = {
        id: src.id,
        label: src.label ?? keyOf(src.id),
        x: group.cx + dx,
        y: group.cy + dy,
        r: radiusOf(src),
        communityIndex: group.communityIndex,
      };
      positioned.set(k, node);
      outNodes.push(node);
    });
  }

  // Edges resolve to segment endpoints; edges touching unknown nodes drop.
  // Sorted by (source, target) so input edge order can never leak through.
  const outEdges = edges
    .filter((e) => positioned.has(keyOf(e.source)) && positioned.has(keyOf(e.target)))
    .map((e) => {
      const a = positioned.get(keyOf(e.source));
      const b = positioned.get(keyOf(e.target));
      return { source: e.source, target: e.target, x1: a.x, y1: a.y, x2: b.x, y2: b.y };
    })
    .sort((a, b) =>
      keyOf(a.source).localeCompare(keyOf(b.source)) ||
      keyOf(a.target).localeCompare(keyOf(b.target)));

  const communityRings = placedGroups
    .filter((g) => g.communityIndex !== -1)
    .map((g) => ({ cx: g.cx, cy: g.cy, label: g.label }));

  const bounds = outNodes.length === 0
    ? { minX: 0, minY: 0, maxX: 0, maxY: 0 }
    : outNodes.reduce(
        (b, n) => ({
          minX: Math.min(b.minX, n.x - n.r),
          minY: Math.min(b.minY, n.y - n.r),
          maxX: Math.max(b.maxX, n.x + n.r),
          maxY: Math.max(b.maxY, n.y + n.r),
        }),
        { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
      );

  const layout = {
    nodes: Object.freeze(outNodes.map(Object.freeze)),
    edges: Object.freeze(outEdges.map(Object.freeze)),
    communityRings: Object.freeze(communityRings.map(Object.freeze)),
    bounds: Object.freeze(bounds),
  };
  return Object.freeze(layout);
};
