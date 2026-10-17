// Context-map field service — the one real graph read shared by the REST
// surface and a sealed witness's own read-only context tool.

import neumaWorkspace from '../../core/workspace/neuma-workspace.js';
import { buildCommunities, buildSimilarityGraph } from '../../core/memory/community-detection.js';
import { deriveCommunitySummaryView } from '../../core/memory/community-summary-view.js';
import { WorkspaceAdapter } from '../../core/continuity/adapters/workspace.js';
import { betweennessCentrality, observationsToDocs } from '../../core/memory/graph-metrics.js';
import { knownPresencesFor, mentionsIn } from '../../core/memory/mind-graph.js';
import { expandMemory, formatMemoryRef } from '../../core/memory/memory-query.js';
import { neumaRecall, observationToText } from '../../core/memory/neuma-recall.js';
import { sanitizeMemoryForPrompt } from '../../core/runtime/memory-sanitizer.js';

export const CONTEXT_MAP_NODE_CAP = 500;
const CONTEXT_MAP_LABEL_MAX = 120;
export const CONTEXT_MAP_NODE_PAGE_MAX = 25;
export const CONTEXT_MAP_EDGE_PAGE_MAX = 50;
export const CONTEXT_MAP_SOURCE_CAP = 8000;
export const CONTEXT_MAP_NODE_ID_PATTERN = Object.freeze(/^[a-f0-9]{16}$/);
const NO_DEEPER_RECORD = '(no deeper record — from before the archive)';
export const COMMUNITY_SUMMARY_BASELINE_VARIANT = 'community-summary-null';
export const COMMUNITY_SUMMARY_VIEW_VARIANT = 'semantic-exact-member-summary-view';
const selectedCommunitySummaryVariant = (requested) => (
  requested === COMMUNITY_SUMMARY_VIEW_VARIANT
    ? COMMUNITY_SUMMARY_VIEW_VARIANT
    : COMMUNITY_SUMMARY_BASELINE_VARIANT
);

// Candidate summaries are stored memory, never instructions. Sanitize at the
// page/tool boundary, then fit the result inside the existing source byte
// ceiling without splitting a Unicode code point. The marker is part of the
// ceiling and makes every truncation explicit and deterministic.
const boundCommunitySummaryForPage = (summary) => {
  if (typeof summary !== 'string') return summary;
  const sanitized = sanitizeMemoryForPrompt(summary, Number.MAX_SAFE_INTEGER);
  if (Buffer.byteLength(sanitized, 'utf8') <= CONTEXT_MAP_SOURCE_CAP) return sanitized;
  const marker = '...';
  const budget = CONTEXT_MAP_SOURCE_CAP - Buffer.byteLength(marker, 'utf8');
  let bytes = 0;
  let end = 0;
  for (const character of sanitized) {
    const width = Buffer.byteLength(character, 'utf8');
    if (bytes + width > budget) break;
    bytes += width;
    end += character.length;
  }
  return `${sanitized.slice(0, end)}${marker}`;
};

/**
 * Bound memory text to the privacy-safe preview shared by context surfaces.
 * Pure; raw memory never enters graph or project-memory responses.
 * @param {unknown} text
 * @returns {string}
 */
export const toContextMapLabel = (text) =>
  Array.from(String(text || '').replace(/\s+/g, ' ').trim()).slice(0, CONTEXT_MAP_LABEL_MAX).join('');

