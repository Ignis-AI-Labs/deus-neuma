import { relationsValidAt } from '../continuity/relation-closure.js';
import { eligibleRecallDocs, isRetiredRecallDoc, stableRecallId } from './recall-eligibility.js';

export const GRAPH_MAX_HOPS = 2;
export const GRAPH_MAX_EXPANDED = 64;
export const GRAPH_MAX_ANCHORS = 8;
export const GRAPH_MAX_NEIGHBORS = 8;
export const GRAPH_MAX_RECORDS = 64;
export const GRAPH_MAX_RELATIONS = 8;
export const GRAPH_MAX_EDGES = GRAPH_MAX_EXPANDED * GRAPH_MAX_NEIGHBORS;
export const GRAPH_MAX_COMMUNITIES = 64;
export const GRAPH_MAX_COMMUNITY_MEMBERS = 64;

const EDGE_KIND = Object.freeze({
  explicit: { priority: 0, weight: 1 },
  supersession: { priority: 1, weight: 0.9 },
  session: { priority: 2, weight: 0.7 },
  community: { priority: 3, weight: 0.5 },
});

const stableString = (value) =>
  typeof value === 'string' && value.trim() ? value : null;

const compareIds = (a, b) => a.localeCompare(b);

const clampBound = (value, fallback, maximum) =>
  Number.isInteger(value) ? Math.max(0, Math.min(value, maximum)) : fallback;

const instantFor = (asOf) => {
  const value = asOf != null ? new Date(asOf).getTime() : Date.now();
  return Number.isNaN(value) ? null : value;
};

const occurredBy = (doc, instant) => {
  if (instant === null || !doc?.occurredAt) return true;
  const occurred = new Date(doc.occurredAt).getTime();
  return Number.isNaN(occurred) || occurred <= instant;
};

const edgeValidAt = (edge, instant) => {
  if (instant === null) return true;
  if (edge.validFrom) {
    const from = new Date(edge.validFrom).getTime();
    if (!Number.isNaN(from) && from > instant) return false;
  }
  if (edge.validTo) {
    const to = new Date(edge.validTo).getTime();
    if (!Number.isNaN(to) && instant >= to) return false;
  }
  return true;
};

/** Map a continuity record id onto the observation id used by recall. */
export const continuityStableId = (record) =>
  stableString(record?.meta?.observationId) || stableString(record?.id);

/**
 * Yield bounded continuity relations and supersessions. Target mapping is built
 * only for the accepted record prefix and optional allowed-id universe. The
 * public array wrapper remains bounded; adjacency consumes the generator.
 */
export function* continuityEdges(
  records,
  {
    allowedIds = null,
    asOf = null,
    maxRecords = GRAPH_MAX_RECORDS,
    maxRelations = GRAPH_MAX_RELATIONS,
  } = {},
) {
  const recordLimit = clampBound(maxRecords, GRAPH_MAX_RECORDS, GRAPH_MAX_RECORDS);
  const rows = [];
  if (Array.isArray(records)) {
    for (let index = 0; index < records.length && index < recordLimit; index += 1) {
      rows.push(records[index]);
    }
  }
  const ids = new Map();
  for (const record of rows) {
    const recordId = stableString(record?.id);
    const stableId = continuityStableId(record);
    if (recordId && stableId && (!allowedIds || allowedIds.has(stableId))) {
      ids.set(recordId, stableId);
    }
  }
  const resolve = (id) => ids.get(id) || stableString(id);
  const relationLimit = clampBound(maxRelations, GRAPH_MAX_RELATIONS, GRAPH_MAX_RELATIONS);

  for (const record of rows) {
    const source = continuityStableId(record);
    if (!source || (allowedIds && !allowedIds.has(source))) continue;
    const boundedRelations = Array.isArray(record?.relations)
      ? record.relations.slice(0, relationLimit)
      : [];
    const relations = asOf == null
      ? boundedRelations
      : relationsValidAt({ ...record, relations: boundedRelations }, asOf);
    for (let index = 0; index < relations.length && index < relationLimit; index += 1) {
      const relation = relations[index];
      const target = resolve(relation?.targetId);
      if (
        !target ||
        !stableString(relation?.type) ||
        (allowedIds && !allowedIds.has(target))
      ) continue;
      yield {
        from: source,
        to: target,
        type: relation.type,
        kind: 'explicit',
        validFrom: relation.validFrom || record.validFrom || record.occurredAt || null,
        validTo: relation.validTo ?? null,
      };
    }

    const predecessor = resolve(record?.supersedes);
    if (predecessor && (!allowedIds || allowedIds.has(predecessor))) {
      yield {
        from: predecessor,
        to: source,
        type: 'supersession',
        kind: 'supersession',
        validFrom: record.validFrom || record.occurredAt || null,
        validTo: null,
      };
    }

    const successor = resolve(record?.supersededBy);
    if (successor && (!allowedIds || allowedIds.has(successor))) {
      yield {
        from: source,
        to: successor,
        type: 'supersession',
        kind: 'supersession',
        validFrom: record.validTo || null,
        validTo: null,
      };
    }
  }
}

