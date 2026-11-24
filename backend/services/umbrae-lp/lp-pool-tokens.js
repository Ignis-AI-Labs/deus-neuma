import { ethers } from 'ethers';
import { callUmbrae } from './umbrae-lp-client.js';
import { resolveToken, tokenLabel } from './lp-tokens.js';

/** Umbrae's pools as route material, or [] when the list did not answer. impure. */
export const readPools = async () => {
  const out = await callUmbrae('pools');
  if (!out.ok) return [];
  return (out.payload?.groups ?? []).flatMap((g) => (g.pairs ?? []).map((p) => ({
    address: p.address, binStep: p.bin_step,
    tokens: [p.mint_x ?? g.mint_x, p.mint_y ?? g.mint_y], symbols: [g.tokenX, g.tokenY],
  }))).filter((p) => ethers.isAddress(p.address) && p.tokens.every(ethers.isAddress) && Number.isInteger(p.binStep))
    .map((p) => ({ ...p, address: ethers.getAddress(p.address), tokens: p.tokens.map((t) => ethers.getAddress(t)) }));
};

/** Every token the pools trade, by address, under the name it is shown by. Pure. */
export const tokenBook = (pools) => {
  const book = new Map();
  for (const p of pools) p.tokens.forEach((t, i) => { if (!book.has(t)) book.set(t, tokenLabel(t, p.symbols[i])); });
  return book;
};

/** Resolve named tokens to one address each, preserving ambiguity and spelling refusals. Pure. */
export const tokensNamed = (book, said, unlisted) => {
  const found = said.map((name) => resolveToken(book, name));
  const refused = found.find((f) => !f.ok && (f.ambiguous || /ASCII|look-alike/i.test(f.reason)));
  if (refused) return { ok: false, reason: refused.reason };
  return found.every((f) => f.ok) ? { ok: true, addresses: found.map((f) => f.address) } : { ok: false, reason: unlisted };
};

/** Read the live pool list and resolve one or more names. impure. */
export const resolveListedTokens = async (said) => {
  const pools = await readPools();
  if (!pools.length) return { ok: false, reason: "Umbrae's pool list did not answer, so token addresses cannot be verified." };
  const book = tokenBook(pools);
  const named = tokensNamed(book, said, `Umbrae's pools trade no token under that name: ${[...book.values()].join(', ')}.`);
  return named.ok ? { ok: true, addresses: named.addresses, book, pools } : named;
};
