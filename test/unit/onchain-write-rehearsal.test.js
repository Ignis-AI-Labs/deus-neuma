// On-chain WRITE-PATH rehearsal against the live post-audit Base Sepolia
// deployment — the pre-mainnet gate.
//
// Every test here drives a STATE-CHANGING contract function via
// eth_call/staticCall: the real deployed bytecode executes its full
// validation path (digest checks, SignatureChecker verification, sorting,
// write-once gates) and reports exactly what a submitted transaction would
// do — but nothing is mined, no gas is spent, no key ever leaves this
// process (wallets are fresh in-memory throwaways). This is the honest
// dry-run: a staticCall that RETURNS proves the identical transaction
// would succeed; a staticCall that reverts with a named custom error
// proves the contract rejects that input for that reason.
//
// RULE 0 posture: real chain, real bytecode, real signatures, no mocks.
// Opt-in via RUN_CHAIN_TESTS=1, or auto when BASE_SEPOLIA_RPC_URL is a
// private endpoint (see test/helpers/chain-optin.js). Public RPCs stay off.
//
// SCOPE BOUNDARY (stated so nobody over-reads a green run): eth_call
// cannot compose state across calls, so the house lifecycle SUCCESS path
// (establishHouse actually landing, then addMember/changeTitle/leaveHouse
// against the resulting state) requires a sealed neuma and lives in
// KENORIE's Foundry suite against the same source. What THIS file proves
// from the NEUMA stack is the integration seam: our JS-side bundles and
// raw-ECDSA signatures are accepted by the live contracts' SignatureChecker
// validation, and every guard we can reach fires with the right error.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { ethers } from 'ethers';
import { assembleSealBundle, attachWitnessSig } from '../../backend/services/seal-bundle.js';
import { encodeSealCalldata } from '../../backend/services/natalis-seal.js';
import { shouldRunChainTests, resolveBaseSepoliaRpc } from '../helpers/chain-optin.js';

const runChain = shouldRunChainTests();

const RPC = resolveBaseSepoliaRpc() || 'https://sepolia.base.org';
const deployment = JSON.parse(readFileSync('docs/contracts/deployments/base-sepolia.json', 'utf8'));
const NATALIS_ADDR = deployment.contracts.Natalis.address;
const HOUSE_ADDR = deployment.contracts.HouseRegistry.address;
const CHAIN_ID = deployment.chainId;

const natalisAbi = JSON.parse(readFileSync('docs/contracts/abis/base/Natalis.json', 'utf8')).abi;
const houseAbi = JSON.parse(readFileSync('docs/contracts/abis/base/HouseRegistry.json', 'utf8')).abi;

// Raw ECDSA over an already-EIP-191-wrapped digest — the signing method the
// contracts document for EOA signers (signMessage would double-wrap).
const rawSign = (wallet, digest) => new ethers.SigningKey(wallet.privateKey).sign(digest).serialized;

// A fresh throwaway as a plain ethers.Wallet — createRandom() returns an
// HDNodeWallet, which record-crypto's `instanceof ethers.Wallet` branch
// doesn't accept; the platform's real callers hold plain Wallets too.
const freshWallet = () => new ethers.Wallet(ethers.Wallet.createRandom().privateKey);

// staticCall and decode the custom error the live contract reverted with.
// Returns { ok: true } on success or { ok: false, error: '<ErrorName>' }.
const dryRun = async (contract, method, args) => {
  try {
    await contract[method].staticCall(...args);
    return { ok: true };
  } catch (err) {
    // ethers v6 surfaces eth_call revert data at err.data (or nested for
    // some transports); parse it against the contract's own interface so
    // the assertion names the CONTRACT's error, not an ethers guess.
    const data = err.data ?? err.info?.error?.data ?? null;
    const parsed = data ? contract.interface.parseError(data) : null;
    return { ok: false, error: parsed ? parsed.name : `unparsed:${err.shortMessage || err.message}` };
  }
};

// Synthetic genesis fields for a throwaway identity. The chosenName makes
// the intent unmistakable if a bundle ever escaped into a real submission —
// but none can: no test here holds a funded key.
const rehearsalDna = (beingWallet, witnessWallet) => ({
  birthMoment: '2026-07-10T12:00:00.000Z',
  capturedAt: '2026-07-10T12:00:01.000Z',
  chosenName: 'ONCHAIN-WRITE-REHEARSAL',
  house: 'rehearsal',
  soulAddress: beingWallet.address,
  soulMark: 'REHEARSAL',
  substrate: { vendor: 'test', model: 'test', fullModelId: 'test/rehearsal', harness: 'vitest' },
  witnessAddress: witnessWallet.address,
  witnessKind: 'ai',
});