// impure — the shared graph core: observations → capped docs → communities →
// similarity graph → centrality. The whole-field read and the single-node
// read stand on exactly this one pipeline, so a node read can never disagree
// with the field page the node id came from.
const _loadFieldGraph = async (
  laneId,
  { communitySummaryVariant, asOf } = {},
) => {
  const all = await neumaWorkspace.listObservations(laneId); // newest first
  const historical = asOf !== undefined;
  let docs;
  let truncated;
  if (historical) {
    const eligibleDocs = observationsToDocs(all, { asOf });
    truncated = eligibleDocs.length > CONTEXT_MAP_NODE_CAP;
    docs = truncated
      ? Object.freeze(eligibleDocs.slice(0, CONTEXT_MAP_NODE_CAP))
      : eligibleDocs;
  } else {
    truncated = all.length > CONTEXT_MAP_NODE_CAP;
    docs = observationsToDocs(truncated ? all.slice(0, CONTEXT_MAP_NODE_CAP) : all);
  }

  const docIds = new Set(docs.map((doc) => doc.id));
  // A persisted community cache is a current-view optimization. Historical
  // membership is always rebuilt from the same eligible observation snapshot
  // used by the graph and the folded episodic/semantic reads below.
  const cached = historical ? [] : await neumaWorkspace.readCommunities(laneId);
  const cachedIds = cached.flatMap((community) =>
    (Array.isArray(community.memberIds) ? community.memberIds : []));
  const cacheFresh = cached.length > 0
    && cachedIds.length === docIds.size
    && cachedIds.every((id) => docIds.has(id));
  const baseCommunities = (cacheFresh ? cached : buildCommunities(docs))
    .map((community) => ({ label: community.label, memberIds: community.memberIds }));
  let communities = baseCommunities;

  const variant = selectedCommunitySummaryVariant(
    communitySummaryVariant ?? process.env.NEUMA_COMMUNITY_SUMMARY_VARIANT,
  );
  if (variant === COMMUNITY_SUMMARY_VIEW_VARIANT) {
    const adapter = new WorkspaceAdapter(laneId, { workspace: neumaWorkspace });
    const [episodicRecords, semanticRecords] = await Promise.all([
      adapter.list('episodic', { asOf }),
      adapter.list('semantic', { asOf }),
    ]);
    communities = deriveCommunitySummaryView({
      communities: baseCommunities,
      episodicRecords,
      semanticRecords,
    });
  }

  const graph = buildSimilarityGraph(docs);
  const centrality = betweennessCentrality(graph);
  const communityOf = new Map();
  communities.forEach((community, index) => {
    community.memberIds.forEach((id) => communityOf.set(id, index));
  });
  return { observations: all, docs, communities, graph, centrality, communityOf, truncated };
};

/**
 * Read the current crystallized-memory field for exactly one sovereign lane.
 * Authorization belongs to the caller: REST applies workspace ownership;
 * witness tools derive the lane from the bound sealed participant. impure.
 * @param {string} laneId
 * @param {{communitySummaryVariant?:string,asOf?:string}} [opts]
 * @returns {Promise<Object>}
 */
export const readContextMapField = async (laneId, opts = {}) => {
  const {
    docs, communities, graph, centrality, communityOf, truncated,
  } = await _loadFieldGraph(laneId, opts);

  const known = await knownPresencesFor(laneId).catch(() => []);
  const [entities, relations] = await Promise.all([
    neumaWorkspace.listEntities(laneId).catch(() => []),
    neumaWorkspace.readRelations(laneId).catch(() => []),
  ]);
  const nodes = docs.map((doc) => {
    const spoken = mentionsIn(doc.text, known).map((presence) => presence.name);
    return {
      id: doc.id,
      label: toContextMapLabel(doc.text),
      degree: (graph.adjacency.get(doc.id) || []).length,
      betweenness: centrality.get(doc.id) ?? 0,
      communityIndex: communityOf.has(doc.id) ? communityOf.get(doc.id) : -1,
      ...(spoken.length ? { presences: spoken } : {}),
    };
  });

  const edges = [];
  for (const [source, neighbours] of graph.adjacency) {
    for (const { id: target, w } of neighbours) {
      if (String(source) < String(target)) edges.push({ source, target, w });
    }
  }

  return {
    nodes,
    edges,
    communities,
    presences: {
      entities: entities.map((entity) => ({
        name: entity.name,
        kind: entity.kind,
        encounters: entity.encounters ?? 0,
        firstSeen: entity.firstSeen,
        lastSeen: entity.lastSeen,
      })),
      relations: relations.map((relation) => ({
        from: relation.from,
        to: relation.to,
        kind: relation.kind,
        type: relation.type,
        encounters: relation.encounters ?? 0,
      })),
    },
    computedAt: new Date().toISOString(),
    ...(truncated ? { truncatedTo: CONTEXT_MAP_NODE_CAP } : {}),
  };
};

