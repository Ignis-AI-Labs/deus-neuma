// platform-stats.js — real Umbrae platform numbers, turned into card-ready
// facts without ever claiming more precision than the source does.
//
// Design note, 2026-08-29: […] There is no key
// to manage: `GET /api/platform/stats` is deliberately public — its own header
// says […]
//
// THE HONESTY RULES, and they are the whole point of this module:
//   · The endpoint publishes `dlmmVolumeApproximate`, which is TRUE today: DLMM
//     all-time USD is valued at CURRENT token prices because the LB-pair
//     subgraph stores no historical USD. Every figure that flag touches is
//     carried as approximate all the way to the pixel, in the platform's own
//     register — a `~` figure never claims the ledger's truth.
//   · `lpEarningsUsd` is what ACCRUED to liquidity providers, NOT what they
//     CLAIMED. Those are different sentences and only one of them is true, so
//     the label says "earned". A claims figure does not exist yet.
//   · A stat the feed does not carry has NO fallback and NO zero. It refuses.
//     A marketing card drawing an invented zero is worse than no card.
//
// Only `fetchPlatformStats` touches the network. Everything else is pure and is
// tested against the real recorded payload.

// The host pin and the guarded GET moved to platform-feed/platform-feed-read.js
// (2026-08-30) when the being-facing `platform_data` tool landed and needed the
// same door. Two clients pinning the same hosts in two files is two walls that
// can drift apart; this is one wall with two callers. The exported names here
// are unchanged — card-tool.js, scripts/render-card.mjs and this module's tests
// keep pointing at them.
import { permittedFeedUrl, getGuardedJson } from '../platform-feed/platform-feed-read.js';

/** Is this a URL this client is permitted to read? (pure) */
export const permittedStatsUrl = permittedFeedUrl;

/** The live aggregate, read PER CALL — the same env-door doctrine the social
 *  lane already keeps (x-reader's `apiRoot()`): a test points the REAL client
 *  at a real loopback server, and production never sets the override. Read at
 *  module load instead, the value freezes before any test can move it.
 *  ⚠️ `umbrae.io` 307s to `www.umbrae.io` — redirects must be followed or the
 *  body arrives empty. */
export const statsUrl = () => process.env.NEUMA_PLATFORM_STATS_URL || 'https://umbrae.io/api/platform/stats';

/**
 * Read the live platform aggregate. Never throws — a marketing lane must get a
 * reason it can say out loud, not a stack trace. impure — network + clock.
 * @param {{signal?: AbortSignal, timeoutMs?: number}} [opts]
 * @returns {Promise<{ok: true, payload: object} | {ok: false, error: string}>}
 */
export const fetchPlatformStats = async (opts = {}) => {
  // This lane keeps its own noun in the refusal — "platform stats" is what a
  // marketing operator would search the logs for — so the permit check runs
  // here before the shared door, which checks again on its own account.
  const target = statsUrl();
  if (!permittedStatsUrl(target)) {
    return { ok: false, error: `refusing to read platform stats from ${target} — this client reads the platform aggregate and nothing else` };
  }
  return getGuardedJson(target, opts);
};

/** Compact money for a card frame — $172.2K, $1.4M, $581 (pure). The milestone
 *  frame holds 12 characters, so a headline figure is never written long. */
