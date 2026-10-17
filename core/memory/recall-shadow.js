import { reciprocalRankFusionMany } from './rank-fusion.js';

const METRIC_ID_LIMIT = 64;

/** Only the exact shadow value opts in; candidate is never a live mode. */
export const resolveGraphRecallMode = (value) => value === 'shadow' ? 'shadow' : 'off';

const fuseLexical = (lists, options) => {
  const nonEmpty = (Array.isArray(lists) ? lists : []).filter(
    (list) => Array.isArray(list) && list.length > 0,
  );
  if (nonEmpty.length === 0) return [];
  if (nonEmpty.length === 1) return nonEmpty[0].slice(0, options.limit);
  return reciprocalRankFusionMany(nonEmpty, options);
};

const selectRanks = (ranked, eligibleIds, partitions, resultLimit) => {
  const eligible = eligibleIds instanceof Set
    ? ranked.filter((item) => eligibleIds.has(item.id))
    : ranked;
  if (!Array.isArray(partitions) || partitions.length === 0) {
    return eligible.slice(0, resultLimit);
  }
  const selected = [];
  const seen = new Set();
  for (const partition of partitions) {
    if (!(partition instanceof Set)) continue;
    for (const item of eligible) {
      if (!partition.has(item.id) || seen.has(item.id)) continue;
      seen.add(item.id);
      selected.push(item);
      if (selected.length >= resultLimit) return selected;
    }
  }
  return selected;
};

const rankIds = (ranked) => ranked.slice(0, METRIC_ID_LIMIT).map((item) => item.id);

/**
 * Compare the two-list lexical baseline with a graph-augmented candidate over
 * one eligible stable-id universe. The public result is always the baseline;
 * the candidate and bounded opaque rank metrics are for private shadow use.
 *
 * @param {{lexicalLists?:Array<Array>,graphList?:Array,eligibleIds?:Set<string>,
 *   partitions?:Array<Set<string>>,resultLimit?:number}} input
 * @param {{k?:number,limit?:number}} [opts]
 */
export const compareRecallRanks = (
  {
    lexicalLists = [],
    graphList = [],
    eligibleIds = null,
    partitions = null,
    resultLimit = Number.POSITIVE_INFINITY,
  } = {},
  { k = 60, limit = 10 } = {},
) => {
  const options = { k, limit };
  const baseline = selectRanks(fuseLexical(lexicalLists, options), eligibleIds, partitions, resultLimit);
  const candidateFull = graphList.length > 0
    ? reciprocalRankFusionMany(
      [...lexicalLists.filter((list) => Array.isArray(list) && list.length > 0), graphList],
      options,
    )
    : baseline;
  const candidate = graphList.length > 0
    ? selectRanks(candidateFull, eligibleIds, partitions, resultLimit)
    : baseline;

  const baselineIds = rankIds(baseline);
  const candidateIds = rankIds(candidate);
  const baselineRanks = new Map(baselineIds.map((id, rank) => [id, rank]));
  const rankChanges = [];
  for (let rank = 0; rank < candidateIds.length && rankChanges.length < METRIC_ID_LIMIT; rank += 1) {
    const id = candidateIds[rank];
    const baselineRank = baselineRanks.get(id);
    if (baselineRank !== rank) rankChanges.push({ id, baselineRank: baselineRank ?? null, candidateRank: rank });
  }

  return {
    result: baseline,
    baseline,
    candidate,
    metrics: {
      baselineCount: baseline.length,
      candidateCount: candidate.length,
      graphCount: graphList.length,
      baselineIds,
      candidateIds,
      rankChanges,
    },
  };
};
