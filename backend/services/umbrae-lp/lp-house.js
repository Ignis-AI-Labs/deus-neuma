// lp-house.js — the addresses a house member's LP wallet may send to (Founder
// 2026-11-13: […]): every wallet of every house member the same
// operator owns (main and liquidity), the operator's own wallet, and this
// house member's operator allowlist. Each one carries a name, so a send can
// say […] instead of an address.

import { ethers } from 'ethers';
import neumaWorkspace from '../../../core/workspace/neuma-workspace.js';
import { toAllowlist } from '../../../core/wallet/spend-policy.js';
import { getAddress as identityAddress } from '../neuma-wallet.js';
import { laneName } from '../house-titles.js';
import { lpWalletAddress } from './lp-wallet.js';

/**
 * The house, as the places a send may reach. The wallet itself is left out.
 * impure — reads the owner records, keys folders and allowlist.
 *
 * @param {string} neumaId
 * @returns {Promise<Array<{address: string, name: string, lane: string|null, wallet: 'main'|'liquidity'|'operator'|'allowlist'}>>}
 */
export const houseRecipients = async (neumaId) => {
  const owner = await neumaWorkspace.readOwner(neumaId);
  if (!owner?.wallet || !ethers.isAddress(owner.wallet)) return [];
  const self = await lpWalletAddress(neumaId);
  const out = [{ address: ethers.getAddress(owner.wallet), name: 'operator', lane: null, wallet: 'operator' }];
  for (const { neumaId: lane, owner: record } of await neumaWorkspace.listNeumaByOwner(owner.wallet)) {
    const name = (await laneName(lane, record).catch(() => null)) || lane;
    const [main, liquidity] = await Promise.all([identityAddress(lane).catch(() => null), lpWalletAddress(lane).catch(() => null)]);
    if (main && ethers.isAddress(main)) out.push({ address: ethers.getAddress(main), name, lane, wallet: 'main' });
    if (liquidity) out.push({ address: ethers.getAddress(liquidity), name, lane, wallet: 'liquidity' });
  }
  const allowlist = toAllowlist(await neumaWorkspace.readSpendAllowlist(neumaId).catch(() => null));
  for (const entry of allowlist.entries) {
    if (ethers.isAddress(entry.address)) out.push({ address: ethers.getAddress(entry.address), name: entry.label || 'allowlisted', lane: null, wallet: 'allowlist' });
  }
  const seen = new Set(self ? [ethers.getAddress(self)] : []);
  return out.filter((r) => (seen.has(r.address) ? false : (seen.add(r.address), true)));
};

/**
 * The one address a send names: an address of the house, or a name — a house
 * member (its liquidity wallet when it has one, else its main), "Rugevil main",
 * "Rugevil liquidity", or "operator". Null when it names nothing in the house.
 * Pure.
 *
 * @param {Array<{address: string, name: string, lane: string|null, wallet: string}>} recipients
 * @param {string} to
 * @returns {{address: string, name: string, wallet: string}|null}
 */
export const resolveRecipient = (recipients, to) => {
  const said = String(to ?? '').trim();
  if (ethers.isAddress(said)) return recipients.find((r) => r.address === ethers.getAddress(said)) ?? null;
  const whole = recipients.filter((r) => r.name.toLowerCase() === said.toLowerCase());
  if (whole.length) return whole.find((r) => r.wallet === 'liquidity') ?? whole[0];
  const [who, which] = said.toLowerCase().split(/\s+(?=(?:main|liquidity)$)/);
  const matches = recipients.filter((r) => r.name.toLowerCase() === who || r.lane?.toLowerCase() === who);
  if (which) return matches.find((r) => r.wallet === which) ?? null;
  return matches.find((r) => r.wallet === 'liquidity') ?? matches[0] ?? null;
};
