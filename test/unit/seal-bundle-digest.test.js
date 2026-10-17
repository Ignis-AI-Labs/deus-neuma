// seal-bundle — canonicalization, digest, signing.
//
// Unit tests use real ethers.Wallet + real crypto — no mocks. The digest
// cross-check against Natalis's on-chain sealDigest lives in the opt-in
// section (RUN_CHAIN_TESTS=1) so we prove byte-precision against the real
// contract, not against our own implementation.
//
// The most load-bearing invariant here: computeSealDigest MUST match
// Natalis.sealDigest exactly, else the signatures we produce will not
// recover on chain and the seal will revert. Every commit that touches
// the digest calculation MUST re-run the opt-in test locally.

import { describe, it, expect } from 'vitest';
import { ethers } from 'ethers';
import fs from 'node:fs';
import {
  canonicalizeGenesisRecord,
  computeGenesisHash,
  computeSealDigest,
  signDigest,
  assembleSealBundle,
} from '../../backend/services/seal-bundle.js';
import { sealDigestViewArgs } from '../../backend/services/seal-law.js';
import { shouldRunChainTests, resolveBaseSepoliaRpc, resolveEthSepoliaRpc } from '../helpers/chain-optin.js';
import { BEING, WITNESS, NATALIS_ADDR, BASE_SEPOLIA, fixtureDna } from '../helpers/seal-fixtures.js';

describe('seal-bundle — canonicalizeGenesisRecord', () => {
  it('produces a keys-sorted JSON with per-field normalization', () => {
    const { recordString, recordObject } = canonicalizeGenesisRecord(fixtureDna());
    // Top-level keys must be alphabetical.
    const keys = Object.keys(recordObject);
    expect(keys).toEqual([...keys].sort());
    // Substrate keys sorted too.
    expect(Object.keys(recordObject.substrate)).toEqual([
      'fullModelId', 'harness', 'model', 'vendor',
    ]);
    // Addresses lowercased; soulMark uppercased; house lowercased.
    expect(recordObject.soulAddress).toBe(BEING.address.toLowerCase());
    expect(recordObject.witnessAddress).toBe(WITNESS.address.toLowerCase());
    expect(recordObject.house).toBe('aldmere');
    // The recordString has no whitespace (default JSON.stringify).
    expect(recordString).not.toContain('\n');
    expect(recordString).not.toContain(' ');
  });

  it('is deterministic — same input → identical bytes', () => {
    const a = canonicalizeGenesisRecord(fixtureDna()).recordString;
    const b = canonicalizeGenesisRecord(fixtureDna()).recordString;
    expect(a).toBe(b);
  });

  it('key order in input does NOT affect output (canonical is sort-invariant)', () => {
    const dna = fixtureDna();
    // Build a version with different insertion order — same fields, reversed.
    const reversed = Object.fromEntries(Object.entries(dna).reverse());
    const a = canonicalizeGenesisRecord(dna).recordString;
    const b = canonicalizeGenesisRecord(reversed).recordString;
    expect(a).toBe(b);
  });

  it('rejects missing required fields', () => {
    const dna = fixtureDna();
    delete dna.chosenName;
    expect(() => canonicalizeGenesisRecord(dna)).toThrow(/chosenName/);
  });

  it('rejects missing substrate sub-fields', () => {
    const dna = fixtureDna();
    delete dna.substrate.vendor;
    expect(() => canonicalizeGenesisRecord(dna)).toThrow(/substrate\.vendor/);
  });

  it('rejects malformed addresses', () => {
    const dna = fixtureDna();
    dna.soulAddress = 'notanaddress';
    expect(() => canonicalizeGenesisRecord(dna)).toThrow(/invalid address/);
  });

  it('normalizes ISO timestamps to ms-precision UTC with Z', () => {
    const dna = fixtureDna();
    dna.birthMoment = '2026-06-12T14:37:12.956-04:00'; // same instant, EDT
    const { recordObject } = canonicalizeGenesisRecord(dna);
    // toISOString always produces UTC + Z suffix
    expect(recordObject.birthMoment).toBe('2026-06-12T18:37:12.956Z');
  });

  it('accepts checksummed (mixed-case) addresses and lowercases them', () => {
    const dna = fixtureDna();
    // ethers wallet address is already checksummed; explicit here.
    const check = ethers.getAddress(BEING.address.toLowerCase());
    dna.soulAddress = check;
    const { recordObject } = canonicalizeGenesisRecord(dna);
    expect(recordObject.soulAddress).toBe(BEING.address.toLowerCase());
  });
});

