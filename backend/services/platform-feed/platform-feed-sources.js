// platform-feed-sources.js — the PINNED registry of what a being may read from
// the Umbrae platform. This file is the security boundary of the family: the
// reader (platform-feed-read.js) cannot tell a real path from an attacker's,
// so the set of readable paths is closed HERE and a feed is named, never
// composed.
//
// Membership rule, and it is the whole rule: a route enters this registry only
// if it is a PUBLIC, UNAUTHENTICATED GET that returns aggregate figures.
//
// Deliberately ABSENT, so nobody has to re-derive why:
//   · /api/token/pair-markets, /api/base/prices — session-gated. Reaching them
//     means carrying a credential, and a data feed carries no credential.
//   · /api/positions/*, /api/swap/*, /api/pools/create, /api/checkin/* — the
//     trading surface. Design note, 2026-08-30: […]
//   · /api/platform/locker-census — public, but its body is a list of real
//     holder WALLET ADDRESSES with per-address positions. Every other feed here
//     holds the […] line; that one
//     does not. The aggregate lock TVL is already inside the `platform` feed.
//     Needs the operator's word before a being reads holder-level data.
//   · /api/platform/tvl — real and public, but a strict subset of
//     /api/platform/stats. A second door onto the same numbers is a door that
//     can disagree with the first.

import { shapePlatform, shapeToken, shapePools } from './platform-feed-shape.js';

export const FEEDS = Object.freeze({
  platform: Object.freeze({
    path: '/api/platform/stats',
    shape: shapePlatform,
    summary: 'the whole platform: TVL, 24h and all-time volume, fees, LP earnings, protocol revenue, trade count, split by venue (DAMM/DLMM), plus the U1 lock vault total',
  }),
  token: Object.freeze({
    path: '/api/base/damm/stats',
    shape: shapeToken,
    summary: 'the U1 token itself: price in USD and WETH, 24h change, market cap, FDV, circulating and total supply, 24h and lifetime volume, pool TVL, LP APR',
  }),
  pools: Object.freeze({
    path: '/api/base/dlmm/pools',
    shape: shapePools,
    summary: 'every token trading on the platform: price, market cap, 24h change, pool TVL, 24h and all-time volume, fees and trade count — sorted by TVL',
  }),
});

export const FEED_NAMES = Object.freeze(Object.keys(FEEDS));

/** Resolve a caller-named feed to its pinned entry. Pure — returns null for
 *  anything not in the registry, which is how a composed path dies here. */
export const feedByName = (name) => (
  Object.prototype.hasOwnProperty.call(FEEDS, String(name)) ? FEEDS[String(name)] : null
);

/** What a being sees when it asks with no arguments. Pure. */
export const describeFeeds = () => FEED_NAMES.map((name) => `${name} — ${FEEDS[name].summary}`);