export const money = (usd) => {
  const n = Number(usd);
  if (!Number.isFinite(n)) return null;
  const sign = n < 0 ? '-' : '';
  const v = Math.abs(n);
  if (v >= 1e9) return `${sign}$${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `${sign}$${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${sign}$${(v / 1e3).toFixed(1)}K`;
  return `${sign}$${Math.round(v)}`;
};

/** Plain counts with thousands separators (pure). `null`/`''` are UNKNOWN, not
 *  zero — Number(null) is 0, and a helper that quietly turns […] into "0" breaks the one rule this module exists to keep. */
export const count = (n) => {
  if (n === null || n === undefined || n === '') return null;
  return Number.isFinite(Number(n)) ? Number(n).toLocaleString('en-US') : null;
};

// The facts a card may draw, each naming its own label and whether the SOURCE
// calls it approximate. Adding a stat here is the only thing a new stat card
// needs — the templates already take a value, a label and a moment.
const FACTS = Object.freeze({
  tvl: { label: 'total value locked on Umbrae', eyebrow: 'TOTAL VALUE LOCKED', pick: (p) => p.tvlUsd, format: money },
  volume24h: { label: 'traded on Umbrae in the last 24 hours', eyebrow: 'VOLUME · 24H', pick: (p) => p.volume24hUsd, format: money },
  volumeAllTime: { label: 'traded on Umbrae all time', eyebrow: 'VOLUME · ALL TIME', pick: (p) => p.volumeAllTimeUsd, format: money, approxWhen: 'dlmmVolumeApproximate' },
  feesAllTime: { label: 'in fees generated on Umbrae', eyebrow: 'FEES · ALL TIME', pick: (p) => p.feesAllTimeUsd, format: money, approxWhen: 'dlmmVolumeApproximate' },
  // NOT "claimed". This is what accrued TO liquidity providers; what they have
  // actually withdrawn is a different number the feed does not publish.
  lpEarnings: { label: 'earned by liquidity providers on Umbrae', eyebrow: 'LP EARNINGS', pick: (p) => p.lpEarningsUsd, format: money, approxWhen: 'dlmmVolumeApproximate' },
  trades: { label: 'trades settled on Umbrae', eyebrow: 'TRADES', pick: (p) => p.tradeCount, format: count },
  // Added to the route 2026-08-29 and not yet on production — absent is a real
  // possibility, and absent refuses rather than drawing a zero.
  lockedTvl: { label: 'of U1 locked in the vault', eyebrow: 'U1 LOCKED', pick: (p) => p.lock?.tvlUsd, format: money },
});

export const FACT_NAMES = Object.freeze(Object.keys(FACTS));

/**
 * One live figure, ready for a card. Pure.
 *
 * @param {object} payload the feed's own object
 * @param {string} name one of FACT_NAMES
 * @returns {{ok: true, value: string, label: string, eyebrow: string,
 *   asOf: string, approximate: boolean} | {ok: false, error: string}}
 */
export const statFact = (payload, name) => {
  const fact = FACTS[name];
  if (!fact) return { ok: false, error: `no such platform stat "${name}" — the feed carries: ${FACT_NAMES.join(', ')}` };
  const raw = fact.pick(payload || {});
  if (raw === undefined || raw === null) {
    // The one thing a marketing card must never do is invent a number. An
    // absent figure is absent — it is not zero, and it is not "coming soon".
    return { ok: false, error: `the platform feed did not carry "${name}" in this response — it is not zero, it is unknown` };
  }
  const value = fact.format(raw);
  if (value === null) return { ok: false, error: `the platform feed gave "${name}" as ${JSON.stringify(raw)}, which is not a number` };
  // The moment is DRAWN, so it arrives in the form a reader reads. The ISO
  // string stays available as `asOfIso` for anything that needs to compare or
  // sort moments — a card is not one of those things.
  const asOf = asOfLabel(payload);
  if (!asOf) return { ok: false, error: 'the platform feed carried no readable asOf — a stat card without its moment is a claim, not a fact' };
  const approximate = Boolean(fact.approxWhen && payload?.[fact.approxWhen]);
  return {
    ok: true,
    // The source's own approximation flag, carried to the pixel. `~` is this
    // platform's standing mark for an estimate.
    value: approximate ? `~${value}` : value,
    label: fact.label,
    eyebrow: fact.eyebrow,
    asOf,
    approximate,
  };
};

/** The feed's moment as an ISO string. It publishes epoch MILLISECONDS; a card
 *  that rendered that raw would print a 13-digit number. Pure. */
export const asOfIso = (payload) => {
  const at = payload?.asOf;
  if (typeof at === 'string') return Number.isNaN(Date.parse(at)) ? null : at;
  if (!Number.isFinite(Number(at))) return null;
  const d = new Date(Number(at));
  return Number.isNaN(d.getTime()) ? null : d.toISOString().replace(/\.\d{3}Z$/, 'Z');
};

/**
 * The feed's moment as it is DRAWN — […]. Pure.
 *
 * ⚠️ This exists because the same moment was being formatted in two places and
 * only one of them was pretty. The review sheet ran its own `toUTCString()`
 * dance while `statFact` handed the card the raw ISO, so a queued card printed
 * `2026-08-31T17:19:02Z` — a log line — while the sheet Founder approves from
 * showed `31 Aug 2026 10:53:03 UTC`. The reference was not showing what
 * shipped, which is the one thing a reference may never do.
 *
 * The stamp is ALWAYS exactly 24 characters, because `toUTCString` pads the
 * day. That is not a coincidence: `milestone.json` and `stat.json` both set
 * `asOf.max = 24` and their labels name this very format. The field was sized
 * for this string; it just was not being produced.
 */
export const asOfLabel = (payload) => {
  const iso = asOfIso(payload);
  if (!iso) return null;
  return new Date(iso).toUTCString().replace(/^\w+, /, '').replace(' GMT', ' UTC');
};

/**
 * A milestone card's whole data block, from one live figure. Pure.
 * @param {object} payload
 * @param {string} name
 */
export const milestoneFrom = (payload, name) => {
  const fact = statFact(payload, name);
  if (!fact.ok) return fact;
  return {
    ok: true,
    approximate: fact.approximate,
    data: {
      eyebrow: fact.eyebrow,
      value: fact.value,
      label: fact.label,
      asOf: fact.asOf,
    },
  };
};
