// marketing-board.js — what a MARKETING level's BOARD holds, in order, as
// plain data (marketing-panel-plan.md §3): each entry a panel `kind`, its
// width in the 12-column grid (`span`), and its `scope`. A level the operator
// (or, later, the CMO) never laid out is laid out by `defaultBoard`, so a
// fresh house reads well before anyone has arranged it. Pure.

// pure — panels in halves, an odd one out taking the row; with `thirds`, three to a row when they come in threes.
const row = (panels, { thirds = false } = {}) => panels.map((p, i) => ({
  ...p,
  span: thirds && panels.length % 3 === 0 ? 4 : panels.length % 2 && i === panels.length - 1 ? 12 : 6,
}));

/**
 * pure — the default board of one level: the companies under it (when it has
 * any) across the top, one panel per campaign, the accounts, the angles, the
 * site counter (the house's alone: it counts house-wide); then one PLATFORM
 * panel per platform the level's accounts are on, NEXT 7 DAYS, and the CMO
 * LOG (the house's alone: the CMO's office is the house's); the posts across
 * the bottom.
 * @param {{companyId: ?string, tiles: number, campaignIds: string[], platforms?: string[]}} view
 * @returns {ReadonlyArray<{kind: string, span: number, scope: object}>}
 */
export const defaultBoard = ({ companyId = null, tiles = 0, campaignIds = [], platforms = [] }) => {
  const scope = { companyId };
  const campaigns = campaignIds.length ? campaignIds : [null];
  return Object.freeze([
    ...(tiles ? [{ kind: 'tiles', span: 12, scope }] : []),
    ...row([
      ...campaigns.map((campaignId) => ({ kind: 'campaign', scope: { companyId, campaignId } })),
      { kind: 'accounts', scope },
      { kind: 'angles', scope },
      ...(companyId ? [] : [{ kind: 'links', scope }]),
    ]),
    ...row([
      ...platforms.map((platform) => ({ kind: 'platform', scope: { companyId, platform } })),
      { kind: 'next-7-days', scope },
      ...(companyId ? [] : [{ kind: 'cmo-log', scope }]),
    ], { thirds: true }),
    { kind: 'posts', span: 12, scope },
  ].map(Object.freeze));
};