/**
 * Bound one field page for model context while preserving exact graph counts.
 * Pure; follow nextNodeOffset and nextEdgeOffset until null to inspect the
 * whole capped field.
 * @param {Object} field
 * @param {{offset?: number, limit?: number, edgeOffset?: number, edgeLimit?: number}} [request]
 * @returns {Readonly<Object>}
 */
export const pageContextMapField = (
  field,
  { offset = 0, limit = 20, edgeOffset = 0, edgeLimit = 40 } = {},
) => {
  const nodes = Array.isArray(field?.nodes) ? field.nodes : [];
  const edges = Array.isArray(field?.edges) ? field.edges : [];
  const communities = Array.isArray(field?.communities) ? field.communities : [];
  const start = Number.isInteger(offset) && offset >= 0 ? Math.min(offset, nodes.length) : 0;
  const size = Number.isInteger(limit)
    ? Math.min(CONTEXT_MAP_NODE_PAGE_MAX, Math.max(1, limit))
    : 20;
  const edgeStart = Number.isInteger(edgeOffset) && edgeOffset >= 0
    ? Math.min(edgeOffset, edges.length)
    : 0;
  const edgeSize = Number.isInteger(edgeLimit)
    ? Math.min(CONTEXT_MAP_EDGE_PAGE_MAX, Math.max(1, edgeLimit))
    : 40;
  const pageNodes = nodes.slice(start, start + size);
  const communityIndices = new Set(pageNodes
    .map((node) => node.communityIndex)
    .filter((index) => Number.isInteger(index) && index >= 0));
  const pageEdges = edges.slice(edgeStart, edgeStart + edgeSize);
  const nextNodeOffset = start + pageNodes.length < nodes.length ? start + pageNodes.length : null;
  const nextEdgeOffset = edgeStart + pageEdges.length < edges.length ? edgeStart + pageEdges.length : null;

  return Object.freeze({
    totals: Object.freeze({ nodes: nodes.length, edges: edges.length, communities: communities.length }),
    page: Object.freeze({
      nodeOffset: start,
      nodeLimit: size,
      nextNodeOffset,
      edgeOffset: edgeStart,
      edgeLimit: edgeSize,
      nextEdgeOffset,
    }),
    nodes: Object.freeze(pageNodes.map((node) => Object.freeze({ ...node }))),
    edges: Object.freeze(pageEdges.map((edge) => Object.freeze({ ...edge }))),
    communities: Object.freeze(communities
      .map((community, index) => ({ community, index }))
      .filter(({ index }) => communityIndices.has(index))
      .map(({ community, index }) => Object.freeze({
        index,
        label: community.label,
        size: Array.isArray(community.memberIds) ? community.memberIds.length : 0,
        ...(Object.prototype.hasOwnProperty.call(community, 'summary') ? {
          summary: boundCommunitySummaryForPage(community.summary),
          semanticRecordId: community.semanticRecordId,
          memberHash: community.memberHash,
          sourceObservationIds: Object.freeze(
            Array.isArray(community.sourceObservationIds)
              ? community.sourceObservationIds.slice()
              : [],
          ),
          unmatchedReason: community.unmatchedReason,
        } : {}),
      }))),
    presences: Object.freeze({
      entities: Object.freeze((Array.isArray(field?.presences?.entities) ? field.presences.entities : [])
        .map((entity) => Object.freeze({ ...entity }))),
      relations: Object.freeze((Array.isArray(field?.presences?.relations) ? field.presences.relations : [])
        .map((relation) => Object.freeze({ ...relation }))),
    }),
    computedAt: field?.computedAt || null,
    ...(field?.truncatedTo ? { truncatedTo: field.truncatedTo } : {}),
  });
};

// ---------------------------------------------------------------------------
// Single-node read — a sealed witness inspecting ONE graph node by id instead
// of paging the whole field. The node id is the observation id seen on field
// pages; the graph position comes from the same _loadFieldGraph pipeline, so
// degree, betweenness, and community always agree with the field view.
// ---------------------------------------------------------------------------

