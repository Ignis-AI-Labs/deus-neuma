import { checkOutboundSecrets } from '../security/outbound-secrets.js';

const SOURCE_KEYS = new Set(['domain', 'source', 'sourceUrl', 'emailSource']);

const sourceTexts = (value, key, out) => {
  if (SOURCE_KEYS.has(key) && typeof value === 'string') out.push(value);
  if (!value || typeof value !== 'object') return out;
  for (const [childKey, child] of Object.entries(value)) sourceTexts(child, childKey, out);
  return out;
};

/** Local outbound screen for every address a sales proof could contact. */
export const evidenceEgressRefusal = (payload) => {
  const checked = checkOutboundSecrets('the sales evidence request', sourceTexts(payload, null, []), 'the act was not filed');
  return checked.ok ? null : checked.reason;
};
