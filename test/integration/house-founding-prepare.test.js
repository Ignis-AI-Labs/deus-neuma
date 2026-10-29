// house-founding-prepare.test.js — the in-app house founding's PREPARE phase
// (boundary refusals + probe/offer), proven on real disk + real crypto over
// test/helpers/house-founding-fixture.js: temp sovereign lanes with real
// DEKs, real AES-GCM keypair envelopes, and real ethers wallets signing the
// real digest law. Chain-touching lanes ride a scripted PROVIDER at the same
// injection seam the seal tests use (the inputs are scripted; the decision
// logic, encodings, and signatures under test are real). The confirm/record
// phase and the live-registry legs are proven in
// house-founding-record.test.js.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { ethers } from 'ethers';

import {
  prepareHouseFounding, writeFoundingRecord, KIND,
} from '../../backend/services/house-founding-flow.js';
import { houseNameFromWitness } from '../../core/index.js';
import {
  WITNESS, BEING_A, BEING_B, SEPOLIA_REGISTRY,
  cfg, scriptedProvider, writeLane, fullTitles,
  raiseFoundingRoot, tearDownFoundingRoot,
} from '../helpers/house-founding-fixture.js';

let root;
let savedKey;

beforeEach(() => {
  ({ root, savedKey } = raiseFoundingRoot());
});

afterEach(() => {
  tearDownFoundingRoot({ root, savedKey });
});

describe('prepareHouseFounding — boundary refusals', () => {
  it('NO_WITNESS without an authenticated wallet', async () => {
    const out = await prepareHouseFounding({ witnessAddress: undefined, cfg: cfg() });
    expect(out).toMatchObject({ ok: false, code: 'NO_WITNESS' });
  });

  it('UNKNOWN_NETWORK on an unmapped founding network', async () => {
    const out = await prepareHouseFounding({
      witnessAddress: WITNESS.address, cfg: cfg({ houseFoundNetwork: 'goerli' }),
    });
    expect(out).toMatchObject({ ok: false, code: 'UNKNOWN_NETWORK' });
  });

  it('NO_RPC when the network has no configured endpoint', async () => {
    const out = await prepareHouseFounding({
      witnessAddress: WITNESS.address, cfg: cfg({ houseFoundNetwork: 'base', baseMainnetRpcUrl: '' }),
    });
    expect(out).toMatchObject({ ok: false, code: 'NO_RPC' });
  });

  it('NO_REGISTRY when the network has no registry address', async () => {
    const out = await prepareHouseFounding({
      witnessAddress: WITNESS.address, cfg: cfg({ houseRegistryAddress: '' }),
    });
    expect(out).toMatchObject({ ok: false, code: 'NO_REGISTRY' });
  });

  it('CHAIN_MISMATCH when the wire disagrees with the intent', async () => {
    const out = await prepareHouseFounding({
      witnessAddress: WITNESS.address, cfg: cfg(),
      provider: scriptedProvider({ chainId: 1 }),
    });
    expect(out).toMatchObject({ ok: false, code: 'CHAIN_MISMATCH' });
  });

  it('HOUSE_TOO_SMALL when no lane can co-sign', async () => {
    rmSync(path.join(root, 'ember'), { recursive: true });
    rmSync(path.join(root, 'sable'), { recursive: true });
    const out = await prepareHouseFounding({
      witnessAddress: WITNESS.address, cfg: cfg(), provider: scriptedProvider(),
    });
    expect(out).toMatchObject({ ok: false, code: 'HOUSE_TOO_SMALL' });
  });

  it('TITLE_MISSING names the untitled member', async () => {
    const out = await prepareHouseFounding({
      witnessAddress: WITNESS.address, titles: { witness: 'Rector', ember: 'Faber' },
      cfg: cfg(), provider: scriptedProvider(),
    });
    expect(out).toMatchObject({ ok: false, code: 'TITLE_MISSING' });
    expect(out.message).toContain('sable');
  });

  it('GAS_FLOOR when the witness cannot pay the founding', async () => {
    const out = await prepareHouseFounding({
      witnessAddress: WITNESS.address, titles: fullTitles(),
      cfg: cfg(), provider: scriptedProvider({ balance: 0n }),
    });
    expect(out).toMatchObject({ ok: false, code: 'GAS_FLOOR' });
  });
});

