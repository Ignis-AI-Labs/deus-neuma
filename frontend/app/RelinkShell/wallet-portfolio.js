// wallet-portfolio.js — pure portfolio assembly.
//
// Combine on-chain balances (read from the Base RPC) with spot prices (from the
// price feed) into display rows + a wallet total. No fetching, no Date, no I/O —
// deterministic and unit-testable. The impure callers (wallet-prices.js, the RPC
// reads) hand this raw numbers.
//
// Honest by construction (honest-stats: never invent a figure):
//   - a holding with no known price carries usd=null and contributes 0 to the
//     total, so the UI renders "—" for it rather than a made-up dollar value;
//   - if NOTHING is priced, the total itself is null (UI shows "—"), not "$0.00".

// Null-safe finite coercion: null/undefined/non-finite → null. Guards the
// Number(null)===0 footgun so an unknown balance, price, or percent never reads
// as a real 0; a genuine numeric 0 is preserved. Used for every numeric input
// here so the footgun cannot recur per-field.
const toFiniteOrNull = (v) => {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Price one holding: balance × spot price. Honest — a null/unknown balance or a
 * missing price yields usd:null (never a fabricated 0); an unknown 24h % stays null.
 * @param {{symbol:string, balance:number|string|null, price:({usd:number,change24h:number|null}|null)}} holding
 * @returns {Readonly<{symbol:string,balance:number,priceUsd:(number|null),change24h:(number|null),usd:(number|null)}>}
 */
export const priceRow = ({ symbol, balance, price } = {}) => {
  const amount = toFiniteOrNull(balance);
  const okAmount = amount != null && amount >= 0;
  const priceUsd = price ? toFiniteOrNull(price.usd) : null;
  const change24h = price ? toFiniteOrNull(price.change24h) : null;
  const usd = priceUsd != null && okAmount ? amount * priceUsd : null;
  return Object.freeze({ symbol, balance: okAmount ? amount : 0, priceUsd, change24h, usd });
};

/**
 * Assemble holdings into display rows + a wallet USD total + a derived 24h change.
 * usdTotal sums every priced holding (null if none is priced). The aggregate 24h
 * change is measured ONLY over the subset of holdings that carry a 24h % — today's
 * value of that subset vs yesterday's — so a holding without 24h data can never
 * distort it (numerator and denominator stay over the SAME set). null when no
 * holding has a 24h %.
 * @param {Array<{symbol:string, balance:(number|string|null), price:({usd:number,change24h:number|null}|null)}>} holdings
 * @returns {Readonly<{rows:Array, usdTotal:(number|null), change24h:(number|null)}>}
 */
export const buildPortfolio = (holdings = []) => {
  const rows = (holdings || []).map(priceRow);
  const priced = rows.filter((r) => r.usd != null);
  const usdTotal = priced.length ? priced.reduce((s, r) => s + r.usd, 0) : null;

  // Honest aggregate 24h change: reconstruct yesterday's value from each holding's
  // own 24h %. Only holdings WITH a 24h % enter the calc, and `pricedToday` sums
  // today's value of that SAME subset — so comparing today vs yesterday is
  // consistent even when other priced holdings lack 24h data.
  let baseline = 0;      // yesterday's value of the measurable subset
  let pricedToday = 0;   // today's value of that same subset
  let haveBaseline = false;
  for (const r of priced) {
    if (r.change24h == null) continue;
    const prev = r.usd / (1 + r.change24h / 100);
    if (Number.isFinite(prev) && prev > 0) {
      baseline += prev;
      pricedToday += r.usd;
      haveBaseline = true;
    }
  }
  const change24h = haveBaseline && baseline > 0 ? (pricedToday / baseline - 1) * 100 : null;

  return Object.freeze({ rows, usdTotal, change24h });
};