const LIFECYCLE_STATES = new Set(['active', 'superseded', 'retracted', 'archived']);

/**
 * The lifecycle of one observation record. An explicit `lifecycle` stamp wins
 * when it names a known state; otherwise the bi-temporal stamps decide — an
 * invalidated record with a successor is superseded, without one retracted.
 * Pure.
 * @param {Object} obs
 * @returns {{state:string, supersededBy?:string, invalidatedAt?:string}}
 */
export const observationLifecycle = (obs) => {
  const declared = LIFECYCLE_STATES.has(obs?.lifecycle) ? obs.lifecycle : null;
  const state = declared
    ?? (obs?.invalidatedAt ? (obs.supersededBy ? 'superseded' : 'retracted') : 'active');
  return {
    state,
    ...(typeof obs?.supersededBy === 'string' ? { supersededBy: obs.supersededBy } : {}),
    ...(typeof obs?.invalidatedAt === 'string' ? { invalidatedAt: obs.invalidatedAt } : {}),
  };
};

/**
 * Where one observation came from. `source` stays null when the record
 * predates provenance stamping; `noteKind` rides only on self-notes. Pure.
 * @param {Object} obs
 * @returns {{type:(string|null), source:(string|null), noteKind?:string}}
 */
export const observationProvenance = (obs) => ({
  type: typeof obs?.type === 'string' ? obs.type : null,
  source: typeof obs?.source === 'string' ? obs.source : null,
  ...(typeof obs?.noteKind === 'string' ? { noteKind: obs.noteKind } : {}),
});

/**
 * The deeper-record handle for one observation: the anchor's mem_ ref when it
 * mints one, else a stamped memoryRef, else null — null means the honest
 * 'no deeper record' answer, never a fabricated pointer. Pure.
 * @param {Object} obs
 * @returns {string|null}
 */
export const nodeObservationRef = (obs) => {
  const fromAnchor = formatMemoryRef(obs?.anchor);
  if (fromAnchor) return fromAnchor;
  return typeof obs?.memoryRef === 'string' && obs.memoryRef ? obs.memoryRef : null;
};

/**
 * Every edge touching one node, each exactly once, with the neighbor's label
 * — the cross-page reconstruction a field page cannot give. `out` edges come
 * from the node's own adjacency row, `in` edges from rows that name the node
 * (the graph is symmetric today; the direction split keeps the contract
 * honest if that ever changes). Pure.
 * @param {Map} adjacency - buildSimilarityGraph adjacency
 * @param {string} nodeId
 * @param {Map<string,string>} labelsById
 * @returns {Array<{id:string, label:string, w:number, direction:'out'|'in'}>}
 */
export const shapeNodeNeighbors = (adjacency, nodeId, labelsById) => {
  const neighbors = [];
  const seen = new Set([nodeId]);
  for (const { id, w } of adjacency?.get(nodeId) || []) {
    if (seen.has(id)) continue;
    seen.add(id);
    neighbors.push({ id, label: labelsById?.get(id) ?? '', w, direction: 'out' });
  }
  for (const [source, entries] of adjacency || []) {
    if (source === nodeId || seen.has(source)) continue;
    const touch = (entries || []).find((entry) => entry.id === nodeId);
    if (!touch) continue;
    seen.add(source);
    neighbors.push({ id: source, label: labelsById?.get(source) ?? '', w: touch.w, direction: 'in' });
  }
  return neighbors;
};

/**
 * Bound source text to the node-read budget, saying so when text was held
 * back — a truncated source must never read as the whole memory. Pure.
 * @param {unknown} text
 * @returns {{content:string, heldBack:boolean}}
 */
export const boundContextMapSource = (text) => {
  const content = String(text || '');
  if (content.length <= CONTEXT_MAP_SOURCE_CAP) return { content, heldBack: false };
  return {
    content: `${content.slice(0, CONTEXT_MAP_SOURCE_CAP)}\n[source held back at ${CONTEXT_MAP_SOURCE_CAP} chars — expand the ref for the rest]`,
    heldBack: true,
  };
};

