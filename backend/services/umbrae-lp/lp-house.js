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
import { reservedNameReason } from '../../../core/birth/name-guard.js';
import { lpWalletAddress } from './lp-wallet.js';
import { lpFundsAddress } from '../agent-vault/vault-store.js';

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
  const selfFunds = await lpFundsAddress(neumaId);
  const out = [{ address: ethers.getAddress(owner.wallet), name: 'operator', lane: null, wallet: 'operator' }];
  for (const { neumaId: lane, owner: record } of await neumaWorkspace.listNeumaByOwner(owner.wallet)) {
    // A member that goes by a seat's word ("Operator") is listed by its lane id: the word stays the seat's.
    const borne = (await laneName(lane, record).catch(() => null)) || lane;
    const name = reservedNameReason(borne) ? lane : borne;
    const [main, liquidity] = await Promise.all([identityAddress(lane).catch(() => null), lpFundsAddress(lane).catch(() => null)]);
    if (main && ethers.isAddress(main)) out.push({ address: ethers.getAddress(main), name, lane, wallet: 'main' });
    if (liquidity) out.push({ address: ethers.getAddress(liquidity), name, lane, wallet: 'liquidity' });
  }
  const allowlist = toAllowlist(await neumaWorkspace.readSpendAllowlist(neumaId).catch(() => null));
  for (const entry of allowlist.entries) {
    if (ethers.isAddress(entry.address)) out.push({ address: ethers.getAddress(entry.address), name: entry.label || 'allowlisted', lane: null, wallet: 'allowlist' });
  }
  const seen = new Set([self, selfFunds].filter(Boolean).map(ethers.getAddress));
  return out.filter((r) => (seen.has(r.address) ? false : (seen.add(r.address), true)));
};

// The seat a send may name by role. It is resolved by the wallet of the owner record, never by a name.
const OPERATOR_ROLE = 'operator';

// pure — who holds an entry: a member's lane, or the one listed address.
const holderOf = (r) => r.lane ?? `${r.wallet}:${r.address}`;

/**
 * The one address a send names: an address of the house, or a name — a house
 * member (its liquidity wallet when it has one, else its main), "Rugevil main",
 * "Rugevil liquidity", or "operator". Null when it names nothing in the house.
 *
 * "operator" is the operator's own wallet and nothing else: a member or a
 * listed address that goes by that word never answers to it (audit PR600
 * P6-22). A name two holders answer to names neither: nothing is sent on a
 * guess. Pure.
 *
 * @param {Array<{address: string, name: string, lane: string|null, wallet: string}>} recipients
 * @param {string} to
 * @returns {{address: string, name: string, wallet: string}|null}
 */
export const resolveRecipient = (recipients, to) => {
  const said = String(to ?? '').trim();
  if (ethers.isAddress(said)) return recipients.find((r) => r.address === ethers.getAddress(said)) ?? null;
  const key = said.toLowerCase();
  if (key === OPERATOR_ROLE) return recipients.find((r) => r.wallet === OPERATOR_ROLE) ?? null;
  const named = recipients.filter((r) => r.wallet !== OPERATOR_ROLE);
  const answersTo = (word) => named.filter((r) => r.name.toLowerCase() === word || r.lane?.toLowerCase() === word);
  const [who, which] = key.split(/\s+(?=(?:main|liquidity)$)/);
  const whole = answersTo(key);
  const part = which ? answersTo(who) : [];
  if (new Set([...whole, ...part].map(holderOf)).size !== 1) return null;
  if (part.length) return part.find((r) => r.wallet === which) ?? null;
  return whole.find((r) => r.wallet === 'liquidity') ?? whole[0];
};
