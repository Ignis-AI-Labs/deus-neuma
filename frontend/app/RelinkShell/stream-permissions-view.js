// stream-permissions-view — the PURE decisions behind the PERMISSIONS rail.
//
// Split from the component for the reason every view model here is: what the
// operator sees when a lane is unreadable, or when he is looking at one being
// versus the house, is a decision worth testing without a browser.

/** The four kinds, in the order they are shown, with the words a person uses.
 *  Order is deliberate: ACTS are what most grants are, FOLDERS and FILES are
 *  reach into the operator's disk, SPEND is money. Most-common first, most
 *  consequential last — so the tail of the list is the part worth staring at. */
export const KIND_SENSE = Object.freeze({
  act: { label: 'GRANTED ACTS', note: 'standing tool grants and explicitly labeled session network exceptions' },
  folder: { label: 'FOLDERS', note: 'ground outside its own lane' },
  file: { label: 'GUARDED FILES', note: 'protected files opened by name' },
  spend: { label: 'SPEND', note: 'wallet recipients you allowlisted' },
});

/** The strip's badge: the HOUSE total, so a grant on a being the operator is
 *  NOT looking at still shows up. Unreadable lanes do not count toward it —
 *  they are surfaced as a warning instead, because an unknown is not a number.
 *  Pure. */
export const houseBadge = (house) =>
  Object.values(house?.totals || {}).reduce((n, v) => n + (Number(v) || 0), 0);

/**
 * Which records to draw, and whether to name each one. Pure.
 *
 * THIS BEING: just the one in the chair — and if it has no record at all, an
 * empty list rather than someone else's grants, which would be a lie about
 * whose permissions these are.
 *
 * ALL BEINGS: every lane, each under its own name.
 */
export const beingRow = (house, neumaId, allBeings) => {
  const beings = house?.beings || [];
  if (allBeings) return { rows: beings, showName: true };
  const mine = beings.filter((b) => b.neumaId === neumaId);
  return { rows: mine, showName: false };
};

/**
 * The house as a HARNESS desk may see it: its own lane and nothing else — the
 * harness is strictly the platform (Design note, 2026-10-14, so no being's grants, no
 * being's count in the badge, no being's unreadable lane. Pure.
 * @param {object|null} house the /permissions read
 * @param {string|null} laneId the harness lane in the chair
 */
export const laneOnlyHouse = (house, laneId) => {
  if (!house) return house;
  const beings = (house.beings || []).filter((b) => b.neumaId === laneId);
  const own = beings[0];
  return {
    ...house,
    beings,
    unreadable: own?.unreadable ? 1 : 0,
    totals: { lane: own && !own.unreadable ? Number(own.total) || 0 : 0 },
  };
};