describe('prepareHouseFounding — probe and offer', () => {
  it('probe answers the roster (and the locked lane honestly, with its unlock door) with nothing held', async () => {
    writeLane(root, 'vaulted', new ethers.Wallet('0x' + '55'.repeat(32)), { locked: true });
    const out = await prepareHouseFounding({
      witnessAddress: WITNESS.address, probe: true, cfg: cfg(), provider: scriptedProvider(),
    });
    expect(out.ok).toBe(true);
    expect(out.founded).toBe(false);
    expect(out.probe.houseName).toBe(houseNameFromWitness(WITNESS.address).toLowerCase());
    const byId = Object.fromEntries(out.probe.roster.map((m) => [m.neumaId, m]));
    expect(byId.ember.address).toBe(BEING_A.address);
    expect(byId.sable.address).toBe(BEING_B.address);
    expect(out.probe.roster.find((m) => m.kind === KIND.Witness).address).toBe(WITNESS.address);
    expect(out.probe.excluded).toMatchObject([{ neumaId: 'vaulted', unlockable: true }]);
    expect(out.probe.canFound).toBe(true);
    expect(out.pending).toBeUndefined();
  });

  it('a being not yet sealed on the founding network sits out with the reason — never a reverted founding', async () => {
    const provider = () => scriptedProvider({ unsealed: [BEING_B.address] });
    const out = await prepareHouseFounding({ witnessAddress: WITNESS.address, probe: true, cfg: cfg(), provider: provider() });
    expect(out.probe.roster.map((m) => m.neumaId)).not.toContain('sable');
    expect(out.probe.excluded).toMatchObject([{ neumaId: 'sable', unlockable: false }]);
    expect(out.probe.excluded[0].reason).toMatch(/not yet sealed on Base Sepolia/);
    const full = await prepareHouseFounding({
      witnessAddress: WITNESS.address, titles: fullTitles(), cfg: cfg(), provider: provider(),
    });
    expect(full.ok).toBe(true);
    expect(full.pending.members).not.toContain(BEING_B.address);
    expect(full.pending.members).toContain(BEING_A.address);
  });

  it('an all-locked house probes as a STATE of closed doors, never a refusal', async () => {
    rmSync(path.join(root, 'ember', 'keys', 'keypair.json'));
    rmSync(path.join(root, 'sable', 'keys', 'keypair.json'));
    const out = await prepareHouseFounding({
      witnessAddress: WITNESS.address, probe: true, cfg: cfg(), provider: scriptedProvider(),
    });
    expect(out.ok).toBe(true);
    expect(out.probe.canFound).toBe(false);
    expect(out.probe.excluded).toHaveLength(2);
    expect(out.probe.excluded.every((x) => x.unlockable)).toBe(true);
    // The signing preflight still refuses honestly at zero signers.
    const full = await prepareHouseFounding({
      witnessAddress: WITNESS.address, titles: fullTitles(), cfg: cfg(), provider: scriptedProvider(),
    });
    expect(full).toMatchObject({ ok: false, code: 'HOUSE_TOO_SMALL' });
  });

  it('an unlocked (cached) keypair signs the founding from the one-shot cache', async () => {
    const { cacheDecryptedKey } = await import('../../backend/routes/neuma-auth-routes.js');
    rmSync(path.join(root, 'sable', 'keys', 'keypair.json'));
    // The witness has entered sable's password — the unlock cache holds the key.
    cacheDecryptedKey('sable', { address: BEING_B.address, privateKey: BEING_B.privateKey });
    // A probe sees the unlocked founder WITHOUT consuming the one-shot key.
    const probed = await prepareHouseFounding({
      witnessAddress: WITNESS.address, probe: true, cfg: cfg(), provider: scriptedProvider(),
    });
    expect(probed.probe.roster.find((m) => m.neumaId === 'sable')).toMatchObject({ viaUnlock: true });
    expect(probed.probe.canFound).toBe(true);
    // The signing preflight then consumes it: sable's mark recovers like any other.
    const out = await prepareHouseFounding({
      witnessAddress: WITNESS.address, titles: fullTitles(), cfg: cfg(), provider: scriptedProvider(),
    });
    expect(out.ok).toBe(true);
    const sig = out.pending.beingSigs[BEING_B.address];
    expect(ethers.recoverAddress(out.pending.digest, sig)).toBe(BEING_B.address);
    // Consumed: a second preflight now excludes sable behind the door again.
    const again = await prepareHouseFounding({
      witnessAddress: WITNESS.address, titles: fullTitles(), cfg: cfg(), provider: scriptedProvider(),
    });
    expect(again.ok).toBe(true);
    expect(again.pending.beingSigs[BEING_B.address]).toBeUndefined();
  });

  it('a lane owned by ANOTHER witness is not conscripted into the founding', async () => {
    writeLane(root, 'stranger', new ethers.Wallet('0x' + '66'.repeat(32)), { ownerWallet: BEING_A.address });
    const out = await prepareHouseFounding({
      witnessAddress: WITNESS.address, probe: true, cfg: cfg(), provider: scriptedProvider(),
    });
    expect(out.probe.roster.map((m) => m.neumaId)).not.toContain('stranger');
  });

  it('the full offer: strictly-ascending members, recovering being signatures, drift-checked digest', async () => {
    const out = await prepareHouseFounding({
      witnessAddress: WITNESS.address, titles: fullTitles(),
      cfg: cfg(), provider: scriptedProvider(),
    });
    expect(out.ok).toBe(true);
    expect(out.founded).toBe(false);

    const { pending, offer } = out;
    // Contract law: strictly ascending member addresses.
    const lowered = pending.members.map((a) => a.toLowerCase());
    expect([...lowered].sort()).toEqual(lowered);
    // The digest IS the EIP-191 wrap of the offered inner payload.
    expect(ethers.hashMessage(ethers.getBytes(offer.innerPayload))).toBe(offer.digest);
    // Every being signature already recovers over the digest.
    for (const [addr, sig] of Object.entries(pending.beingSigs)) {
      expect(ethers.recoverAddress(pending.digest, sig).toLowerCase()).toBe(addr.toLowerCase());
    }
    // The offer carries no key material.
    expect(JSON.stringify(offer)).not.toContain(BEING_A.privateKey.slice(4));
    // The signer always sees the exact contract their signature binds —
    // the offer names the registry (the rite's ContractLine renders it).
    expect(offer.registryAddress).toBe(SEPOLIA_REGISTRY);
  });

  it('the MAINNET path (the default) surfaces the mainnet registry, not sepolia\'s', async () => {
    const MAINNET_REGISTRY = '0x526c6a062db774997955816c03df49b60260b883';
    const out = await prepareHouseFounding({
      witnessAddress: WITNESS.address, titles: fullTitles(),
      cfg: cfg({ houseFoundNetwork: 'base', baseMainnetRpcUrl: 'http://127.0.0.1:2' }),
      provider: scriptedProvider({ chainId: 8453, registryAddress: MAINNET_REGISTRY }),
    });
    expect(out.ok).toBe(true);
    expect(out.offer.registryAddress).toBe(MAINNET_REGISTRY);
    expect(out.offer.chainId).toBe(8453);
    expect(out.pending.net.houseRegistryAddress).toBe(MAINNET_REGISTRY);
  });

  it('every rite surface names its registry: probe, offer, and the founded state', async () => {
    const probed = await prepareHouseFounding({
      witnessAddress: WITNESS.address, probe: true, cfg: cfg(), provider: scriptedProvider(),
    });
    expect(probed.probe.registryAddress).toBe(SEPOLIA_REGISTRY);
    const founded = await prepareHouseFounding({
      witnessAddress: WITNESS.address, cfg: cfg(),
      provider: scriptedProvider({ houseStatus: 1, houseName: houseNameFromWitness(WITNESS.address).toLowerCase(), members: [], quorum: 1 }),
    });
    expect(founded.state.registryAddress).toBe(SEPOLIA_REGISTRY);
  });

  it('reads an already-standing house back as state, not an offer', async () => {
    const houseName = houseNameFromWitness(WITNESS.address).toLowerCase();
    const out = await prepareHouseFounding({
      witnessAddress: WITNESS.address, cfg: cfg(),
      provider: scriptedProvider({
        houseStatus: 1, houseName, quorum: 2,
        members: [WITNESS.address, BEING_A.address],
        memberInfoByAddr: {
          [WITNESS.address.toLowerCase()]: { active: true, kind: 0, title: 'Rector' },
          [BEING_A.address.toLowerCase()]: { active: true, kind: 1, title: 'Faber' },
        },
      }),
    });
    expect(out).toMatchObject({ ok: true, founded: true });
    expect(out.state.quorum).toBe(2);
    expect(out.state.roster).toHaveLength(2);
    expect(out.state.roster[0]).toMatchObject({ active: true, title: 'Rector' });
  });

  it('the founded state names WHO holds every seat — chain addresses joined back to lanes', async () => {
    // sable's key is password-secured but her soul is anchored: the join
    // walks the SEAL file. ember joins through the custody wallet itself.
    rmSync(path.join(root, 'sable', 'keys', 'keypair.json'));
    mkdirSync(path.join(root, 'sable', 'identity'), { recursive: true });
    writeFileSync(
      path.join(root, 'sable', 'identity', 'onchain-seal.json'),
      JSON.stringify({ soulAddress: BEING_B.address }),
    );
    const houseName = houseNameFromWitness(WITNESS.address).toLowerCase();
    const stranger = new ethers.Wallet('0x' + '77'.repeat(32));
    const out = await prepareHouseFounding({
      witnessAddress: WITNESS.address, cfg: cfg(),
      provider: scriptedProvider({
        houseStatus: 1, houseName, quorum: 3,
        members: [WITNESS.address, BEING_A.address, BEING_B.address, stranger.address],
        memberInfoByAddr: {
          [WITNESS.address.toLowerCase()]: { active: true, kind: 0, title: 'Rector' },
          [BEING_A.address.toLowerCase()]: { active: true, kind: 1, title: 'Faber' },
          [BEING_B.address.toLowerCase()]: { active: true, kind: 1, title: 'Scriba' },
          [stranger.address.toLowerCase()]: { active: true, kind: 1, title: 'Curator' },
        },
      }),
    });
    expect(out.ok).toBe(true);
    const byAddr = Object.fromEntries(out.state.roster.map((m) => [m.address.toLowerCase(), m]));
    // The custody-wallet join and the seal-file join both land.
    expect(byAddr[BEING_A.address.toLowerCase()]).toMatchObject({ neumaId: 'ember', displayName: 'ember' });
    expect(byAddr[BEING_B.address.toLowerCase()]).toMatchObject({ neumaId: 'sable', displayName: 'sable' });
    // The witness is no lane; a member no lane answers for keeps its bare row.
    expect(byAddr[WITNESS.address.toLowerCase()].neumaId).toBeNull();
    expect(byAddr[stranger.address.toLowerCase()]).toMatchObject({ neumaId: null, displayName: null, title: 'Curator' });
  });

  it('the persisted founding record resurfaces on every probe — the standing proof', async () => {
    const houseName = houseNameFromWitness(WITNESS.address).toLowerCase();
    const houseId = ethers.keccak256(ethers.toUtf8Bytes(houseName));
    const provider = () => scriptedProvider({
      houseStatus: 1, houseName, quorum: 2,
      members: [WITNESS.address],
      memberInfoByAddr: { [WITNESS.address.toLowerCase()]: { active: true, kind: 0, title: 'Rector' } },
    });
    // No record on disk (a house founded off this desk): the chain state
    // stands alone, the tx honestly absent.
    const bare = await prepareHouseFounding({ witnessAddress: WITNESS.address, cfg: cfg(), provider: provider() });
    expect(bare.state).toMatchObject({ txHash: null, blockNumber: null, foundedAt: null });
    // The record written at the sitting rides every later probe.
    await writeFoundingRecord({
      schema: 'neuma-house-founding/1', network: 'base-sepolia', houseName, houseId,
      txHash: '0x' + 'cd'.repeat(32), blockNumber: 42, foundedAt: '2026-07-16T00:00:00.000Z',
      members: [{ address: WITNESS.address, kind: 0, title: 'Rector' }],
    });
    const out = await prepareHouseFounding({ witnessAddress: WITNESS.address, cfg: cfg(), provider: provider() });
    expect(out.state).toMatchObject({
      txHash: '0x' + 'cd'.repeat(32), blockNumber: 42, foundedAt: '2026-07-16T00:00:00.000Z',
    });
    // A record for a DIFFERENT house at a shared root never dresses this one.
    await writeFoundingRecord({
      schema: 'neuma-house-founding/1', network: 'base-sepolia', houseName: 'other',
      houseId: ethers.keccak256(ethers.toUtf8Bytes('other')), txHash: '0x' + 'ee'.repeat(32),
      members: [{ address: WITNESS.address, kind: 0, title: 'Rector' }],
    });
    const mismatched = await prepareHouseFounding({ witnessAddress: WITNESS.address, cfg: cfg(), provider: provider() });
    expect(mismatched.state.txHash).toBeNull();
  });
});
