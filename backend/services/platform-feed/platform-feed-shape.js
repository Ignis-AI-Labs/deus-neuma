// platform-feed-shape.js — raw platform JSON turned into something a being can
// reason over, without ever claiming more precision than the source does.
//
// THE HONESTY RULES, inherited whole from branding/platform-stats.js, because
// the failure they prevent is the same one and it is worse here: a card draws
// one number a human reads, a feed hands a being a whole worldview it will
// reason FROM.
//
//   · ABSENT IS NOT ZERO. `Number(null)` is 0, and a helper that quietly turns
//     […] into "0" is how a being ends up saying […] when the truth is "the read failed". Absent stays null.
//   · THE SOURCE'S OWN DOUBT IS CARRIED. Three flags in these payloads mean a
//     figure is softer than it looks, and each becomes a caveat sentence the
//     being reads in plain words rather than a boolean it might skip:
//       `dlmmVolumeApproximate` — all-time DLMM USD valued at CURRENT prices
//       `isFresh: false`        — some leg fell back to ZERO; a 0 here is fake
//       `circulatingIsEstimated` — market cap silently equals FDV, overstated
//   · EVERY FIGURE CARRIES ITS MOMENT. The feed's own `asOf` where it exists,
//     the read's own timestamp where it does not.
//
// Everything in this file is pure and is tested against real recorded payloads.

/** A finite number, or null. Never 0-by-accident. Pure.
 *  The pool feed publishes its figures as STRINGS ("38561.235"), so this
 *  coerces — but only a value that is actually there. */
export const figure = (raw) => {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
};

/** Sum of figures, or null when NOTHING was readable. A partial sum is honest
 *  (it says what it could read); an all-absent sum is not a zero. Pure. */
const sum = (values) => {
  const present = values.map(figure).filter((v) => v !== null);
  return present.length ? present.reduce((a, b) => a + b, 0) : null;
};

/** Epoch millis or an ISO string → ISO string. The platform publishes epoch
 *  MILLISECONDS; handing a being a raw 13-digit number invites it to read the
 *  moment as a quantity. Pure. */
export const momentOf = (at) => {
  if (typeof at === 'string') return Number.isNaN(Date.parse(at)) ? null : at;
  if (!Number.isFinite(Number(at))) return null;
  const d = new Date(Number(at));
  return Number.isNaN(d.getTime()) ? null : d.toISOString().replace(/\.\d{3}Z$/, 'Z');
};

/** The platform aggregate — /api/platform/stats. Pure. */
export const shapePlatform = (payload, readAt) => {
  const p = payload || {};
  const approximate = Boolean(p.dlmmVolumeApproximate);
  const venue = (v) => ({
    volumeAllTimeUsd: figure(v?.volumeAllTimeUsd),
    volume24hUsd: figure(v?.volume24hUsd),
    feesAllTimeUsd: figure(v?.feesAllTimeUsd),
    lpEarningsUsd: figure(v?.lpEarningsUsd),
    protocolRevenueUsd: figure(v?.protocolRevenueUsd),
    tvlUsd: figure(v?.tvlUsd),
    tradeCount: figure(v?.tradeCount),
  });
  return {
    feed: 'platform',
    asOf: momentOf(p.asOf) || readAt,
    tvlUsd: figure(p.tvlUsd),
    volume24hUsd: figure(p.volume24hUsd),
    volumeAllTimeUsd: figure(p.volumeAllTimeUsd),
    feesAllTimeUsd: figure(p.feesAllTimeUsd),
    // NOT "claimed". This is what accrued TO liquidity providers; what they
    // have actually withdrawn is a number the feed does not publish.
    lpEarningsUsd: figure(p.lpEarningsUsd),
    protocolRevenueUsd: figure(p.protocolRevenueUsd),
    protocolTakeRate: figure(p.protocolTakeRate),
    tradeCount: figure(p.tradeCount),
    byVenue: { damm: venue(p.damm), dlmm: venue(p.dlmm) },
    lock: {
      tvlUsd: figure(p.lock?.tvlUsd),
      lockedU1: figure(p.lock?.lockedU1),
      isFresh: p.lock?.isFresh === undefined ? null : Boolean(p.lock.isFresh),
    },
    approximate,
    caveats: approximate
      ? ['All-time DLMM volume, fees and LP earnings are valued at CURRENT token prices — the LB-pair subgraph stores no historical USD. Treat every all-time DLMM figure as approximate (~), never as the ledger\'s truth.']
      : [],
  };
};