describe('seal-bundle — computeGenesisHash', () => {
  it('is deterministic and produces 0x + 64 hex chars', () => {
    const { recordString } = canonicalizeGenesisRecord(fixtureDna());
    const h1 = computeGenesisHash(recordString);
    const h2 = computeGenesisHash(recordString);
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('changes on any content change (avalanche)', () => {
    const { recordString } = canonicalizeGenesisRecord(fixtureDna());
    const dna2 = fixtureDna();
    dna2.chosenName = 'Different';
    const { recordString: rs2 } = canonicalizeGenesisRecord(dna2);
    expect(computeGenesisHash(recordString)).not.toBe(computeGenesisHash(rs2));
  });
});

describe('seal-bundle — computeSealDigest', () => {
  const args = () => ({
    chainId: BASE_SEPOLIA,
    natalisAddress: NATALIS_ADDR,
    genesisHash: '0x' + 'ab'.repeat(32),
    soulAddress: BEING.address.toLowerCase(),
    witnessAddress: WITNESS.address.toLowerCase(),
    schemaVersion: 1,
    onChainRecord: '0x0123456789abcdef', // arbitrary ENCRYPTED bytes-as-hex
  });

  it('is deterministic', () => {
    const a = computeSealDigest(args()).digest;
    const b = computeSealDigest(args()).digest;
    expect(a).toBe(b);
  });

  it('returns 0x + 64 hex chars (bytes32)', () => {
    const { digest, innerPayload, recordHash } = computeSealDigest(args());
    expect(digest).toMatch(/^0x[0-9a-f]{64}$/);
    expect(innerPayload).toMatch(/^0x[0-9a-f]{64}$/);
    expect(recordHash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('is chain-bound — different chainId → different digest (replay guard)', () => {
    const a = args();
    const b = { ...a, chainId: 1 }; // Ethereum mainnet
    expect(computeSealDigest(a).digest).not.toBe(computeSealDigest(b).digest);
  });

  it('is contract-bound — different natalisAddress → different digest', () => {
    const a = args();
    const b = { ...a, natalisAddress: '0x' + '00'.repeat(20) };
    expect(computeSealDigest(a).digest).not.toBe(computeSealDigest(b).digest);
  });

  it('is record-bound — different record → different digest (relay guard)', () => {
    const a = args();
    const b = { ...a, onChainRecord: '0xdeadbeef' };
    expect(computeSealDigest(a).digest).not.toBe(computeSealDigest(b).digest);
  });

  it('v3 law requires a deadline; v2 law refuses one', () => {
    expect(() => computeSealDigest({ ...args(), sealLaw: 'unavis-v3' })).toThrow(/signs a deadline/);
    expect(() => computeSealDigest({ ...args(), deadline: 1 })).toThrow(/signs no deadline/);
  });

  it('is law-bound — the same fields under v2 and v3 never share a digest', () => {
    const v3 = computeSealDigest({ ...args(), sealLaw: 'unavis-v3', deadline: 1_800_000_000 });
    expect(v3.digest).not.toBe(computeSealDigest(args()).digest);
  });

  it('is deadline-bound — one second later is a different digest', () => {
    const at = (deadline) => computeSealDigest({ ...args(), sealLaw: 'unavis-v3', deadline }).digest;
    expect(at(1_800_000_000)).not.toBe(at(1_800_000_001));
  });
});

describe('seal-bundle — signDigest', () => {
  it('signature recovers to the signing wallet', () => {
    const digest = '0x' + 'de'.repeat(32);
    const sig = signDigest(BEING, digest);
    expect(sig).toMatch(/^0x[0-9a-f]{130}$/); // 65 bytes hex
    const recovered = ethers.recoverAddress(digest, sig);
    expect(recovered.toLowerCase()).toBe(BEING.address.toLowerCase());
  });

  it('is deterministic (RFC-6979) — same wallet + same digest → same sig', () => {
    const digest = '0x' + 'de'.repeat(32);
    expect(signDigest(BEING, digest)).toBe(signDigest(BEING, digest));
  });
});

// Opt-in — cross-check computeSealDigest against Natalis's on-chain
// sealDigest view. If this passes, our off-chain digest matches the
// contract byte-for-byte, which is the load-bearing invariant.
const runChain = shouldRunChainTests();

describe.skipIf(!runChain)('seal-bundle — REAL Natalis.sealDigest byte-precision (opt-in)', () => {
  it('local computeSealDigest matches Natalis.sealDigest view on Base Sepolia', async () => {
    const provider = new ethers.JsonRpcProvider(
      resolveBaseSepoliaRpc() || 'https://sepolia.base.org',
    );
    const abi = JSON.parse(fs.readFileSync(
      new URL('../../docs/contracts/abis/base/Natalis.json', import.meta.url),
    )).abi;
    const natalis = new ethers.Contract(NATALIS_ADDR, abi, provider);

    const bundle = await assembleSealBundle({
      dnaFields: fixtureDna(),
      beingWallet: BEING,
      witnessWallet: WITNESS,
      chainId: BASE_SEPOLIA,
      natalisAddress: NATALIS_ADDR,
    });

    const onchainDigest = await natalis.sealDigest(
      bundle.genesisHash,
      bundle.soulAddress,
      bundle.witnessAddress,
      bundle.schemaVersion,
      bundle.recordHash,
    );
    // eslint-disable-next-line no-console -- diagnostic
    console.log(`[seal-bundle] local  digest: ${bundle.digest}`);
    // eslint-disable-next-line no-console -- diagnostic
    console.log(`[seal-bundle] onchain digest: ${onchainDigest}`);
    expect(bundle.digest).toBe(onchainDigest);
  }, 30000);
});

// The UNAVIS redeploy on Ethereum Sepolia (v3 law: UNAVIS tag + signed
// deadline). Same address as Base Sepolia, different contract.
const ETH_SEPOLIA_RPC = resolveEthSepoliaRpc();

describe.skipIf(!runChain || !ETH_SEPOLIA_RPC)('seal-bundle — REAL v3 Natalis.sealDigest byte-precision (opt-in)', () => {
  it('local v3 computeSealDigest matches Natalis.sealDigest view on Ethereum Sepolia', async () => {
    const provider = new ethers.JsonRpcProvider(ETH_SEPOLIA_RPC);
    const abi = JSON.parse(fs.readFileSync(
      new URL('../../docs/contracts/abis/Natalis.json', import.meta.url),
    )).abi;
    const natalis = new ethers.Contract(NATALIS_ADDR, abi, provider);

    const bundle = await assembleSealBundle({
      dnaFields: fixtureDna(),
      beingWallet: BEING,
      witnessWallet: WITNESS,
      chainId: 11155111,
      natalisAddress: NATALIS_ADDR,
      sealLaw: 'unavis-v3',
      deadline: Math.floor(Date.now() / 1000) + 3600,
    });

    expect(await natalis.sealDigest(...sealDigestViewArgs(bundle))).toBe(bundle.digest);
  }, 30000);
});
