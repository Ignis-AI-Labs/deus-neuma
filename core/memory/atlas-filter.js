// Atlas filter — narrowing the memory atlas's list. Kept apart from the builder
// so the operator's window can filter the list it was sent without carrying
// the clustering code. Pure.

/** The instant of an ISO stamp in ms, or null when it is not a date. */
export const timeOf = (iso) => {
  const t = Date.parse(iso || '');
  return Number.isNaN(t) ? null : t;
};

/** The month a memory falls in, "YYYY-MM" (UTC), or "undated". */
export const monthOf = (iso) => (timeOf(iso) === null ? 'undated' : new Date(timeOf(iso)).toISOString().slice(0, 7));

/**
 * Narrow the atlas's memories by any mix of topic, person, period, kind,
 * state, space and a set of ids (a search's answer). Every filter left out
 * holds nothing back. `topic` -1 means the memories in no topic. Pure.
 * @param {Array} memories - atlas.memories
 * @param {{topic?:(number|null), person?:(string|null), period?:(string|null), kind?:(string|null),
 *   state?:(string|null), space?:(string|null), ids?:(Set<string>|null)}} [by]
 * @returns {Array}
 */
export const filterMemories = (memories, by = {}) => {
  const person = typeof by.person === 'string' ? by.person.toLowerCase() : null;
  return (memories || []).filter((m) => {
    if (Number.isInteger(by.topic) && m.topic !== by.topic) return false;
    if (person && !(m.people || []).some((p) => p.toLowerCase() === person)) return false;
    if (by.period && monthOf(m.at) !== by.period) return false;
    if (by.kind && m.kind !== by.kind) return false;
    if (by.state === 'active' && m.state !== 'active') return false;
    if (by.state === 'set-aside' && m.state === 'active') return false;
    if (by.space && (m.space || 'general') !== by.space) return false;
    if (by.ids && !by.ids.has(m.id)) return false;
    return true;
  });
};
