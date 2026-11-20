// record-names — the lead engine's records by id, each with its own name (Design note, 2026-11-18: a door in a member's words
// […]). An audience, a scored company and a campaign each answer to their name. Pure.

/**
 * @param {{segments?: object[], prospects?: object[], campaigns?: object[]}} records
 * @returns {Record<string, string>} id → name
 */
export const recordNames = ({ segments = [], prospects = [], campaigns = [] }) => Object.fromEntries(
  [...segments, ...prospects, ...campaigns].filter((r) => r?.id && r?.name).map((r) => [r.id, String(r.name)]),
);