/** The U1 token market — /api/base/damm/stats. Pure.
 *  This endpoint publishes no moment of its own, so the read's stamp is it. */
export const shapeToken = (payload, readAt) => {
  const p = payload || {};
  const stale = p.isFresh === false;
  const mcEstimated = Boolean(p.circulatingIsEstimated);
  const caveats = [];
  if (stale) {
    // The endpoint's own contract: isFresh:false means SOME read in the chain
    // fell back to zero or a default. Any 0 below may be a failure wearing a
    // number's clothes, and a being must not narrate it as a real figure.
    caveats.push('The platform marked this read NOT FRESH — at least one leg (reserves, token, swap aggregation, lock balances, or the WETH price) fell back to zero or a default. Any zero in this response may be a failed read rather than a real value. Say so rather than reporting the number.');
  }
  if (mcEstimated) {
    caveats.push('Circulating supply is ESTIMATED, so marketCapUsd silently equals fdvUsd and is overstated. Quote FDV, or say the market cap is an upper bound.');
  }
  return {
    feed: 'token',
    symbol: 'U1',
    asOf: readAt,
    priceUsd: figure(p.priceU1Usd),
    priceWeth: figure(p.priceU1Weth),
    change24hPct: figure(p.change24hPct),
    marketCapUsd: figure(p.marketCapUsd),
    fdvUsd: figure(p.fdvUsd),
    circulatingSupply: figure(p.circulatingSupply),
    totalSupply: figure(p.totalSupply),
    volume24hUsd: figure(p.volume24hUsd),
    poolTvlUsd: figure(p.tvlUsd),
    aprPct: figure(p.aprPct),
    feeBps: figure(p.feeBps),
    wethUsd: figure(p.wethUsd),
    lifetimeVolumeUsd: figure(p.lifetimeVolumeUsd),
    lifetimeFeesUsd: figure(p.lifetimeFeesUsd),
    lifetimeSwapCount: figure(p.lifetimeSwapCount),
    isFresh: p.isFresh === undefined ? null : Boolean(p.isFresh),
    circulatingIsEstimated: mcEstimated,
    caveats,
  };
};

/** One token-pair group folded across its pools. Pure.
 *  `marketCap` on the group is tokenX's; the pools each carry their own
 *  liquidity, so TVL/volume/fees/trades fold by summation. */
const shapeGroup = (g) => {
  const pairs = Array.isArray(g?.pairs) ? g.pairs : [];
  return {
    pair: g?.name || null,
    token: g?.tokenX || null,
    quote: g?.tokenY || null,
    tokenAddress: g?.mint_x || null,
    priceUsd: figure(g?.tokenXPrice),
    marketCapUsd: figure(g?.marketCap),
    change24hPct: figure(g?.priceChange24h),
    tvlUsd: sum(pairs.map((x) => x?.liquidity)),
    volume24hUsd: sum(pairs.map((x) => x?.trade_volume_24h)),
    volumeAllTimeUsd: sum(pairs.map((x) => x?.volume_all_time_usd)),
    feesAllTimeUsd: sum(pairs.map((x) => x?.total_fees_usd)),
    tradeCount: sum(pairs.map((x) => x?.trade_count)),
    poolCount: pairs.length,
  };
};

/** Per-token pool figures — /api/base/dlmm/pools. Pure.
 *  Sorted by TVL so the being reads the platform's real weight first, and the
 *  icon URLs / bin ids the UI needs are dropped: they are pure noise in a
 *  reasoning context and they are most of the payload's bytes. */
export const shapePools = (payload, readAt) => {
  const groups = Array.isArray(payload?.groups) ? payload.groups : [];
  const tokens = groups.map(shapeGroup)
    .sort((a, b) => (b.tvlUsd ?? -1) - (a.tvlUsd ?? -1));
  return {
    feed: 'pools',
    asOf: readAt,
    tokenCount: tokens.length,
    tokens,
    caveats: ['These are DLMM pool figures only — a token\'s DAMM-side liquidity is not folded in here. `tvlUsd` is pool liquidity for this pair, not the token\'s total value locked across the platform.'],
  };
};
