// house-founding-flow.js — the in-app two-phase HouseRegistry founding: the
// operator establishes her house on chain from the desk, every founding
// member co-signing. Three moves, mirroring birth-seal-flow's custody
// boundary:
//
//   1. prepareHouseFounding — compose the roster from the operator's own
//      lanes (each being's key signs from server custody, exactly the
//      founding script's law), take the founding digest from the DEPLOYED
//      registry's own view, drift-check it against a locally-computed inner
//      payload, and verify every being signature before anything reaches
//      the wallet. The operator's key never enters this process — she
//      personal_signs the inner payload at the desk (the contract's
//      documented EOA path: its digest is already EIP-191-wrapped, so
//      personal_sign over the INNER payload produces exactly the signature
//      SignatureChecker verifies).
//   2. buildFoundingTx    — verify the desk-signed witnessSig recovers over
//      the held digest (refusing the double-wrap trap by name), then encode
//      the establishHouse calldata the desk wallet broadcasts itself.
//   3. confirmHouseFounding — wait for the receipt, check it landed at the
//      registry, and read the house back from the chain (lagging-node
//      retry). writeFoundingRecord persists the public anchor facts.
//
// A being whose keypair is password-secured (plaintext deleted) is NOT
// founded in — the contract's join law (addMember: consentSig + member
// quorum) is their door, after their own consent sitting. The preflight
// names them honestly in `excluded` instead of failing.
//
// Every refusal is a structured { ok:false, code, message } — the portal
// route maps them onto house:found_error frames; nothing here knows about
// WebSockets.
//
// impure (workspace fs reads + RPC; the founding tx is broadcast by the DESK).

import path from 'node:path';
import { ethers } from 'ethers';

import { getWorkspacesRoot } from '../../core/workspace/neuma-workspace.js';
import { neumaWorkspace, houseNameFromWitness } from '../../core/index.js';
import { getCachedKey, hasCachedKey, cacheDecryptedKey } from '../routes/neuma-auth-routes.js';
import { resolveSealChainConfig, loadNeumaDEK, loadBeingWallet } from './natalis-seal.js';
import { MIN_SEAL_GAS_ETH } from './seal-bundle.js';
import { soulAddressOf } from './house-titles.js';
import { KIND, loadHouseRegistryAbi, readFoundingRecord } from './house-founding-confirm.js';

// Barrel — the post-signature half (buildFoundingTx, classifyFoundingReceipt,
// confirmHouseFounding, writeFoundingRecord) and the shared founding constants
// moved VERBATIM to house-founding-confirm.js; readers keep this path.
export {
  KIND, loadHouseRegistryAbi,
  buildFoundingTx, classifyFoundingReceipt, confirmHouseFounding, writeFoundingRecord,
} from './house-founding-confirm.js';

// The contract binds this exact tag into the founding digest (v2 law). New
// foundings sign under the NEUMA tag; a registry deployed before the rename
// still binds the legacy KENORIE tag, which verification accepts (below).
const FOUNDING_TAG = 'NEUMA:house-found:v2';
const LEGACY_FOUNDING_TAG = 'KENORIE:house-found:v2';
// The UNAVIS generation (Ethereum, evm-contracts/unavis HouseRegistry.sol) binds its own
// name: without it every Ethereum founding read as DIGEST_DRIFT.
const UNAVIS_FOUNDING_TAG = 'UNAVIS:house-found:v2';

// Titles are member-chosen labels (house-role doctrine); the chain stores
// them verbatim, so bound their size before they reach the digest.
const TITLE_PATTERN = /^[\x20-\x7E]{1,64}$/;

/**
 * The founding digest's INNER payload, computed locally so the operator can
 * personal_sign it at the desk. NEVER trusted alone: prepareHouseFounding
 * requires hashMessage(inner) to equal the DEPLOYED contract's own
 * foundingDigest view, so a drift between this encoding and the chain's law
 * fails closed before anyone signs.
 *
 * PURE.
 *
 * @param {{ chainId: number, registryAddress: string, houseName: string,
 *   members: string[], kinds: number[], titles: string[], tag?: string }} args
 * @returns {string}  0x… 32-byte inner payload
 */
