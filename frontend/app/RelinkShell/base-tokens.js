// base-tokens.js — curated Base-mainnet ERC-20s the wallet reads balances for.
//
// Every address here was verified against LIVE Base (its on-chain symbol() +
// decimals() were read and matched) before being added — a wrong address would
// silently report a bogus balance. Each `coingeckoId` was verified to return a
// real price from the by-id price feed (the free tier caps the by-CONTRACT
// endpoint at 1 address/request, so we price by id instead — many ids per call).
// This is the v1 set of majors; it grows as addresses + ids are verified. A custom
// Alchemy RPC could later enumerate ARBITRARY held tokens (alchemy_getTokenBalances);
// this universal curated list also works on the public node, read in one Multicall3 call.
//
// Pure data — no I/O.

export const BASE_TOKENS = Object.freeze([
  { address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', symbol: 'USDC',  name: 'USD Coin',       decimals: 6,  coingeckoId: 'usd-coin' },
  { address: '0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA', symbol: 'USDbC', name: 'USD Base Coin',  decimals: 6,  coingeckoId: 'bridged-usd-coin-base' },
  { address: '0x4200000000000000000000000000000000000006', symbol: 'WETH',  name: 'Wrapped Ether',  decimals: 18, coingeckoId: 'weth' },
  { address: '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb', symbol: 'DAI',   name: 'Dai Stablecoin', decimals: 18, coingeckoId: 'dai' },
  { address: '0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42', symbol: 'EURC',  name: 'Euro Coin',      decimals: 6,  coingeckoId: 'euro-coin' },
  { address: '0x940181a94A35A4569E4529A3CDfB74e38FD98631', symbol: 'AERO',  name: 'Aerodrome',      decimals: 18, coingeckoId: 'aerodrome-finance' },
].map(Object.freeze));
