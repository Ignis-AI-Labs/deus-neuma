// bench-summary-view.js — REPORTS' display law, PURE: the LIBRARY's one list
// you step through (proof certificates + night bundles, newest first), the
// NOT TAKEN YET grouping (the atlas's fold), and the SHARE picker's
// options. The charts themselves arrive from the server already modelled
// (bench-share-card.js) — the desk draws them, it never re-derives a score.

export const REPORT_SUBTABS = Object.freeze([
  Object.freeze({ id: 'explorer', label: 'EXPLORER' }),
  Object.freeze({ id: 'library', label: 'LIBRARY' }),
  Object.freeze({ id: 'share', label: 'SHARE' }),
]);

export const LIBRARY_FILTERS = Object.freeze([
  Object.freeze({ id: 'all', label: 'ALL' }),
  Object.freeze({ id: 'proof', label: 'PROOFS' }),
  Object.freeze({ id: 'bundle', label: 'NIGHTS' }),
]);

export const SHARE_SIZES = Object.freeze([
  Object.freeze({ id: '16x9', label: '16:9', hint: 'X · FORUMS' }),
  Object.freeze({ id: '1x1', label: '1:1', hint: 'DISCORD · IG' }),
  Object.freeze({ id: '4x5', label: '4:5', hint: 'MOBILE FEEDS' }),
]);

/**
 * The LIBRARY list: proofs and bundles merged, newest first, filtered.
 * Pure.
 * @param {?Array<{id: string, mtimeMs: number}>} proofs
 * @param {?Array<{id: string, mtimeMs: number}>} bundles
 * @param {string} filter 'all' | 'proof' | 'bundle'
 * @returns {Array<{kind: string, id: string, mtimeMs: number, key: string}>}
 */
export const libraryItems = (proofs, bundles, filter = 'all') => [
  ...(filter === 'bundle' ? [] : (proofs ?? []).map((p) => ({ kind: 'proof', id: p.id, mtimeMs: p.mtimeMs }))),
  ...(filter === 'proof' ? [] : (bundles ?? []).map((b) => ({ kind: 'bundle', id: b.id, mtimeMs: b.mtimeMs }))),
]
  .map((item) => ({ ...item, key: `${item.kind}:${item.id}` }))
  .sort((a, b) => (b.mtimeMs ?? 0) - (a.mtimeMs ?? 0));

/** pure — the selected item's index in the list, or -1. */
export const libraryIndex = (items, selected) =>
  selected ? items.findIndex((i) => i.kind === selected.kind && i.id === selected.id) : -1;

/**
 * ‹ PREV / NEXT › — the neighbour in the list (newest first, so NEXT is
 * OLDER). Nothing selected steps onto the first item. Null past either end.
 * Pure.
 * @param {Array<object>} items libraryItems output
 * @param {?{kind: string, id: string}} selected
 * @param {1|-1} dir +1 = next (older), -1 = previous (newer)
 */
export const stepLibrary = (items, selected, dir) => {
  if (items.length === 0) return null;
  const at = libraryIndex(items, selected);
  if (at < 0) return items[0];
  return items[at + dir] ?? null;
};

/** pure — "3 / 67", or "— / 67" when nothing in the list is selected. */
export const positionLabel = (items, selected) => {
  const at = libraryIndex(items, selected);
  return `${at < 0 ? '—' : at + 1} / ${items.length}`;
};

/**
 * NOT TAKEN YET, grouped by tier (t0, t1, …) in tier order. Pure.
 * @param {Array<{id: string, tier: ?string}>} notTaken
 * @returns {Array<{tier: string, ids: string[]}>}
 */
export const notTakenByTier = (notTaken) => {
  const groups = new Map();
  for (const cell of notTaken ?? []) {
    const tier = String(cell.tier ?? '—').toUpperCase();
    if (!groups.has(tier)) groups.set(tier, []);
    groups.get(tier).push(cell.id);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([tier, ids]) => ({ tier, ids }));
};

/**
 * Everything the SHARE picker can draw: every comparable series (grouped
 * under its suite) and every proof. Values are "kind|id" strings for a
 * native <select>. Pure.
 * @param {{suites?: Array, proofs?: Array}} summary
 * @returns {Array<{group: string, options: Array<{value: string, label: string}>}>}
 */
export const shareOptions = (summary) => [
  {
    group: 'PROOF SUITE',
    options: (summary?.proofs ?? []).map((p) => ({
      value: `proof|${p.id}`,
      label: `${p.chart?.date ?? ''} — ${p.total.pass}/${p.total.total}`,
    })),
  },
  ...(summary?.suites ?? []).map((s) => ({
    group: s.suiteId.toUpperCase(),
    options: s.series.map((x) => ({
      value: `series|${x.id}`,
      label: `${x.chart?.date ?? ''} · n=${x.n ?? '?'} · ${x.arms.map((a) => a.label).join('/')}`,
    })),
  })),
].filter((g) => g.options.length > 0);

/** pure — "kind|id" back to a share source (null when malformed). */
export const parseShareValue = (value) => {
  const at = String(value ?? '').indexOf('|');
  if (at < 1) return null;
  const kind = value.slice(0, at);
  return kind === 'series' || kind === 'proof' ? { kind, id: value.slice(at + 1) } : null;
};

/** pure — the first thing worth sharing: the newest proof, else the first series. */
export const defaultShareSource = (summary) => {
  if (summary?.proofs?.length) return { kind: 'proof', id: summary.proofs[0].id };
  const first = summary?.suites?.[0]?.series?.[0];
  return first ? { kind: 'series', id: first.id } : null;
};