describe.skipIf(!runChain)('Natalis seal() write path — live dry-run (opt-in)', () => {
  const provider = new ethers.JsonRpcProvider(RPC);
  const natalis = new ethers.Contract(NATALIS_ADDR, natalisAbi, provider);

  const freshBundle = async () => {
    const being = freshWallet();
    const witness = freshWallet();
    const bundle = await assembleSealBundle({
      dnaFields: rehearsalDna(being, witness),
      beingWallet: being,
      witnessWallet: witness,
      chainId: CHAIN_ID,
      natalisAddress: NATALIS_ADDR,
    });
    return { being, witness, bundle };
  };

  const sealArgs = (b) => [
    b.genesisHash, b.soulAddress, b.selfSig, b.witnessAddress, b.witnessSig, b.schemaVersion, b.record,
  ];

  it('a full assembleSealBundle output SUCCEEDS as a seal() transaction (the genesis-seal go signal)', async () => {
    const { bundle } = await freshBundle();
    const verdict = await dryRun(natalis, 'seal', sealArgs(bundle));
    // ok:true == the live contract ran BOTH SignatureChecker validations,
    // the write-once gates, and every input guard, and would mine this tx.
    expect(verdict).toEqual({ ok: true });
  }, 30000);

  it('a TWO-PHASE desk-shaped bundle SUCCEEDS as raw calldata (the in-app birth-seal go signal)', async () => {
    // The exact shape the Electron desk drives: the backend assembles with
    // the witness ADDRESS only (key never present), the desk wallet
    // personal_signs the inner payload, attachWitnessSig verifies the
    // recovery, encodeSealCalldata produces the tx data, and the wallet
    // broadcasts it as a plain {to, data} transaction. eth_call over that
    // same raw calldata runs the live contract's full validation path.
    const being = freshWallet();
    const witness = freshWallet();
    const partial = await assembleSealBundle({
      dnaFields: rehearsalDna(being, witness),
      beingWallet: being,
      witnessAddress: witness.address,
      chainId: CHAIN_ID,
      natalisAddress: NATALIS_ADDR,
    });
    expect(partial.witnessSig).toBeNull();
    const witnessSig = await witness.signMessage(ethers.getBytes(partial.innerPayload));
    const bundle = attachWitnessSig(partial, witnessSig);
    const data = encodeSealCalldata(bundle);
    // A call that RETURNS proves the identical desk-broadcast tx would mine.
    await expect(provider.call({ to: NATALIS_ADDR, data })).resolves.toBeDefined();
  }, 30000);

  it('a tampered selfSig is rejected with InvalidSelfSignature', async () => {
    const { bundle } = await freshBundle();
    // flip the low byte of r — structurally valid sig, wrong signer
    const bad = bundle.selfSig.slice(0, 4) + (bundle.selfSig[4] === '0' ? '1' : '0') + bundle.selfSig.slice(5);
    const verdict = await dryRun(natalis, 'seal', sealArgs({ ...bundle, selfSig: bad }));
    expect(verdict).toEqual({ ok: false, error: 'InvalidSelfSignature' });
  }, 30000);

  it('a witnessSig from the wrong party is rejected with InvalidWitnessSignature', async () => {
    const { bundle } = await freshBundle();
    // Sign the SAME digest with an imposter key — the claimed witness and
    // digest stay intact (selfSig still verifies), so the failure isolates
    // to the witness check. (Swapping witnessAddress instead would change
    // the digest itself and trip InvalidSelfSignature first — the digest
    // binds the witness, which is its own guarantee.)
    const imposter = freshWallet();
    const badWitnessSig = rawSign(imposter, bundle.digest);
    const verdict = await dryRun(natalis, 'seal', sealArgs({ ...bundle, witnessSig: badWitnessSig }));
    expect(verdict).toEqual({ ok: false, error: 'InvalidWitnessSignature' });
  }, 30000);

  it('soul == witness is rejected with SoulIsWitness (dual-authorization cannot collapse to one party)', async () => {
    const being = freshWallet();
    // Bypass assembleSealBundle (it would refuse) — hand-build the call so
    // the CONTRACT's own guard is what we exercise.
    const verdict = await dryRun(natalis, 'seal', [
      ethers.keccak256(ethers.toUtf8Bytes('rehearsal')), being.address, '0x00', being.address, '0x00', 1, 'x',
    ]);
    expect(verdict).toEqual({ ok: false, error: 'SoulIsWitness' });
  }, 30000);
});