export const mapContinuityEdges = (records, opts = {}) =>
  Array.from(continuityEdges(records, opts));

const edgeOrder = (a, b) =>
  a.priority - b.priority || b.weight - a.weight || compareIds(a.to, b.to) || a.type.localeCompare(b.type);

const addEdge = (adjacency, edge) => {
  if (!edge.from || !edge.to || edge.from === edge.to) return;
  const targets = adjacency.get(edge.from) || [];
  const priorIndex = targets.findIndex((candidate) => candidate.to === edge.to);
  if (priorIndex >= 0) {
    if (edgeOrder(edge, targets[priorIndex]) < 0) targets[priorIndex] = edge;
  } else if (targets.length < GRAPH_MAX_NEIGHBORS) {
    targets.push(edge);
  } else if (edgeOrder(edge, targets[targets.length - 1]) < 0) {
    targets[targets.length - 1] = edge;
  } else {
    return;
  }
  targets.sort(edgeOrder);
  adjacency.set(edge.from, targets);
};

const addChain = (adjacency, ids, kind) => {
  const unique = [...new Set(ids)].sort(compareIds);
  const config = EDGE_KIND[kind];
  for (let i = 1; i < unique.length; i += 1) {
    const left = unique[i - 1];
    const right = unique[i];
    addEdge(adjacency, { from: left, to: right, type: kind, kind, ...config });
    addEdge(adjacency, { from: right, to: left, type: kind, kind, ...config });
  }
};

/**
 * Build a deterministic adjacency over eligible emitted nodes plus bounded
 * retired lexical seeds. Session/community fallbacks remain chains; insertion
 * maintains the final capped edge-priority order instead of trimming later.
 */
export const buildRecallAdjacency = ({
  eligible,
  seedDocs = new Map(),
  docs,
  continuityRecords,
  communities,
  asOf,
}) => {
  const adjacency = new Map();
  const instant = instantFor(asOf);
  const graphIds = new Set();
  for (const id of eligible.keys()) {
    if (graphIds.size >= GRAPH_MAX_EXPANDED) break;
    graphIds.add(id);
  }
  for (const id of seedDocs.keys()) {
    if (graphIds.size >= GRAPH_MAX_EXPANDED + GRAPH_MAX_ANCHORS) break;
    graphIds.add(id);
  }

  const relationAsOf = instant === null ? null : new Date(instant).toISOString();
  for (const raw of continuityEdges(continuityRecords, { allowedIds: graphIds, asOf: relationAsOf })) {
    if (!eligible.has(raw.to) || !edgeValidAt(raw, instant)) continue;
    if (!eligible.has(raw.from) && !(seedDocs.has(raw.from) && raw.kind === 'supersession')) continue;
    const config = EDGE_KIND[raw.kind];
    addEdge(adjacency, { ...raw, ...config });
  }

  for (const [from, predecessor] of seedDocs) {
    const to = stableString(predecessor?.supersededBy);
    const successor = eligible.get(to);
    if (
      !to ||
      !graphIds.has(to) ||
      !successor ||
      !occurredBy(successor, instant) ||
      predecessor.invalidatedAt !== successor.occurredAt
    ) continue;
    const raw = {
      from,
      to,
      type: 'supersession',
      kind: 'supersession',
      validFrom: predecessor.invalidatedAt,
      validTo: null,
      ...EDGE_KIND.supersession,
    };
    if (edgeValidAt(raw, instant)) addEdge(adjacency, raw);
  }

  const sessions = new Map();
  for (const doc of docs || []) {
    const id = stableRecallId(doc);
    const sessionId = stableString(doc?.anchor?.sessionId);
    if (!id || !sessionId || !graphIds.has(id) || !eligible.has(id)) continue;
    if (!sessions.has(sessionId) && sessions.size >= GRAPH_MAX_COMMUNITIES) continue;
    const members = sessions.get(sessionId) || [];
    if (members.length < GRAPH_MAX_COMMUNITY_MEMBERS) members.push(id);
    sessions.set(sessionId, members);
  }
  for (const members of sessions.values()) addChain(adjacency, members, 'session');

  const rows = Array.isArray(communities) ? communities : [];
  for (let index = 0; index < rows.length && index < GRAPH_MAX_COMMUNITIES; index += 1) {
    const rawMembers = Array.isArray(rows[index]?.memberIds) ? rows[index].memberIds : [];
    if (rawMembers.length > GRAPH_MAX_COMMUNITY_MEMBERS) continue;
    const members = [];
    let admitted = true;
    for (const rawId of rawMembers) {
      const id = stableString(rawId);
      if (!id) continue;
      if (!graphIds.has(id) || !eligible.has(id)) {
        admitted = false;
        break;
      }
      members.push(id);
    }
    if (admitted) addChain(adjacency, members, 'community');
  }

  let edgeCount = 0;
  for (const targets of adjacency.values()) edgeCount += targets.length;
  return { adjacency, edgeCount };
};

