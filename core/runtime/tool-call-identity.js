/**
 * Serialize JSON tool identity independently of object insertion order.
 * Array order remains significant; nested objects use the same rule.
 * @param {unknown} value JSON-compatible tool identity
 * @returns {string}
 */
export const serializeToolIdentity = (value) => JSON.stringify(value, (_key, entry) => {
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return entry;
  return Object.fromEntries(Object.keys(entry).sort().map((key) => [key, entry[key]]));
});
