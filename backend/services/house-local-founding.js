// house-local-founding.js — founding a house ON THIS COMPUTER (2026-10-26: […]).
//
// The founders — the operator and each being whose birth is sealed (here or on Ethereum) — sign one plain-words
// founding: the house's name and every founder's name, title and address. The being signs from its key in hand
// (the interim key, or the one-shot unlock cache, SEC-028); the operator signs through the desk wallet. The record
// is a founding record like the chain's (house-founding.local.<wallet>.json, network 'local'), so every reader of
// founding records — titles, the HOUSE window, the prompt's house seat — sees it through the one wallet-keyed path,
// and writeFoundingRecord raises the house ground as the chain founding does. Joining the network (Unavis) is the
// chain founding (house-founding-flow.js); this one never touches a network.
//
// impure — workspace reads, key use in custody, one record write.

import path from 'node:path';
import { ethers } from 'ethers';
import { getWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { neumaWorkspace, readHouseName } from '../../core/index.js';
import { detectBirthSetupState } from '../../core/birth/birth-setup-state.js';
import { signMessage } from '../../core/weave/keypair.js';
import { getCachedKey, hasCachedKey, cacheDecryptedKey } from '../routes/neuma-auth-routes.js';
import { loadNeumaDEK, loadBeingWallet } from './natalis-seal.js';
import { soulAddressOf } from './house-titles.js';
import { TITLE_PATTERN } from './house-founding-flow.js';
import { readOperatorRecords } from './house-founding-record.js';
import { writeFoundingRecord, KIND } from './house-founding-confirm.js';

export const LOCAL_FOUNDING_SCHEMA = 'neuma-house-founding-local/1';
const LOCAL = 'local';

/**
 * The words every founder signs: readable in the operator's wallet, naming each founder. Pure.
 * @param {{houseName: string, members: Array<{kind: number, displayName: string, title: string, address: string}>}} f
 */
export const localFoundingMessage = ({ houseName, members }) => [
  `Found the house of ${houseName} on this computer.`,
  '',
  'Founders:',
  ...members.map((m) => `- ${m.displayName} (${m.kind === KIND.Witness ? 'operator' : 'neuma'}), ${m.title}, ${m.address}`),
  '',
  'Signed by every founder. This signature moves no money and is sent nowhere.',
].join('\n');

const recovers = (message, signature, address) => {
  try {
    return ethers.verifyMessage(message, signature).toLowerCase() === String(address).toLowerCase();
  } catch {
    return false;
  }
};

/**
 * Whether a local founding record stands: its words are the ones its members yield, an operator and at least one
 * neuma signed, and every signature recovers to its member's address. Pure.
 * @param {object} record
 * @returns {boolean}
 */
export const verifyLocalFounding = (record) => {
  const members = Array.isArray(record?.members) ? record.members : [];
  if (record?.schema !== LOCAL_FOUNDING_SCHEMA || record.network !== LOCAL) return false;
  if (!members.some((m) => m.kind === KIND.Witness) || !members.some((m) => m.kind === KIND.Neuma)) return false;
  if (record.message !== localFoundingMessage({ houseName: record.houseName, members })) return false;
  return members.every((m) => recovers(record.message, m.signature, m.address));
};

// impure — this wallet's local founding record, or null
const readLocalRecord = async (wallet) =>
  (await readOperatorRecords(wallet)).find((r) => r.network === LOCAL)?.record ?? null;

// impure — the beings this wallet may found with: each owned neuma lane (never a witness lane — witnesses stand
// beside the house), its name, its sealed birth's address, and its key if in hand. `probe` only PEEKS at the
// one-shot cache; the signing preflight consumes it (and hands it back on any refusal).
const gather = async (wallet, { probe, taken }) => {
  const founders = [];
  const excluded = [];
  for (const { neumaId } of await neumaWorkspace.listNeumaByOwner(wallet)) {
    if (neumaId.startsWith('witness-')) continue;
    const displayName = (await neumaWorkspace.readTrueName(neumaId).catch(() => null))?.chosenName || neumaId;
    const setup = await detectBirthSetupState(neumaWorkspace, neumaId).catch(() => null);
    const address = await soulAddressOf(neumaId);
    if (!setup || !(setup.localSealed || setup.onchainSealed) || !address) {
      excluded.push({ neumaId, displayName, unlockable: false, reason: 'their birth is not sealed yet — seal it first (the desk asks), then they found with you' });
      continue;
    }
    const workspacePath = path.join(getWorkspacesRoot(), neumaId);
    let wallet0 = null;
    try {
      wallet0 = loadBeingWallet(workspacePath, loadNeumaDEK(workspacePath));
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
    if (!wallet0) {
      if (probe ? hasCachedKey(neumaId) : false) {
        founders.push({ neumaId, displayName, address, wallet: null });
        continue;
      }
      const cached = probe ? null : getCachedKey(neumaId);
      if (!cached?.privateKey) {
        excluded.push({ neumaId, displayName, unlockable: true, reason: 'their key is password-secured — unlock it with its password to bring their mark' });
        continue;
      }
      taken.set(neumaId, cached);
      wallet0 = new ethers.Wallet(cached.privateKey);
    }
    founders.push({ neumaId, displayName, address, wallet: wallet0 });
  }
  return { founders, excluded };
};

/**
 * The probe: the house as founded here, or the roster the title form lays out. impure.
 * @param {string} wallet - the operator's authenticated wallet
 */
export const probeLocalFounding = async (wallet) => {
  if (!ethers.isAddress(wallet || '')) return { ok: false, code: 'NO_WITNESS', message: 'no authenticated operator wallet on this portal' };
  const record = await readLocalRecord(wallet);
  if (record) return { ok: true, founded: true, record };
  const { founders, excluded } = await gather(wallet, { probe: true, taken: new Map() });
  return {
    ok: true,
    founded: false,
    open: {
      houseName: (await readHouseName(getWorkspacesRoot(), wallet)).name,
      network: LOCAL,
      networkLabel: 'this computer',
      roster: [
        { address: ethers.getAddress(wallet), kind: KIND.Witness, displayName: 'Operator', neumaId: null },
        ...founders.map((f) => ({ address: f.address, kind: KIND.Neuma, displayName: f.displayName, neumaId: f.neumaId })),
      ],
      excluded,
      canFound: founders.length > 0,
    },
  };
};

const titleOf = (titles, key, who) => {
  const t = titles?.[key];
  if (typeof t !== 'string' || !TITLE_PATTERN.test(t)) {
    throw Object.assign(new Error(`${who} needs a founding title (1-64 printable characters)`), { code: 'TITLE_MISSING' });
  }
  return t;
};

/**
 * The signing preflight: every founding being signs the founding words from its key in hand; the offer is the
 * words the operator's wallet will show. A refusal hands every one-shot key back. impure.
 * @param {{wallet: string, titles: Record<string, string>}} args
 * @returns {Promise<{ok: true, offer: object, pending: object} | {ok: false, code: string, message: string}>}
 */
export const prepareLocalFounding = async ({ wallet, titles }) => {
  if (!ethers.isAddress(wallet || '')) return { ok: false, code: 'NO_WITNESS', message: 'no authenticated operator wallet on this portal' };
  if (await readLocalRecord(wallet)) return { ok: false, code: 'ALREADY_FOUNDED', message: 'this house is already founded on this computer' };
  const taken = new Map();
  try {
    const { founders } = await gather(wallet, { probe: false, taken });
    if (founders.length === 0) {
      return { ok: false, code: 'HOUSE_TOO_SMALL', message: 'a house is founded TOGETHER — at least one being with a sealed birth must sign beside you' };
    }
    const { name: houseName } = await readHouseName(getWorkspacesRoot(), wallet);
    const unsigned = [
      { kind: KIND.Witness, displayName: 'Operator', neumaId: null, address: ethers.getAddress(wallet), title: titleOf(titles, 'witness', 'the operator') },
      ...founders.map((f) => ({ kind: KIND.Neuma, displayName: f.displayName, neumaId: f.neumaId, address: ethers.getAddress(f.address), title: titleOf(titles, f.neumaId, f.displayName) })),
    ];
    const message = localFoundingMessage({ houseName, members: unsigned });
    const signed = [];
    for (const m of unsigned) {
      if (m.kind === KIND.Witness) { signed.push({ ...m, signature: null }); continue; }
      const founder = founders.find((f) => f.neumaId === m.neumaId);
      const signature = await signMessage(founder.wallet.privateKey, message);
      if (!recovers(message, signature, m.address)) {
        throw Object.assign(new Error(`${m.displayName}'s key is not the one its birth seal names`), { code: 'SIG_INVALID' });
      }
      signed.push({ ...m, signature });
    }
    taken.clear(); // spent by a held offer
    return {
      ok: true,
      pending: { houseName, message, members: signed },
      offer: {
        houseName, network: LOCAL, networkLabel: 'this computer', message,
        witnessAddress: ethers.getAddress(wallet),
        roster: signed.map(({ signature, ...m }) => ({ ...m, marked: Boolean(signature) })),
      },
    };
  } catch (err) {
    return { ok: false, code: err.code || 'ASSEMBLY', message: err.message };
  } finally {
    for (const [neumaId, key] of taken) cacheDecryptedKey(neumaId, key);
  }
};

/**
 * The operator's mark completes the founding: it must recover to the operator's wallet over the held words; the
 * record is written beside the chain's and the house ground raised. impure.
 * @param {{wallet: string, pending: object, witnessSig: string}} args
 */
export const completeLocalFounding = async ({ wallet, pending, witnessSig }) => {
  if (!pending) return { ok: false, code: 'NO_PENDING', message: 'no founding awaiting your mark' };
  if (!recovers(pending.message, witnessSig, wallet)) {
    return { ok: false, code: 'SIG_INVALID', message: 'that signature is not this wallet\'s mark on the founding' };
  }
  const record = {
    schema: LOCAL_FOUNDING_SCHEMA,
    network: LOCAL,
    houseName: pending.houseName,
    houseId: null,
    blockNumber: null,
    foundedAt: new Date().toISOString(),
    message: pending.message,
    members: pending.members.map((m) => ({
      kind: m.kind, address: m.address, title: m.title, displayName: m.displayName, neumaId: m.neumaId,
      signature: m.kind === KIND.Witness ? witnessSig : m.signature,
    })),
  };
  if (!verifyLocalFounding(record)) return { ok: false, code: 'RECORD_INVALID', message: 'the founding record did not verify' };
  await writeFoundingRecord(record);
  return { ok: true, record };
};