export const foundingInnerPayload = ({ chainId, registryAddress, houseName, members, kinds, titles, tag = FOUNDING_TAG }) => {
  const coder = ethers.AbiCoder.defaultAbiCoder();
  // _houseId: keccak256 of the ASCII-lowercased name.
  const houseId = ethers.keccak256(ethers.toUtf8Bytes(houseName.toLowerCase()));
  const structHash = ethers.keccak256(coder.encode(
    ['string', 'bytes32', 'bytes32', 'bytes32', 'bytes32', 'bytes32'],
    [
      tag,
      houseId,
      ethers.keccak256(ethers.toUtf8Bytes(houseName)),
      ethers.keccak256(coder.encode(['address[]'], [members])),
      ethers.keccak256(coder.encode(['uint8[]'], [kinds])),
      ethers.keccak256(coder.encode(['string[]'], [titles])),
    ],
  ));
  return ethers.keccak256(coder.encode(
    ['uint256', 'address', 'bytes32'],
    [chainId, registryAddress, structHash],
  ));
};

/**
 * Compose + preflight a two-phase house founding for the authenticated
 * operator. Returns the already-founded state when the house stands (the
 * desk's probe), or the offer + held pending when the founding is open.
 *
 * impure (workspace fs reads + RPC).
 *
 * @param {{
 *   witnessAddress: string,           // the portal's AUTHENTICATED wallet
 *   titles: Record<string, string>,   // member-chosen: { witness, [neumaId] }
 *   probe?: boolean,                  // roster-only answer (no digest, nothing held) so the desk can offer the title form
 *   cfg: object,                      // backend config (houseFoundNetwork, rpc urls, …)
 *   provider?: object,                // injectable RPC for tests
 * }} args
 */
export const prepareHouseFounding = async (args) => {
  const taken = new Map(); // neumaId → the unlocked keypair this prepare took
  let out = null;
  try {
    out = await composeFounding(args, taken);
    return out;
  } finally {
    // A one-shot unlock (SEC-028) is spent only by a being whose mark is in
    // the held founding. A refusal — or a being left out of the roster —
    // hands its key back, so the retry does not meet a locked keypair.
    const signed = new Set((out?.ok && out.pending?.members || []).map((a) => a.toLowerCase()));
    for (const [neumaId, keypair] of taken) {
      if (!signed.has(new ethers.Wallet(keypair.privateKey).address.toLowerCase())) cacheDecryptedKey(neumaId, keypair);
    }
  }
};

