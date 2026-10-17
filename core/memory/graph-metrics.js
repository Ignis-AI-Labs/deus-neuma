// Graph metrics over the memory similarity graph (CONTEXT MAP, S-05).
//
// Sibling of community-detection.js: pure, zero-dependency, deterministic.
// `betweennessCentrality` runs Brandes' algorithm (unweighted BFS variant)
// over the `{nodeIds, adjacency}` shape produced by `buildSimilarityGraph` —
// that graph is undirected by construction (each edge is pushed onto BOTH
// endpoints' adjacency lists), so the undirected pair-count convention is
// used throughout. `observationsToDocs` adapts real workspace observation
// records (neuma-workspace.js addObservation shape) into the `{id, text}`
// docs that `buildCommunities` and `buildSimilarityGraph` consume, excluding
// superseded records (`invalidatedAt`).

/** Total-order comparator for heterogenous node ids: string coercion makes
 *  mixed types (number vs string) genuinely antisymmetric — relational
 *  operators alone return false both ways for e.g. 5 vs 'a', which breaks
 *  the total order a deterministic sort requires. Pure. */
const compareIds = (a, b) => {
  const sa = String(a);
  const sb = String(b);
  return sa < sb ? -1 : sa > sb ? 1 : 0;
};

// Textual fields of a real observation record, in canonical order — the same
// ladder neuma-recall.js `observationToText` reads. `exchange` records (the
// shape portal-stream and session-compactor actually write) carry
// `userMessage` + `response`.
const TEXT_FIELDS = ['userMessage', 'response', 'content', 'text', 'summary'];

// Historical graph views use event time, not the current tombstone view.
// Missing/invalid temporal evidence fails closed; the absent-asOf branch is
// deliberately the pre-P3B predicate byte-for-byte (`!invalidatedAt`).
const observationVisibleAt = (obs, asOf) => {
  if (!obs || typeof obs !== 'object') return false;
  if (asOf === undefined) return !obs.invalidatedAt;
  const at = Date.parse(asOf);
  const occurredAt = Date.parse(obs.occurredAt ?? obs.timestamp ?? obs.recordedAt);
  if (!Number.isFinite(at) || !Number.isFinite(occurredAt) || occurredAt > at) return false;
  if (!obs.invalidatedAt) return true;
  const invalidatedAt = Date.parse(obs.invalidatedAt);
  return Number.isFinite(invalidatedAt) && invalidatedAt > at;
};

/**
 * Betweenness centrality via Brandes' algorithm (unweighted BFS variant).
 * Deterministic: sources are processed in sorted nodeId order and neighbour
 * lists are de-duplicated and sorted, so the result is identical regardless
 * of Map insertion order or adjacency-array order. The graph is treated as
 * undirected (matching `buildSimilarityGraph`'s symmetric adjacency), so the
 * per-source accumulation is halved. Pure.
 *
 * @param {{nodeIds:Array, adjacency:Map}} graph - From buildSimilarityGraph
 * @param {{normalized?:boolean}} [opts] - normalized divides by (n-1)(n-2)/2
 *   (undirected pair count); with n < 3 there are no intermediate pairs, so
 *   every score is 0.
 * @returns {Map<any, number>} Frozen Map nodeId → centrality, sorted-id order
 */
export const betweennessCentrality = ({ nodeIds, adjacency }, { normalized = true } = {}) => {
  const ordered = [...(nodeIds || [])].sort(compareIds);
  const n = ordered.length;
  const inGraph = new Set(ordered);

  // Deterministic neighbour lists: unique, sorted, restricted to known nodes.
  const neighbours = new Map(
    ordered.map((id) => [
      id,
      [...new Set(((adjacency && adjacency.get(id)) || []).map((e) => e.id))]
        .filter((nId) => inGraph.has(nId) && nId !== id)
        .sort(compareIds),
    ])
  );

  const accumulated = new Map(ordered.map((id) => [id, 0]));

  for (const s of ordered) {
    // Single-source shortest-path counting (BFS).
    const stack = [];
    const predecessors = new Map(ordered.map((id) => [id, []]));
    const sigma = new Map(ordered.map((id) => [id, 0]));
    const dist = new Map(ordered.map((id) => [id, -1]));
    sigma.set(s, 1);
    dist.set(s, 0);
    const queue = [s];
    for (let qi = 0; qi < queue.length; qi++) {
      const v = queue[qi];
      stack.push(v);
      for (const w of neighbours.get(v)) {
        if (dist.get(w) < 0) {
          dist.set(w, dist.get(v) + 1);
          queue.push(w);
        }
        if (dist.get(w) === dist.get(v) + 1) {
          sigma.set(w, sigma.get(w) + sigma.get(v));
          predecessors.get(w).push(v);
        }
      }
    }

    // Dependency accumulation, reverse BFS order.
    const delta = new Map(ordered.map((id) => [id, 0]));
    for (let i = stack.length - 1; i >= 0; i--) {
      const w = stack[i];
      for (const v of predecessors.get(w)) {
        delta.set(v, delta.get(v) + (sigma.get(v) / sigma.get(w)) * (1 + delta.get(w)));
      }
      if (w !== s) accumulated.set(w, accumulated.get(w) + delta.get(w));
    }
  }

  // Undirected: each (source, target) pair was counted from both endpoints.
  const denom = ((n - 1) * (n - 2)) / 2;
  const out = new Map();
  for (const id of ordered) {
    const raw = accumulated.get(id) / 2;
    out.set(id, normalized ? (n < 3 ? 0 : raw / denom) : raw);
  }
  return Object.freeze(out);
};

/**
 * Adapt workspace observation records to `{id, text}` docs for the community
 * / similarity pipeline. Current reads exclude every superseded record
 * (`invalidatedAt` set by invalidateObservation). When `asOf` is present,
 * event time and invalidation time instead define one historical snapshot:
 * occurredAt <= asOf < invalidatedAt. Records whose textual fields are all
 * empty are dropped. Pure.
 *
 * @param {Array<Object>} observations - Records from listObservations
 * @param {{asOf?:string}} [opts] - Optional historical snapshot timestamp
 * @returns {ReadonlyArray<{id:any, text:string}>} Frozen array of frozen docs
 */
export const observationsToDocs = (observations, { asOf } = {}) =>
  Object.freeze(
    (observations || [])
      .filter((obs) => observationVisibleAt(obs, asOf))
      .map((obs) =>
        Object.freeze({
          id: obs.id,
          text: TEXT_FIELDS.map((f) => (typeof obs[f] === 'string' ? obs[f] : ''))
            .join(' ')
            .trim(),
        })
      )
      .filter((d) => d.text.length > 0)
  );
