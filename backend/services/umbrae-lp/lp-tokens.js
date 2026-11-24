// lp-tokens.js — a token a house member names, as exactly one address.
//
// Umbrae's pool list gives every token a symbol, and a symbol is only a word:
// anyone can list a second token that calls itself WETH. So a symbol never
// resolves to […]:
//   · WETH and USDC are pinned to their own contracts on Base, and those
//     symbols mean those addresses and nothing else;
//   · any other symbol must name one listed token; two or more is refused,
//     with the addresses, so the member names the one it means;
//   · a listed token that borrows a pinned symbol is shown with its address.
//
// pure.

import { ethers } from 'ethers';

/** Base's own WETH and Circle's USDC (the money-in asset table pins the same USDC). */
export const PINNED_TOKENS = Object.freeze({
  WETH: '0x4200000000000000000000000000000000000006',
  USDC: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
});
const PINNED_SYMBOL = new Map(Object.entries(PINNED_TOKENS).map(([symbol, address]) => [address, symbol]));

const short = (address) => `${address.slice(0, 6)}…${address.slice(-4)}`;

/**
 * The name a listed token is shown under: a pinned contract always by its own
 * symbol, and another contract using a pinned symbol with its address beside it.
 * @param {string} address - checksummed
 * @param {string} [symbol] - what the pool list calls it
 * @returns {string}
 */
export const tokenLabel = (address, symbol) => {
  const pinned = PINNED_SYMBOL.get(address);
  if (pinned) return pinned;
  const said = String(symbol ?? '?');
  return Object.hasOwn(PINNED_TOKENS, said.toUpperCase()) ? `${said}@${short(address)}` : said;
};

/**
 * One listed token for what was said (a symbol or an address).
 * @param {Iterable<[string, string]>} listed - [checksummed address, symbol] for every token the pools trade
 * @param {unknown} said
 * @returns {Readonly<{ok: true, address: string} | {ok: false, ambiguous: boolean, reason: string}>}
 */
export const resolveToken = (listed, said) => {
  const tokens = [...listed];
  const word = String(said ?? '').trim();
  const none = Object.freeze({ ok: false, ambiguous: false, reason: `Umbrae's pools trade no token called "${word}".` });
  if (!ethers.isAddress(word) && /[^\x20-\x7E]/.test(word)) {
    return Object.freeze({ ok: false, ambiguous: false, reason: 'Token symbols use plain printable ASCII only; invisible, look-alike and right-to-left characters are refused. Name the token by its contract address.' });
  }
  if (ethers.isAddress(word)) {
    const address = ethers.getAddress(word);
    return tokens.some(([listedAddress]) => listedAddress === address) ? Object.freeze({ ok: true, address }) : none;
  }
  const pinned = PINNED_TOKENS[word.toUpperCase()];
  if (pinned) return tokens.some(([address]) => address === pinned) ? Object.freeze({ ok: true, address: pinned }) : none;
  const matches = [...new Set(tokens.filter(([, symbol]) => String(symbol).toLowerCase() === word.toLowerCase()).map(([address]) => address))];
  if (matches.length === 1) return Object.freeze({ ok: true, address: matches[0] });
  if (matches.length === 0 || !word) return none;
  return Object.freeze({
    ok: false, ambiguous: true,
    reason: `"${word}" names ${matches.length} different tokens in Umbrae's pools (${matches.join(', ')}). Name the one you mean by its address. Nothing was signed.`,
  });
};