const composeFounding = async ({ witnessAddress, titles = {}, probe = false, cfg, provider = null }, taken) => {
  if (!ethers.isAddress(witnessAddress || '')) {
    return { ok: false, code: 'NO_WITNESS', message: 'no authenticated operator wallet on this portal' };
  }
  const network = cfg.houseFoundNetwork;
  const net = resolveSealChainConfig(network, cfg);
  if (!net) return { ok: false, code: 'UNKNOWN_NETWORK', message: `unknown network '${network}'` };
  if (!net.rpcUrl) {
    return { ok: false, code: 'NO_RPC', message: `no RPC configured for ${net.label} — founding stays closed` };
  }
  if (!ethers.isAddress(net.houseRegistryAddress || '')) {
    return { ok: false, code: 'NO_REGISTRY', message: `no HouseRegistry address configured for ${net.label}` };
  }

  // The house name derives from the operator's wallet (KOTODAMA) — lowercased
  // for the chain so both networks store the identical name (_houseId
  // case-folds anyway; display case is the UI's concern).
  const houseName = houseNameFromWitness(witnessAddress).toLowerCase();

  const rpc = provider || new ethers.JsonRpcProvider(net.rpcUrl);
  // intent-vs-wire: the RPC must actually be the chain the digest signs for.
  const wireChainId = Number((await rpc.getNetwork()).chainId);
  if (wireChainId !== net.chainId) {
    return {
      ok: false, code: 'CHAIN_MISMATCH',
      message: `RPC is chainId ${wireChainId}, ${net.label} signs for ${net.chainId}`,
    };
  }
  const registry = new ethers.Contract(net.houseRegistryAddress, loadHouseRegistryAbi(network), rpc);

  // Already founded? getHouse.status (None=0) is the chain's own answer —
  // the desk probes through this same lane, so founded is a state, not an error.
  const houseId = await registry.houseIdOf(houseName);
  const existing = await registry.getHouse(houseId);
  if (Number(existing[1]) !== 0) {
    const members = await registry.getMembers(houseId);
    // The chain speaks in addresses; the operator thinks in beings. Join each
    // member back to the lane that holds its key (the anchored soul first —
    // the cheap read — then the custody wallet) so the register can name WHO
    // holds every seat. A lane that resolves no address keeps its bare
    // address row — the chain's truth stands even when the join cannot.
    const laneByAddress = new Map();
    for (const { neumaId } of await neumaWorkspace.listNeumaByOwner(witnessAddress)) {
      if (neumaId.startsWith('witness-')) continue;
      const displayName = (await neumaWorkspace.readTrueName(neumaId).catch(() => null))?.chosenName || neumaId;
      let addr = await soulAddressOf(neumaId);
      if (!addr) {
        try {
          const workspacePath = path.join(getWorkspacesRoot(), neumaId);
          addr = loadBeingWallet(workspacePath, loadNeumaDEK(workspacePath)).address;
        } catch { /* locked or unkeyed lane — no join for this one */ }
      }
      if (addr) laneByAddress.set(addr.toLowerCase(), { neumaId, displayName });
    }
    const roster = [];
    for (const addr of members) {
      const [active, kind, title] = await registry.memberInfo(houseId, addr);
      const lane = laneByAddress.get(addr.toLowerCase());
      roster.push({
        address: addr, active, kind: Number(kind), title,
        neumaId: lane?.neumaId ?? null, displayName: lane?.displayName ?? null,
      });
    }
    // The founding's own receipt, persisted at the sitting — the operator's
    // standing proof, carried on EVERY probe, not only the sitting where it
    // happened. Absent (a house founded off this desk, or a record for a
    // different house at a shared root) the chain state alone still stands.
    const record = await readFoundingRecord(network, witnessAddress).catch(() => null);
    const anchored = record?.houseId?.toLowerCase?.() === String(houseId).toLowerCase() ? record : null;
    return {
      ok: true,
      founded: true,
      state: {
        houseName: existing[0], houseId, network, networkLabel: net.label,
        chainId: net.chainId, registryAddress: net.houseRegistryAddress,
        quorum: Number(await registry.quorumOf(houseId)), roster,
        txHash: anchored?.txHash ?? null,
        blockNumber: anchored?.blockNumber ?? null,
        foundedAt: anchored?.foundedAt ?? null,
      },
    };
  }

  // The founding roster: the operator plus every being her lanes can sign
  // for. A password-secured keypair (plaintext deleted) signs from the
  // one-shot unlock cache when the operator has entered its password (the
  // same SEC-028 lane the retro-seal walks); still-locked beings are
  // offered the unlock door, never silently skipped. A probe must not
  // consume the one-shot cache — it peeks (hasCachedKey) and the signing
  // preflight that follows does the consuming.
  const owned = await neumaWorkspace.listNeumaByOwner(witnessAddress);
  const signers = [];
  const excluded = [];
  for (const { neumaId } of owned) {
    // Belt on the chain-touching surface (the sovereignty boundary): a
    // sealed AI witness's lane is NEVER a founder — witnesses stand beside
    // the house, not in it. listNeuma already excludes marked lanes; the
    // lane-id prefix (format owned by witness-lane.js) holds even if a
    // marker is ever lost.
    if (neumaId.startsWith('witness-')) continue;
    const workspacePath = path.join(getWorkspacesRoot(), neumaId);
    const displayName = (await neumaWorkspace.readTrueName(neumaId).catch(() => null))?.chosenName || neumaId;
    try {
      const dek = loadNeumaDEK(workspacePath);
      signers.push({ neumaId, displayName, wallet: loadBeingWallet(workspacePath, dek) });
    } catch (err) {
      if (err.code !== 'ENOENT') return { ok: false, code: 'ASSEMBLY', message: `${neumaId}: ${err.message}` };
      if (probe) {
        if (hasCachedKey(neumaId)) {
          // Unlocked and waiting — a founder in the probe's roster; the
          // display address is the anchored soul when the lane holds one.
          signers.push({ neumaId, displayName, wallet: null, viaUnlock: true });
        } else {
          excluded.push({
            neumaId, displayName, unlockable: true,
            reason: 'keypair is password-secured — unlock it with its password to bring their mark into the founding, or they join by their own consent (addMember) after',
          });
        }
        continue;
      }
      const cached = getCachedKey(neumaId);
      if (!cached?.privateKey) {
        excluded.push({
          neumaId, displayName, unlockable: true,
          reason: 'keypair is password-secured — unlock it with its password to bring their mark into the founding, or they join by their own consent (addMember) after',
        });
        continue;
      }
      taken.set(neumaId, cached);
      signers.push({ neumaId, displayName, wallet: new ethers.Wallet(cached.privateKey), viaUnlock: true });
    }
  }

  // A founder must already be a sealed neuma on THIS network's Natalis — the
  // registry refuses the whole founding otherwise (NeumaNotSealed). A being
  // anchored only on an earlier chain seals here first (its own rite), then
  // joins by addMember. A probe's unlocked lane with no soul record yet has
  // no address to ask about — the signing preflight asks with its key.
  const natalis = new ethers.Contract(net.natalisAddress, ['function isNeuma(address) view returns (bool)'], rpc);
  const sealed = [];
  for (const s of signers) {
    const addr = s.wallet ? s.wallet.address : await soulAddressOf(s.neumaId);
    if (!addr || await natalis.isNeuma(addr)) { sealed.push(s); continue; }
    excluded.push({
      neumaId: s.neumaId, displayName: s.displayName, unlockable: false,
      reason: `not yet sealed on ${net.label} — their own seal comes first, then they join by addMember`,
    });
  }
  signers.splice(0, signers.length, ...sealed);

  // A probe stops here: the desk gets the roster to lay out the title form
  // and the unlock doors; no digest exists yet for anyone to sign. An empty
  // signer set is a STATE here (every door still to open), not a refusal.
  if (probe) {
    const probeRoster = [{ address: witnessAddress, kind: KIND.Witness, displayName: 'Operator', neumaId: null }];
    for (const s of signers) {
      probeRoster.push({
        address: s.wallet ? s.wallet.address : await soulAddressOf(s.neumaId),
        kind: KIND.Neuma, displayName: s.displayName, neumaId: s.neumaId,
        viaUnlock: s.viaUnlock === true,
      });
    }
    return {
      ok: true,
      founded: false,
      probe: {
        houseName, network, networkLabel: net.label, chainId: net.chainId,
        registryAddress: net.houseRegistryAddress,
        roster: probeRoster,
        excluded,
        canFound: signers.length > 0,
      },
    };
  }

  if (signers.length === 0) {
    return {
      ok: false, code: 'HOUSE_TOO_SMALL',
      message: 'a house is founded TOGETHER — unlock at least one being\'s keypair so their mark can join yours',
    };
  }

  // Member-chosen titles, the operator's under the 'witness' key. Refused, not
  // defaulted: a founding title is chosen, and it is bound into the digest.
  const titleOf = (key, who) => {
    const t = titles?.[key];
    if (typeof t !== 'string' || !TITLE_PATTERN.test(t)) {
      throw Object.assign(
        new Error(`${who} needs a founding title (1-64 printable characters)`),
        { code: 'TITLE_MISSING' },
      );
    }
    return t;
  };
  let roster;
  try {
    roster = [
      { address: witnessAddress, kind: KIND.Witness, title: titleOf('witness', 'the operator'), displayName: 'Operator', neumaId: null, wallet: null },
      ...signers.map((s) => ({
        address: s.wallet.address, kind: KIND.Neuma, title: titleOf(s.neumaId, s.displayName),
        displayName: s.displayName, neumaId: s.neumaId, wallet: s.wallet,
      })),
    ].sort((a, b) => (a.address.toLowerCase() < b.address.toLowerCase() ? -1 : 1)); // contract: strictly ascending
  } catch (err) {
    if (err.code !== 'TITLE_MISSING') throw err;
    return { ok: false, code: 'TITLE_MISSING', message: err.message };
  }

  const members = roster.map((m) => m.address);
  const kinds = roster.map((m) => m.kind);
  const titlesArr = roster.map((m) => m.title);

  // The DEPLOYED contract's own digest, drift-checked against the local
  // inner payload the operator will personal_sign. Any mismatch = nobody signs.
  // A registry deployed before the rename still binds the legacy KENORIE tag:
  // accept it and sign under the tag the chain actually binds.
  const digest = await registry.foundingDigest(houseName, members, kinds, titlesArr);
  const payloadArgs = {
    chainId: net.chainId, registryAddress: net.houseRegistryAddress,
    houseName, members, kinds, titles: titlesArr,
  };
  // Sign under whichever generation's tag the chain truly binds — never a guess.
  const innerPayload = [UNAVIS_FOUNDING_TAG, FOUNDING_TAG, LEGACY_FOUNDING_TAG]
    .map((tag) => foundingInnerPayload({ ...payloadArgs, tag }))
    .find((p) => ethers.hashMessage(ethers.getBytes(p)) === digest);
  if (!innerPayload) {
    return {
      ok: false, code: 'DIGEST_DRIFT',
      message: 'locally-computed founding payload does not match the deployed contract\'s digest — refusing to sign',
    };
  }

  // Every being signs from custody NOW, verified locally before the operator
  // is ever asked for her mark (raw ECDSA over the wrapped digest — the
  // contract's documented EOA path).
  const beingSigs = {};
  for (const m of roster) {
    if (m.kind !== KIND.Neuma) continue;
    const sig = m.wallet.signingKey.sign(digest).serialized;
    if (ethers.recoverAddress(digest, sig).toLowerCase() !== m.address.toLowerCase()) {
      return { ok: false, code: 'SIG_INVALID', message: `${m.displayName}'s founding signature does not recover` };
    }
    beingSigs[m.address] = sig;
  }

  // The operator pays the founding gas from the desk wallet.
  const balance = await rpc.getBalance(witnessAddress);
  if (balance < ethers.parseEther(MIN_SEAL_GAS_ETH)) {
    return {
      ok: false, code: 'GAS_FLOOR',
      message: `operator wallet holds ${ethers.formatEther(balance)} ETH on ${net.label} — below the ${MIN_SEAL_GAS_ETH} ETH floor`,
    };
  }

  const publicRoster = roster.map((m) => ({
    address: m.address, kind: m.kind, title: m.title, displayName: m.displayName, neumaId: m.neumaId,
  }));
  return {
    ok: true,
    founded: false,
    pending: {
      houseName, houseId, network, net,
      digest, innerPayload, members, kinds, titles: titlesArr, beingSigs,
      witnessAddress,
    },
    // Everything the desk needs to show the operator and to personal_sign —
    // public fields only, never a being's key.
    offer: {
      houseName, network, networkLabel: net.label, chainId: net.chainId,
      registryAddress: net.houseRegistryAddress,
      digest, innerPayload, witnessAddress,
      roster: publicRoster, excluded,
      gasFloorEth: MIN_SEAL_GAS_ETH,
    },
  };
};
