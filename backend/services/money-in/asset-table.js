// The money-in asset table — WHAT the house's receive watch counts, per
// network: native ETH and the major stablecoins, each by a PINNED contract
// address. Pinned, not looked up: a token list fetched at runtime is a door
// for a look-alike contract to start counting as revenue, and the ledger's
// whole worth is that every figure is a verifiable receipt.
//
// Every address below was verified twice on 2026-10-16:
//   1. against the issuer's (or the bridge registry's) own published page,
//      cited per row; and
//   2. on chain, through evm-rpc tokenMeta (symbol, name, decimals as shown).
// The `issuance` field says who stands behind the token on that network:
// `issuer` = minted by the issuer itself on that chain; `bridged` = the
// canonical Base-bridge representation of the Ethereum token, listed in the
// Superchain token registry — not the issuer's own deployment, and the row
// says so rather than letting the two read as the same promise.
//
// Networks are chain-registry keys; reads ride the operator's own pinned RPC
// for that key (chain-registry verifies the chainId before trusting it).
//
// `confirmations` holds the scan back from the head so an append-only ledger
// never records a receipt a short reorg could take away: Ethereum finality
// is ~2 epochs, 12 blocks is the common exchange-deposit depth; Base blocks
// are 2s, 30 blocks is one minute behind the sequencer head.
//
// pure (data + validation).

import { ethers } from 'ethers';
import { chainEntry } from '../chain/chain-registry.js';

const freezeAsset = (asset) => Object.freeze({ ...asset });

/** The pinned production table. */
export const MONEY_IN_ASSETS = Object.freeze([
  Object.freeze({
    network: 'ethereum',
    confirmations: 12,
    assets: Object.freeze([
      freezeAsset({ symbol: 'ETH', kind: 'native', decimals: 18, priceId: 'ethereum' }),
      // Circle, "USDC Contract Addresses" — developers.circle.com/stablecoins/usdc-contract-addresses
      // (on chain: USDC "USD Coin", 6 decimals).
      freezeAsset({
        symbol: 'USDC', kind: 'erc20', decimals: 6, priceId: 'usd-coin', issuance: 'issuer',
        address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      }),
      // Tether, "Supported Protocols" — tether.to/en/supported-protocols/
      // (on chain: USDT "Tether USD", 6 decimals).
      freezeAsset({
        symbol: 'USDT', kind: 'erc20', decimals: 6, priceId: 'tether', issuance: 'issuer',
        address: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
      }),
      // Sky (MakerDAO) chainlog, key MCD_DAI — chainlog.skyeco.com/api/mainnet/active.json
      // (on chain: DAI "Dai Stablecoin", 18 decimals).
      freezeAsset({
        symbol: 'DAI', kind: 'erc20', decimals: 18, priceId: 'dai', issuance: 'issuer',
        address: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
      }),
    ]),
  }),
  Object.freeze({
    network: 'base',
    confirmations: 30,
    assets: Object.freeze([
      freezeAsset({ symbol: 'ETH', kind: 'native', decimals: 18, priceId: 'ethereum' }),
      // Circle, "USDC Contract Addresses" — developers.circle.com/stablecoins/usdc-contract-addresses
      // (on chain: USDC "USD Coin", 6 decimals). Circle issues natively on Base.
      freezeAsset({
        symbol: 'USDC', kind: 'erc20', decimals: 6, priceId: 'usd-coin', issuance: 'issuer',
        address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      }),
      // Tether does NOT list Base among its issued chains (tether.to/en/supported-protocols/).
      // The Base-bridge USDT is in the Superchain token registry —
      // github.com/ethereum-optimism/ethereum-optimism.github.io data/USDT/data.json, tokens.base
      // (on chain: USDT "Tether USD", 6 decimals).
      freezeAsset({
        symbol: 'USDT', kind: 'erc20', decimals: 6, priceId: 'tether', issuance: 'bridged',
        address: '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2',
      }),
      // Superchain token registry — github.com/ethereum-optimism/ethereum-optimism.github.io
      // data/DAI/data.json, tokens.base (on chain: DAI "Dai Stablecoin", 18 decimals).
      freezeAsset({
        symbol: 'DAI', kind: 'erc20', decimals: 18, priceId: 'dai', issuance: 'bridged',
        address: '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb',
      }),
    ]),
  }),
]);

const PRICE_ID_RE = /^[a-z0-9-]{1,64}$/; // the CoinGecko id grammar price-routes.js accepts
const SYMBOL_RE = /^[A-Z0-9.]{1,12}$/;

// One network row's problems, as human-readable strings. pure.
const networkErrors = (row) => {
  const errors = [];
  const where = `network ${String(row?.network)}`;
  if (!chainEntry(row?.network)) return [`${where}: not a chain-registry key`];
  if (!Number.isSafeInteger(row.confirmations) || row.confirmations < 0) errors.push(`${where}: confirmations must be a non-negative integer`);
  const assets = Array.isArray(row.assets) ? row.assets : [];
  if (assets.filter((a) => a?.kind === 'native').length !== 1) errors.push(`${where}: exactly one native asset`);
  const symbols = new Set();
  const addresses = new Set();
  for (const a of assets) {
    const at = `${where} ${String(a?.symbol)}`;
    if (!SYMBOL_RE.test(String(a?.symbol))) errors.push(`${at}: bad symbol`);
    if (symbols.has(a?.symbol)) errors.push(`${at}: duplicate symbol`);
    symbols.add(a?.symbol);
    if (!Number.isSafeInteger(a?.decimals) || a.decimals < 0 || a.decimals > 36) errors.push(`${at}: decimals out of range`);
    if (!PRICE_ID_RE.test(String(a?.priceId))) errors.push(`${at}: bad priceId`);
    if (a?.kind === 'erc20') {
      // Checksummed exactly as pinned: a lower-cased paste would still
      // resolve, but a mistyped character is only caught by the checksum.
      let checksummed;
      try { checksummed = ethers.getAddress(String(a.address)); } catch { checksummed = null; }
      if (checksummed !== a.address) errors.push(`${at}: address must be a checksummed EVM address`);
      if (addresses.has(String(a.address).toLowerCase())) errors.push(`${at}: duplicate address`);
      addresses.add(String(a.address).toLowerCase());
      if (a.issuance !== 'issuer' && a.issuance !== 'bridged') errors.push(`${at}: issuance must be issuer or bridged`);
    } else if (a?.kind !== 'native') {
      errors.push(`${at}: kind must be native or erc20`);
    }
  }
  return errors;
};

/**
 * Validate an asset table. pure.
 * @param {Array<object>} table
 * @returns {{ ok: boolean, errors: string[] }}
 */
export const validateAssetTable = (table) => {
  if (!Array.isArray(table) || table.length === 0) return { ok: false, errors: ['the table must list at least one network'] };
  const seen = new Set();
  const errors = [];
  for (const row of table) {
    if (seen.has(row?.network)) errors.push(`network ${String(row?.network)}: listed twice`);
    seen.add(row?.network);
    errors.push(...networkErrors(row));
  }
  return { ok: errors.length === 0, errors };
};