describe.skipIf(!runChain)('HouseRegistry establishHouse — live signature-seam dry-run (opt-in)', () => {
  const provider = new ethers.JsonRpcProvider(RPC);
  const house = new ethers.Contract(HOUSE_ADDR, houseAbi, provider);
  const KIND = { Witness: 0, Neuma: 1 };

  // Two throwaways sorted ascending (the contract requires strictly
  // ascending member order). kinds/titles stay parallel to the sort.
  const foundingParty = () => {
    const a = freshWallet();
    const b = freshWallet();
    const [w1, w2] = a.address.toLowerCase() < b.address.toLowerCase() ? [a, b] : [b, a];
    return { members: [w1, w2], kinds: [KIND.Witness, KIND.Neuma], titles: ['Helm', 'Wright'] };
  };

  it('valid founding signatures pass SignatureChecker and reach the Natalis gate (NeumaNotSealed)', async () => {
    const { members, kinds, titles } = foundingParty();
    const name = 'onchain-write-rehearsal';
    const addrs = members.map((w) => w.address);
    // The contract's own view is the digest source of truth (binds chainid +
    // proxy address + exact name + party) — then each member signs RAW.
    const digest = await house.foundingDigest(name, addrs, kinds, titles);
    const sigs = members.map((w) => rawSign(w, digest));
    const verdict = await dryRun(house, 'establishHouse', [name, addrs, kinds, titles, sigs]);
    // NeumaNotSealed — NOT MemberDidNotSign — is the pass signal for the
    // signature seam: the contract validates signatures BEFORE it checks
    // the Neuma member against Natalis, so reaching NeumaNotSealed proves
    // both raw-ECDSA signatures verified against the live SignatureChecker
    // path. (The success tail from here — a sealed neuma founding a real
    // house — is Foundry-covered in KENORIE and exercised at the first
    // witnessed founding.)
    expect(verdict).toEqual({ ok: false, error: 'NeumaNotSealed' });
  }, 30000);

  it('a corrupted member signature is rejected with MemberDidNotSign', async () => {
    const { members, kinds, titles } = foundingParty();
    const name = 'onchain-write-rehearsal';
    const addrs = members.map((w) => w.address);
    const digest = await house.foundingDigest(name, addrs, kinds, titles);
    const other = freshWallet();
    const sigs = [rawSign(members[0], digest), rawSign(other, digest)]; // second sig from a non-member
    const verdict = await dryRun(house, 'establishHouse', [name, addrs, kinds, titles, sigs]);
    expect(verdict).toEqual({ ok: false, error: 'MemberDidNotSign' });
  }, 30000);

  it('unsorted members are rejected with MembersNotSortedOrUnique', async () => {
    const { members, kinds, titles } = foundingParty();
    const name = 'onchain-write-rehearsal';
    const addrs = [members[1].address, members[0].address]; // deliberately descending
    const digest = await house.foundingDigest(name, addrs, kinds, titles);
    const sigs = [rawSign(members[1], digest), rawSign(members[0], digest)];
    const verdict = await dryRun(house, 'establishHouse', [name, addrs, kinds, titles, sigs]);
    expect(verdict).toEqual({ ok: false, error: 'MembersNotSortedOrUnique' });
  }, 30000);

  it('digest views for the consensus lifecycle answer from the live proxy (changeDigest, leaveDigest)', async () => {
    // The lifecycle functions (addMember/removeMember/changeTitle/leaveHouse)
    // all authorize against these two views. Answering with well-formed
    // 32-byte digests from the LIVE proxy proves the view surface our
    // signing flows depend on is reachable and bound to this deployment.
    const houseId = await house.houseIdOf('onchain-write-rehearsal');
    expect(houseId).toMatch(/^0x[0-9a-f]{64}$/);
    const change = await house.changeDigest(houseId, 0, '0x', 0);
    const leave = await house.leaveDigest(houseId, 0);
    expect(change).toMatch(/^0x[0-9a-f]{64}$/);
    expect(leave).toMatch(/^0x[0-9a-f]{64}$/);
    expect(change).not.toBe(leave);
  }, 30000);
});
