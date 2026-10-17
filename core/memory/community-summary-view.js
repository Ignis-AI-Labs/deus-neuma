// Current observation-community summaries, derived from the one continuity
// semantic producer. Pure: callers supply already-authorized, folded records.

const GENERAL_SPACE = 'general';
const compareIds = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

export const COMMUNITY_SUMMARY_UNMATCHED_REASONS = Object.freeze([
  'no-semantic',
  'unmapped-member',
  'membership-drift',
]);

const stableId = (value) => {
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
};

const stableSpace = (value) => (
  typeof value === 'string' && value.trim() ? value.trim() : GENERAL_SPACE
);

const memberSet = (values) => {
  if (!Array.isArray(values) || values.length === 0) return { ids: [], valid: false };
  const ids = [];
  for (const value of values) {
    const id = stableId(value);
    if (!id) return { ids: [], valid: false };
    ids.push(id);
  }
  return { ids: [...new Set(ids)].sort(compareIds), valid: true };
};

const sameMembers = (left, right) => (
  left.length === right.length && left.every((id, index) => id === right[index])
);

const overlaps = (left, right) => {
  const rightIds = new Set(right);
  return left.some((id) => rightIds.has(id));
};

const recordOrder = (left, right) => {
  const leftAt = Date.parse(left.recordedAt || '') || 0;
  const rightAt = Date.parse(right.recordedAt || '') || 0;
  if (leftAt !== rightAt) return rightAt - leftAt;
  return compareIds(stableId(left.id) || '', stableId(right.id) || '');
};

const currentSemanticRecords = (records) => {
  const rows = Array.isArray(records) ? records.filter((record) => record && typeof record === 'object') : [];
  const superseded = new Set(rows.map((record) => stableId(record.supersedes)).filter(Boolean));
  const seen = new Set();
  return rows.slice().sort(recordOrder).filter((record) => {
    const id = stableId(record.id);
    if (!id || superseded.has(id) || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
};

const episodeMappings = (records) => {
  const byEpisodeCandidates = new Map();
  for (const record of Array.isArray(records) ? records : []) {
    const episodeId = stableId(record?.id);
    const observationId = stableId(record?.meta?.observationId);
    if (!episodeId || !observationId) continue;
    const space = stableSpace(record.space);
    if (!byEpisodeCandidates.has(episodeId)) byEpisodeCandidates.set(episodeId, new Map());
    byEpisodeCandidates.get(episodeId).set(`${space}\u0000${observationId}`, { observationId, space });
  }

  const byEpisode = new Map();
  const spacesByObservation = new Map();
  for (const [episodeId, candidates] of byEpisodeCandidates) {
    if (candidates.size !== 1) continue;
    const mapping = candidates.values().next().value;
    byEpisode.set(episodeId, mapping);
    if (!spacesByObservation.has(mapping.observationId)) {
      spacesByObservation.set(mapping.observationId, new Set());
    }
    spacesByObservation.get(mapping.observationId).add(mapping.space);
  }
  return { byEpisode, spacesByObservation };
};

const semanticCandidates = (semanticRecords, byEpisode) => currentSemanticRecords(semanticRecords)
  .flatMap((record) => {
    const semanticRecordId = stableId(record.id);
    const memberHash = stableId(record?.meta?.memberHash);
    const members = memberSet(record?.meta?.memberIds);
    if (!semanticRecordId || !memberHash || !members.valid || typeof record.content !== 'string' || !record.content) {
      return [];
    }

    const space = stableSpace(record.space);
    const mapped = [];
    let unmapped = false;
    for (const episodeId of members.ids) {
      const mapping = byEpisode.get(episodeId);
      if (!mapping || mapping.space !== space) {
        unmapped = true;
      } else {
        mapped.push(mapping.observationId);
      }
    }

    return [{
      semanticRecordId,
      memberHash,
      space,
      summary: record.content,
      sourceObservationIds: [...new Set(mapped)].sort(compareIds),
      unmapped,
    }];
  });

const scopeIsExact = (candidate, spacesByObservation) => candidate.sourceObservationIds.every((id) => {
  const spaces = spacesByObservation.get(id);
  return spaces?.size === 1 && spaces.has(candidate.space);
});

const communityBase = (community, ids) => Object.freeze({
  ...(hasOwn(community, 'id') ? { id: community.id } : {}),
  label: typeof community?.label === 'string' ? community.label : '',
  memberIds: Object.freeze(ids.slice()),
  ...(hasOwn(community, 'size') ? { size: ids.length } : {}),
});

/**
 * Join folded semantic through-lines to deterministic observation communities.
 * Semantic member ids first map through current episodic meta.observationId;
 * only an exact sorted observation-id set in one space may attach.
 *
 * @param {{communities?:Object[],episodicRecords?:Object[],semanticRecords?:Object[]}} input
 * @returns {ReadonlyArray<Readonly<Object>>}
 */
export function deriveCommunitySummaryView({
  communities = [], episodicRecords = [], semanticRecords = [],
} = {}) {
  const { byEpisode, spacesByObservation } = episodeMappings(episodicRecords);
  const candidates = semanticCandidates(semanticRecords, byEpisode);

  return Object.freeze((Array.isArray(communities) ? communities : []).map((community) => {
    const members = memberSet(community?.memberIds);
    const ids = members.valid ? members.ids : [];
    const base = communityBase(community || {}, ids);
    const exact = candidates.find((candidate) => (
      !candidate.unmapped
      && sameMembers(candidate.sourceObservationIds, ids)
      && scopeIsExact(candidate, spacesByObservation)
    ));

    if (exact) {
      return Object.freeze({
        ...base,
        summary: exact.summary,
        semanticRecordId: exact.semanticRecordId,
        memberHash: exact.memberHash,
        sourceObservationIds: Object.freeze(exact.sourceObservationIds.slice()),
        unmatchedReason: null,
      });
    }

    const unmapped = candidates.some((candidate) => (
      candidate.unmapped && overlaps(candidate.sourceObservationIds, ids)
    ));
    const drifted = candidates.some((candidate) => (
      !candidate.unmapped
      && overlaps(candidate.sourceObservationIds, ids)
      && (!sameMembers(candidate.sourceObservationIds, ids)
        || !scopeIsExact(candidate, spacesByObservation))
    ));

    return Object.freeze({
      ...base,
      summary: null,
      semanticRecordId: null,
      memberHash: null,
      sourceObservationIds: Object.freeze([]),
      unmatchedReason: unmapped ? 'unmapped-member' : drifted ? 'membership-drift' : 'no-semantic',
    });
  }));
}
