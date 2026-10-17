/**
 * Fuse any number of ranked lists with Reciprocal Rank Fusion.
 *
 * The first occurrence of an id owns its payload. Equal fused scores retain
 * the earliest first-seen (listIndex, rank) tuple explicitly, preserving the
 * former two-list insertion/stable-sort behavior without relying on engine
 * sort stability.
 *
 * @param {Array<Array<{id:any,score?:number}>>} lists
 * @param {{k?:number,limit?:number}} [opts]
 * @returns {Array<{id:any,score:number}>}
 */
export const reciprocalRankFusionMany = (lists, { k = 60, limit = 10 } = {}) => {
  const scores = new Map();

  for (const [listIndex, list] of (Array.isArray(lists) ? lists : []).entries()) {
    if (!Array.isArray(list)) continue;
    list.forEach((item, rank) => {
      const current = scores.get(item.id) || {
        id: item.id,
        score: 0,
        item,
        firstListIndex: listIndex,
        firstRank: rank,
      };
      current.score += 1 / (k + rank + 1);
      scores.set(item.id, current);
    });
  }

  return Array.from(scores.values())
    .sort((a, b) =>
      b.score - a.score ||
      a.firstListIndex - b.firstListIndex ||
      a.firstRank - b.firstRank
    )
    .slice(0, limit)
    .map(({ id, score, item }) => ({ ...item, id, score }));
};
