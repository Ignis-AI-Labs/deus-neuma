// lp-book-math.js — the arithmetic of a house member's earnings book (Founder
// 2026-11-13: rewards are earned […]). Pure.
//
// The book never guesses where money came from. It keeps the wallet's holdings
// as they stood after the last thing it knew of. Between two looks a wallet
// changes for two reasons only: the member's own acts, which the book records
// as they happen, and money arriving from outside (the operator funding it, a
// housemate sending to it). So:
//
//   funded   = the dollar value of everything that arrived from outside, priced on arrival
//   returned = what the member sent on to the house (housemates, the operator)
//   rewards  = what was paid out for its rewards
//   value    = what the wallet and its positions are worth now
//   earned   = value + returned + rewards − funded
//              (the capital it made: gas, fees, trades and price moves all count)
//   free     = earned − rewards, never more than value: what a reward can draw on
//
// A holding is {key: 'ETH' | token address, symbol, decimals, raw: string, priceUsd: number|null}.

const finite = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const cents = (v) => Math.round(finite(v) * 100) / 100;

/** A raw integer amount as a plain number of whole tokens. Pure. */
export const tokens = (raw, decimals) => {
  try {
    const big = BigInt(raw);
    const neg = big < 0n;
    const abs = neg ? -big : big;
    const unit = 10n ** BigInt(decimals);
    const whole = Number(abs / unit) + Number(abs % unit) / Number(unit);
    return neg ? -whole : whole;
  } catch {
    return 0;
  }
};

/** One holding in dollars; 0 when it has no price. Pure. */
export const holdingUsd = (h) => (h && Number.isFinite(h.priceUsd) ? tokens(h.raw, h.decimals) * h.priceUsd : 0);

/** Every holding in dollars, and the symbols held that have no price. Pure. */
export const walletUsd = (holdings) => ({
  usd: (holdings ?? []).reduce((sum, h) => sum + holdingUsd(h), 0),
  unpriced: (holdings ?? []).filter((h) => !Number.isFinite(h.priceUsd) && BigInt(h.raw || 0) > 0n).map((h) => h.symbol),
});

// pure — a raw integer amount as an exact decimal string of whole tokens ("472889999999999963762", 18 → "472.889999999999963762").
const wholeString = (raw, decimals) => {
  const neg = raw.startsWith('-');
  const digits = (neg ? raw.slice(1) : raw).replace(/^0+(?=\d)/, '');
  if (decimals === 0) return `${neg ? '-' : ''}${digits}`;
  const padded = digits.padStart(decimals + 1, '0');
  const frac = padded.slice(-decimals).replace(/0+$/, '');
  return `${neg ? '-' : ''}${padded.slice(0, -decimals)}${frac ? `.${frac}` : ''}`;
};

/**
 * A position's totals and fees as exact decimal strings of WHOLE tokens. Pure.
 *
 * Umbrae's /positions gives them in RAW on-chain units, with each token's
 * decimals on poolInfo (read live 2026-11-13: totalXAmount
 * "472889999999999963762" for 472.89 VIRTUAL, tokenX.decimals 18), while its
 * per-bin rows are already whole tokens. An integer amount is scaled by its
 * token's decimals; a decimal one, or one with no decimals given, is taken as
 * whole tokens already.
 *
 * @param {object} pool - one pool of Umbrae's positions answer
 * @param {object} data - one position's positionData
 * @returns {{x: string, y: string, feeX: string, feeY: string}}
 */
export const positionStrings = (pool, data) => {
  const dx = pool?.poolInfo?.tokenX?.decimals;
  const dy = pool?.poolInfo?.tokenY?.decimals;
  const whole = (v, d) => {
    const s = String(v ?? '0').trim();
    return Number.isInteger(d) && d >= 0 && /^-?\d+$/.test(s) ? wholeString(s, d) : s || '0';
  };
  const d = data ?? {};
  return { x: whole(d.totalXAmount, dx), y: whole(d.totalYAmount, dy), feeX: whole(d.feeX, dx), feeY: whole(d.feeY, dy) };
};

/** A position's totals and fees as numbers of whole tokens (see positionStrings). Pure. */
export const positionAmounts = (pool, data) => {
  const s = positionStrings(pool, data);
  return { x: finite(s.x), y: finite(s.y), feeX: finite(s.feeX), feeY: finite(s.feeY) };
};