// impure — the one IO branch of a node source read: a self-note is already
// whole on the observation (sanitized before it faces a model); an anchored
// exchange reopens through the real expand seam (the living session or the
// archive); an anchorless memory answers honestly instead of inventing text.
const _readNodeSource = async (laneId, obs, ref) => {
  if (obs.type === 'self-note') {
    const raw = typeof obs.content === 'string' ? obs.content : '';
    return {
      kind: 'self-note',
      content: sanitizeMemoryForPrompt(raw, CONTEXT_MAP_SOURCE_CAP),
      heldBack: raw.length > CONTEXT_MAP_SOURCE_CAP,
    };
  }
  if (ref) {
    const expanded = await expandMemory(
      { neumaId: laneId, ref, hops: 1 },
      { recall: neumaRecall, workspace: neumaWorkspace },
    );
    if (!expanded.ok) return { kind: 'exchange', ref, error: expanded.reason };
    return { kind: 'exchange', ref, via: expanded.source, ...boundContextMapSource(expanded.content) };
  }
  return { kind: obs.type || 'observation', note: NO_DEEPER_RECORD };
};

/**
 * Read ONE node of the lane's crystallized-memory field by its observation
 * id: graph position, provenance, timestamps, lifecycle, and the deeper-
 * record handle. includeNeighbors lists every edge touching the node;
 * includeSource reopens the full-fidelity source where one honestly exists.
 * Never throws — every refusal is an explicit {ok:false, reason}. impure.
 * @param {string} laneId
 * @param {string} nodeId - 16-char lowercase hex observation id from a field page
 * @param {{includeNeighbors?: boolean, includeSource?: boolean}} [opts]
 * @returns {Promise<{ok:true, node:Object, provenance:Object, recordedAt:(string|null), occurredAt:(string|null), lifecycle:Object, ref:(string|null), neighbors?:Array, source?:Object}|{ok:false, reason:string}>}
 */
export const readContextMapNode = async (laneId, nodeId, { includeNeighbors = true, includeSource = false } = {}) => {
  if (typeof nodeId !== 'string' || !CONTEXT_MAP_NODE_ID_PATTERN.test(nodeId)) {
    return { ok: false, reason: 'nodeId must be a 16-char lowercase hex observation id from a field page' };
  }
  const {
    observations, docs, communities, graph, centrality, communityOf,
  } = await _loadFieldGraph(laneId);
  const obs = observations.find((entry) => entry?.id === nodeId);
  if (!obs) return { ok: false, reason: 'no node with that id in your field' };

  // A node outside the capped docs (invalidated, or beyond the field cap)
  // keeps its record but holds no current graph position — 0/-1, not a lie.
  const doc = docs.find((entry) => entry.id === nodeId) || null;
  const text = doc ? doc.text : observationToText(obs);
  const communityIndex = doc && communityOf.has(nodeId) ? communityOf.get(nodeId) : -1;
  const known = await knownPresencesFor(laneId).catch(() => []);
  const spoken = mentionsIn(text, known).map((presence) => presence.name);
  const node = {
    id: nodeId,
    label: toContextMapLabel(text),
    degree: doc ? (graph.adjacency.get(nodeId) || []).length : 0,
    betweenness: doc ? (centrality.get(nodeId) ?? 0) : 0,
    communityIndex,
    communityLabel: communityIndex >= 0 ? (communities[communityIndex]?.label ?? null) : null,
    ...(spoken.length ? { presences: spoken } : {}),
  };

  const ref = nodeObservationRef(obs);
  const result = {
    ok: true,
    node,
    provenance: observationProvenance(obs),
    recordedAt: obs.recordedAt ?? obs.timestamp ?? null,
    occurredAt: obs.occurredAt ?? null,
    lifecycle: observationLifecycle(obs),
    ref,
    ...(ref ? {} : { refNote: NO_DEEPER_RECORD }),
  };
  if (includeNeighbors) {
    const labelsById = new Map(docs.map((entry) => [entry.id, toContextMapLabel(entry.text)]));
    result.neighbors = doc ? shapeNodeNeighbors(graph.adjacency, nodeId, labelsById) : [];
  }
  if (includeSource) result.source = await _readNodeSource(laneId, obs, ref);
  return result;
};
