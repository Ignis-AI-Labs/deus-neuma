/** Convert a decoded ETH price response without inventing missing market data.
 * @param {object} body decoded price response
 * @returns {{usd:number, change24h:number|null}|null}
 */
export const normalizeEthPrice = (body) => {
  // The proxy signals feed failure as { usd: null }. Check for null/undefined
  // BEFORE coercing — Number(null) === 0 would otherwise read as a real $0.
  if (body.usd == null) return null;
  const usd = Number(body.usd);
  if (!Number.isFinite(usd)) return null;
  // change24h: null means "unknown" — keep it null. Number(null) === 0 would
  // otherwise fabricate a flat "0.00%". A genuine flat market sends numeric 0.
  const change = body.change24h == null ? null : Number(body.change24h);
  return { usd, change24h: change != null && Number.isFinite(change) ? change : null };
};