/**
 * What the positions are worth, fees waiting included, from Umbrae's
 * positions answer (prices on poolInfo). Pure.
 * @param {Array<object>|null} pools
 * @returns {number}
 */
export const positionsUsd = (pools) => (Array.isArray(pools) ? pools : []).reduce((sum, pool) => {
  const px = finite(pool?.poolInfo?.tokenXPriceUsd);
  const py = finite(pool?.poolInfo?.tokenYPriceUsd);
  return sum + (pool?.positions?.userPositions ?? []).reduce((s, p) => {
    const a = positionAmounts(pool, p.positionData);
    return s + (a.x + a.feeX) * px + (a.y + a.feeY) * py;
  }, 0);
}, 0);

/**
 * The change between two reads of the wallet, priced at `prices` (by key).
 * Only holdings read BOTH times are compared, so a token the second read could
 * not reach is never taken for a balance of zero. Pure.
 * @param {Record<string, string>} before - key → raw
 * @param {Array<object>} after - holdings
 * @returns {{usd: number, moved: Array<{symbol: string, amount: number, usd: number}>}}
 */
export const changeUsd = (before, after) => {
  const moved = [];
  for (const h of after ?? []) {
    const was = before?.[h.key];
    if (was === undefined && BigInt(h.raw || 0) === 0n) continue;
    const delta = BigInt(h.raw || 0) - BigInt(was ?? 0);
    if (delta === 0n) continue;
    moved.push({ symbol: h.symbol, amount: tokens(delta, h.decimals), usd: holdingUsd({ ...h, raw: delta.toString() }) });
  }
  return { usd: moved.reduce((s, m) => s + m.usd, 0), moved };
};

/** The holdings as the book keeps them: key → raw, merged over what it knew. Pure. */
export const heldAfter = (before, holdings) => ({ ...(before ?? {}), ...Object.fromEntries((holdings ?? []).map((h) => [h.key, String(h.raw)])) });

/**
 * The book's headline figures. Pure.
 * @param {{fundedUsd?: number, returnedUsd?: number, rewardsUsd?: number}} book
 * @param {number} valueUsd
 */
export const bookFigures = (book, valueUsd) => {
  const funded = finite(book?.fundedUsd);
  const returned = finite(book?.returnedUsd);
  const rewards = finite(book?.rewardsUsd);
  const value = finite(valueUsd);
  const earned = cents(value + returned + rewards - funded);
  // Free is figured from the rounded figures, so the card adds up to the cent.
  return Object.freeze({
    valueUsd: cents(value), fundedUsd: cents(funded), returnedUsd: cents(returned), rewardsUsd: cents(rewards),
    earnedUsd: earned, freeUsd: cents(Math.max(0, Math.min(earned - cents(rewards), cents(value)))),
  });
};

/** A signed dollar figure for a line: "+$1.20", "−$0.40". Pure. */
export const signedUsd = (v) => {
  const n = cents(v);
  return `${n < 0 ? '−' : '+'}$${Math.abs(n).toFixed(2)}`;
};

/**
 * Change since an earlier day's point, or null when the book has none that old. Pure.
 * @param {Record<string, {earnedUsd: number}>} days - day key → point
 * @param {string} today - YYYY-MM-DD
 * @param {number} earnedNow
 * @param {number} back - days back (1 = since yesterday's close)
 */
export const earnedSince = (days, today, earnedNow, back) => {
  const keys = Object.keys(days ?? {}).filter((d) => d < today).sort();
  if (!keys.length) return null;
  const target = new Date(`${today}T00:00:00Z`);
  target.setUTCDate(target.getUTCDate() - back);
  const want = target.toISOString().slice(0, 10);
  const at = keys.filter((d) => d <= want).pop() ?? null;
  return at ? cents(earnedNow - finite(days[at].earnedUsd)) : null;
};

/** At most this many day points and journal lines are kept. */
export const DAYS_KEPT = 120;
export const JOURNAL_KEPT = 300;

/** The newest `max` keys of a day map. Pure. */
export const trimDays = (days, max = DAYS_KEPT) => Object.fromEntries(Object.entries(days ?? {}).sort(([a], [b]) => (a < b ? -1 : 1)).slice(-max));