const stateOrder = (a, b) =>
  a.hop - b.hop ||
  a.pathPriority - b.pathPriority ||
  b.pathWeight - a.pathWeight ||
  a.anchorRank - b.anchorRank ||
  compareIds(a.id, b.id);

const graphScore = (state) =>
  1 / state.hop +
  (4 - state.pathPriority) / 100 +
  state.pathWeight / 1000 +
  1 / (1_000_000 + state.anchorRank + 1);

/**
 * Traverse the eligible stable-id graph from lexical anchors. Hard caps are
 * clamped to maxHops=2 and maxExpanded=64; results contain ids and provenance
 * only, never memory text.
 */
export const rankGraphRecall = (
  { docs = [], continuityRecords = [], communities = [], anchorIds = [] } = {},
  {
    space = null,
    asOf = null,
    fallbackToGeneral = true,
    maxHops = GRAPH_MAX_HOPS,
    maxExpanded = GRAPH_MAX_EXPANDED,
  } = {},
) => {
  const hopLimit = clampBound(maxHops, GRAPH_MAX_HOPS, GRAPH_MAX_HOPS);
  const expansionLimit = clampBound(maxExpanded, GRAPH_MAX_EXPANDED, GRAPH_MAX_EXPANDED);
  const eligible = eligibleRecallDocs(docs, { space, asOf, fallbackToGeneral });
  const seedDocs = new Map();
  const seedLimit = Math.min(GRAPH_MAX_ANCHORS, expansionLimit);
  const instant = instantFor(asOf);
  for (const doc of docs || []) {
    const id = stableRecallId(doc);
    const successorId = stableString(doc?.supersededBy);
    if (
      !id ||
      !successorId ||
      seedDocs.size >= seedLimit ||
      !eligible.has(successorId) ||
      !isRetiredRecallDoc(doc, { space, asOf, fallbackToGeneral })
    ) continue;
    const successor = eligible.get(successorId);
    if (
      doc.invalidatedAt !== successor?.occurredAt ||
      !occurredBy(successor, instant)
    ) continue;
    seedDocs.set(id, doc);
  }
  const { adjacency, edgeCount } = buildRecallAdjacency({
    eligible,
    seedDocs,
    docs,
    continuityRecords,
    communities,
    asOf,
  });

  const anchors = [];
  const seenAnchors = new Set();
  for (const id of anchorIds || []) {
    if (
      !stableString(id) ||
      (!eligible.has(id) && !seedDocs.has(id)) ||
      seenAnchors.has(id)
    ) continue;
    seenAnchors.add(id);
    anchors.push(id);
    if (anchors.length >= Math.min(GRAPH_MAX_ANCHORS, expansionLimit)) break;
  }

  const frontier = anchors.map((id, anchorRank) => ({
    id,
    hop: 0,
    anchorRank,
    pathPriority: -1,
    pathWeight: 1,
    path: [id],
    via: [],
  }));
  const best = new Map(frontier.map((state) => [state.id, state]));
  const expanded = new Set();
  const results = [];
  let nodesExpanded = 0;
  let maxHop = 0;

  while (frontier.length && nodesExpanded < expansionLimit) {
    frontier.sort(stateOrder);
    const state = frontier.shift();
    if (best.get(state.id) !== state || expanded.has(state.id)) continue;
    expanded.add(state.id);
    nodesExpanded += 1;
    maxHop = Math.max(maxHop, state.hop);

    if (state.hop > 0 && eligible.has(state.id)) {
      results.push({
        id: state.id,
        score: graphScore(state),
        hop: state.hop,
        path: state.path,
        via: state.via,
      });
    }
    if (state.hop > 0 && seedDocs.has(state.path[0])) continue;
    if (!eligible.has(state.id) && state.hop > 0) continue;
    if (state.hop >= hopLimit) continue;

    for (const edge of adjacency.get(state.id) || []) {
      if (expanded.has(edge.to) || state.path.includes(edge.to)) continue;
      const next = {
        id: edge.to,
        hop: state.hop + 1,
        anchorRank: state.anchorRank,
        pathPriority: Math.max(state.pathPriority, edge.priority),
        pathWeight: state.pathWeight * edge.weight,
        path: [...state.path, edge.to],
        via: [...state.via, edge.type],
      };
      const prior = best.get(next.id);
      if (prior && stateOrder(prior, next) <= 0) continue;
      if (!prior && best.size >= expansionLimit) continue;
      best.set(next.id, next);
      frontier.push(next);
    }
  }

  return {
    results,
    metrics: {
      corpusNodes: eligible.size,
      corpusEdges: edgeCount,
      lexicalAnchors: anchors.length,
      nodesExpanded,
      maxHop,
      maxHops: hopLimit,
      maxExpanded: expansionLimit,
    },
  };
};
